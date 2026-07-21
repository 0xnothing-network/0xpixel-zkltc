import {
  decodeAbiParameters,
  formatUnits,
  keccak256,
  pad,
  toBytes,
  type Hex,
} from "viem";
import { DEX_ABI, DEX_ADDRESS } from "@/lib/0xDexAbi";
import { LITVM_EXPLORER_URL, publicClient } from "@/lib/contract";
import {
  DEX_ONCHAIN_LOOKBACK_BLOCKS,
  DEX_START_BLOCK as PUBLIC_DEX_START_BLOCK,
} from "@/lib/publicConfig";

const DEX_START_BLOCK = PUBLIC_DEX_START_BLOCK;
const LOOKBACK_BLOCKS = DEX_ONCHAIN_LOOKBACK_BLOCKS;
const SWAPPED_TOPIC = keccak256(
  toBytes("Swapped(address,address,address,uint256,uint256,uint256)")
);
const EXPLORER_PAGE_SIZE = 1_000;
const EXPLORER_MAX_RANGES = 16;
const EXPLORER_TIMEOUT_MS = 8_000;

export interface OnchainCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface DexPoolSnapshot {
  blockNumber: number;
  timestamp: number;
  price: number;
}

export interface DexOnchainFallback {
  candles: OnchainCandle[];
  latestPrice: {
    price: number;
    timestamp: number;
    source: "pool";
  };
  blockNumber: number;
}

interface ExplorerLog {
  blockNumber: string;
  data: Hex;
  logIndex: string;
  timeStamp: string;
  topics: Array<Hex | null>;
  transactionHash: Hex;
}

interface ExplorerLogsResponse {
  message?: string;
  result?: ExplorerLog[] | string;
}

interface ParsedSwap {
  id: string;
  timestamp: number;
  blockNumber: number;
  logIndex: number;
  price: number;
}

export async function loadDexPoolSnapshot({
  pairId,
  token0,
  token1,
  token0Decimals,
  token1Decimals,
}: {
  pairId: `0x${string}`;
  token0: string;
  token1: string;
  token0Decimals: number;
  token1Decimals: number;
}): Promise<DexPoolSnapshot> {
  const [pool, block] = await Promise.all([
    publicClient.readContract({
      address: DEX_ADDRESS,
      abi: DEX_ABI,
      functionName: "pools",
      args: [pairId],
    }),
    publicClient.getBlock(),
  ]);
  const tuple = pool as readonly [
    `0x${string}`,
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const price = poolPrice(
    tuple,
    token0,
    token1,
    token0Decimals,
    token1Decimals
  );
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error("DEX pool has no on-chain price");
  }

  return {
    blockNumber: Number(block.number),
    timestamp: Number(block.timestamp),
    price,
  };
}

export async function loadDexOnchainFallback({
  pairId,
  token0,
  token1,
  intervalMinutes,
  token0Decimals,
  token1Decimals,
  snapshot,
}: {
  pairId: `0x${string}`;
  token0: string;
  token1: string;
  intervalMinutes: number;
  token0Decimals: number;
  token1Decimals: number;
  snapshot?: DexPoolSnapshot;
}): Promise<DexOnchainFallback> {
  const current =
    snapshot ??
    (await loadDexPoolSnapshot({
      pairId,
      token0,
      token1,
      token0Decimals,
      token1Decimals,
    }));
  const latestBlock = BigInt(current.blockNumber);
  const recentStart = latestBlock >= LOOKBACK_BLOCKS
    ? latestBlock - LOOKBACK_BLOCKS + 1n
    : 0n;
  const fromBlock = recentStart > DEX_START_BLOCK ? recentStart : DEX_START_BLOCK;

  let swaps: ParsedSwap[] = [];
  try {
    const logs = await fetchPairSwapLogs(
      token0 as `0x${string}`,
      token1 as `0x${string}`,
      fromBlock,
      latestBlock
    );
    swaps = logs.map((log) =>
      parseSwapLog(log, token0, token1, token0Decimals, token1Decimals)
    ).filter(isPresent);
  } catch (error) {
    console.warn("[dex] explorer swap-log fallback failed:", error);
  }

  const intervalSeconds = intervalMinutes * 60;
  const candles = buildCandles(swaps, intervalSeconds);
  appendPoolSnapshot(candles, current, intervalSeconds);

  return {
    candles,
    latestPrice: {
      price: current.price,
      timestamp: current.timestamp,
      source: "pool",
    },
    blockNumber: current.blockNumber,
  };
}

async function fetchPairSwapLogs(
  token0: `0x${string}`,
  token1: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint
): Promise<ExplorerLog[]> {
  const requests = [
    fetchExplorerSwapRanges(token0, token1, fromBlock, toBlock),
    fetchExplorerSwapRanges(token1, token0, fromBlock, toBlock),
  ];

  const settled = await Promise.allSettled(requests);
  const logs = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  );
  if (logs.length === 0 && settled.every((result) => result.status === "rejected")) {
    throw (settled[0] as PromiseRejectedResult).reason;
  }

  return Array.from(
    new Map(logs.map((log) => [`${log.transactionHash}:${log.logIndex}`, log])).values()
  );
}

async function fetchExplorerSwapRanges(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint
): Promise<ExplorerLog[]> {
  const logs: ExplorerLog[] = [];
  const ranges: Array<readonly [bigint, bigint]> = [[fromBlock, toBlock]];
  let processedRanges = 0;

  while (ranges.length > 0) {
    if (processedRanges >= EXPLORER_MAX_RANGES) {
      throw new Error("Explorer swap range limit exceeded");
    }
    processedRanges += 1;
    const [rangeStart, rangeEnd] = ranges.pop()!;
    const page = await fetchExplorerSwapRange(
      tokenIn,
      tokenOut,
      rangeStart,
      rangeEnd
    );
    if (page.length >= EXPLORER_PAGE_SIZE) {
      if (rangeStart >= rangeEnd) {
        throw new Error("Explorer swap result cap exceeded in one block");
      }
      const midpoint = (rangeStart + rangeEnd) / 2n;
      ranges.push([rangeStart, midpoint], [midpoint + 1n, rangeEnd]);
      continue;
    }
    logs.push(...page);
  }

  return logs;
}

async function fetchExplorerSwapRange(
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  fromBlock: bigint,
  toBlock: bigint
): Promise<ExplorerLog[]> {
  const url = new URL(`${LITVM_EXPLORER_URL.replace(/\/$/, "")}/api`);
  const topic2 = pad(tokenIn, { size: 32 }).toLowerCase();
  const topic3 = pad(tokenOut, { size: 32 }).toLowerCase();
  const params: Record<string, string> = {
    module: "logs",
    action: "getLogs",
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    address: DEX_ADDRESS,
    topic0: SWAPPED_TOPIC,
    topic2,
    topic3,
    topic0_2_opr: "and",
    topic0_3_opr: "and",
    topic2_3_opr: "and",
    offset: EXPLORER_PAGE_SIZE.toString(),
  };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(EXPLORER_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Explorer swap-log request failed: ${response.status}`);
  }
  const payload = (await response.json()) as ExplorerLogsResponse;
  if (!Array.isArray(payload.result)) {
    if (payload.message === "No logs found") return [];
    throw new Error(payload.message || "Explorer returned invalid swap logs");
  }
  return payload.result;
}

function parseSwapLog(
  log: ExplorerLog,
  token0: string,
  token1: string,
  token0Decimals: number,
  token1Decimals: number
): ParsedSwap | null {
  const tokenIn = addressFromTopic(log.topics[2]);
  const tokenOut = addressFromTopic(log.topics[3]);
  if (!tokenIn || !tokenOut) return null;

  try {
    const [amountIn, amountOut] = decodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      log.data
    );
    let quoteAmount: number;
    let baseAmount: number;
    if (
      tokenIn.toLowerCase() === token0.toLowerCase() &&
      tokenOut.toLowerCase() === token1.toLowerCase()
    ) {
      quoteAmount = amountToNumber(amountIn, token0Decimals);
      baseAmount = amountToNumber(amountOut, token1Decimals);
    } else if (
      tokenIn.toLowerCase() === token1.toLowerCase() &&
      tokenOut.toLowerCase() === token0.toLowerCase()
    ) {
      quoteAmount = amountToNumber(amountOut, token0Decimals);
      baseAmount = amountToNumber(amountIn, token1Decimals);
    } else {
      return null;
    }

    const price = quoteAmount / baseAmount;
    if (!Number.isFinite(price) || price <= 0) return null;
    return {
      id: `${log.transactionHash.toLowerCase()}-${parseRpcNumber(log.logIndex)}`,
      timestamp: parseRpcNumber(log.timeStamp),
      blockNumber: parseRpcNumber(log.blockNumber),
      logIndex: parseRpcNumber(log.logIndex),
      price,
    };
  } catch {
    return null;
  }
}

function buildCandles(swaps: ParsedSwap[], intervalSeconds: number): OnchainCandle[] {
  const candles = new Map<number, OnchainCandle>();
  swaps.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.blockNumber - b.blockNumber ||
      a.logIndex - b.logIndex ||
      a.id.localeCompare(b.id)
  );

  for (const swap of swaps) {
    const time = Math.floor(swap.timestamp / intervalSeconds) * intervalSeconds;
    const candle = candles.get(time);
    if (!candle) {
      candles.set(time, {
        time,
        open: swap.price,
        high: swap.price,
        low: swap.price,
        close: swap.price,
      });
      continue;
    }
    candle.high = Math.max(candle.high, swap.price);
    candle.low = Math.min(candle.low, swap.price);
    candle.close = swap.price;
  }

  return [...candles.values()].sort((a, b) => a.time - b.time);
}

function appendPoolSnapshot(
  candles: OnchainCandle[],
  snapshot: DexPoolSnapshot,
  intervalSeconds: number
) {
  const time = Math.floor(snapshot.timestamp / intervalSeconds) * intervalSeconds;
  const last = candles[candles.length - 1];
  if (last?.time === time) {
    last.high = Math.max(last.high, snapshot.price);
    last.low = Math.min(last.low, snapshot.price);
    last.close = snapshot.price;
    return;
  }
  candles.push({
    time,
    open: snapshot.price,
    high: snapshot.price,
    low: snapshot.price,
    close: snapshot.price,
  });
}

function poolPrice(
  pool: readonly [
    `0x${string}`,
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ],
  quoteToken: string,
  baseToken: string,
  quoteDecimals: number,
  baseDecimals: number
): number {
  const poolToken0 = pool[0].toLowerCase();
  const poolToken1 = pool[1].toLowerCase();
  const quote = quoteToken.toLowerCase();
  const base = baseToken.toLowerCase();
  let quoteReserve: bigint;
  let baseReserve: bigint;

  if (poolToken0 === quote && poolToken1 === base) {
    quoteReserve = pool[2];
    baseReserve = pool[3];
  } else if (poolToken1 === quote && poolToken0 === base) {
    quoteReserve = pool[3];
    baseReserve = pool[2];
  } else {
    return 0;
  }
  if (quoteReserve <= 0n || baseReserve <= 0n) return 0;

  const normalizedQuote = amountToNumber(quoteReserve, quoteDecimals);
  const normalizedBase = amountToNumber(baseReserve, baseDecimals);
  return normalizedQuote / normalizedBase;
}

function amountToNumber(amount: bigint, decimals: number): number {
  return Number(formatUnits(amount, decimals));
}

function addressFromTopic(topic: Hex | null | undefined): `0x${string}` | null {
  if (!topic || topic.length < 42) return null;
  return `0x${topic.slice(-40)}`.toLowerCase() as `0x${string}`;
}

function parseRpcNumber(value: string): number {
  const parsed = value.startsWith("0x") ? Number(BigInt(value)) : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}
