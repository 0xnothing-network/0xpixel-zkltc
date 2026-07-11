import {
  decodeAbiParameters,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { DEX_ADDRESS } from "@/lib/0xDexAbi";
import { LITVM_EXPLORER_URL, publicClient } from "@/lib/contract";

const DEFAULT_DEX_START_BLOCK = 24_869_425n;
const DEX_START_BLOCK = parseStartBlock(
  process.env.NEXT_PUBLIC_DEX_DEPLOYMENT_BLOCK ?? process.env.NEXT_PUBLIC_DEX_START_BLOCK,
  DEFAULT_DEX_START_BLOCK,
);
const LIQUIDITY_ADDED_TOPIC = keccak256(
  toBytes("LiquidityAdded(address,bytes32,uint256,uint256,uint256)"),
);
const EXPLORER_PAGE_SIZE = 1_000;
const EXPLORER_MAX_RANGES = 64;
const EXPLORER_TIMEOUT_MS = 8_000;
const CACHE_TTL_MS = 5 * 60 * 1_000;

interface ExplorerLog {
  blockNumber: string;
  data: Hex;
  logIndex: string;
  topics: Array<Hex | null>;
  transactionHash: Hex;
}

interface ExplorerLogsResponse {
  message?: string;
  result?: ExplorerLog[] | string;
}

export interface InitialLiquidityEntry {
  amount0: string;
  amount1: string;
  blockNumber: number;
  transactionHash: Hex;
}

export interface DexInitialLiquidityData {
  source: "onchain";
  asOfBlock: number;
  pairs: Record<string, InitialLiquidityEntry>;
}

let cachedData: { expiresAt: number; value: DexInitialLiquidityData } | null = null;
let inFlight: Promise<DexInitialLiquidityData> | null = null;

export async function loadDexInitialLiquidity(): Promise<DexInitialLiquidityData> {
  if (cachedData && cachedData.expiresAt > Date.now()) return cachedData.value;
  if (inFlight) return inFlight;

  inFlight = refreshInitialLiquidity()
    .then((value) => {
      cachedData = { expiresAt: Date.now() + CACHE_TTL_MS, value };
      return value;
    })
    .catch((error) => {
      if (cachedData) return cachedData.value;
      throw error;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

async function refreshInitialLiquidity(): Promise<DexInitialLiquidityData> {
  const latestBlock = await publicClient.getBlockNumber();
  const logs = await fetchLiquidityRanges(DEX_START_BLOCK, latestBlock);
  logs.sort(compareLogs);

  const pairs: Record<string, InitialLiquidityEntry> = {};
  for (const log of logs) {
    const pairId = log.topics[2]?.toLowerCase();
    if (!pairId || !/^0x[0-9a-f]{64}$/.test(pairId) || pairs[pairId]) continue;

    try {
      const [amount0, amount1] = decodeAbiParameters(
        [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
        log.data,
      );
      if (amount0 === 0n || amount1 === 0n) continue;
      pairs[pairId] = {
        amount0: amount0.toString(),
        amount1: amount1.toString(),
        blockNumber: Number(BigInt(log.blockNumber)),
        transactionHash: log.transactionHash,
      };
    } catch {
      continue;
    }
  }

  return {
    source: "onchain",
    asOfBlock: Number(latestBlock),
    pairs,
  };
}

async function fetchLiquidityRanges(
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ExplorerLog[]> {
  const ranges: Array<readonly [bigint, bigint]> = [[fromBlock, toBlock]];
  const logs: ExplorerLog[] = [];
  let processedRanges = 0;

  while (ranges.length > 0) {
    if (processedRanges >= EXPLORER_MAX_RANGES) {
      throw new Error("Explorer liquidity range limit exceeded");
    }
    processedRanges += 1;
    const [rangeStart, rangeEnd] = ranges.pop()!;
    const page = await fetchLiquidityRange(rangeStart, rangeEnd);
    if (page.length >= EXPLORER_PAGE_SIZE) {
      if (rangeStart >= rangeEnd) {
        throw new Error("Explorer liquidity result cap exceeded in one block");
      }
      const midpoint = (rangeStart + rangeEnd) / 2n;
      ranges.push([rangeStart, midpoint], [midpoint + 1n, rangeEnd]);
      continue;
    }
    logs.push(...page);
  }

  return Array.from(
    new Map(logs.map((log) => [`${log.transactionHash}:${log.logIndex}`, log])).values(),
  );
}

async function fetchLiquidityRange(
  fromBlock: bigint,
  toBlock: bigint,
): Promise<ExplorerLog[]> {
  const url = new URL(`${LITVM_EXPLORER_URL.replace(/\/$/, "")}/api`);
  const params: Record<string, string> = {
    module: "logs",
    action: "getLogs",
    fromBlock: fromBlock.toString(),
    toBlock: toBlock.toString(),
    address: DEX_ADDRESS,
    topic0: LIQUIDITY_ADDED_TOPIC,
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
    throw new Error(`Explorer liquidity request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ExplorerLogsResponse;
  if (!Array.isArray(payload.result)) {
    if (payload.message === "No logs found") return [];
    throw new Error(payload.message || "Explorer returned invalid liquidity logs");
  }
  return payload.result;
}

function compareLogs(a: ExplorerLog, b: ExplorerLog): number {
  const blockA = BigInt(a.blockNumber);
  const blockB = BigInt(b.blockNumber);
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  const indexA = BigInt(a.logIndex);
  const indexB = BigInt(b.logIndex);
  return indexA === indexB ? 0 : indexA < indexB ? -1 : 1;
}

function parseStartBlock(value: string | undefined, fallback: bigint): bigint {
  if (!value) return fallback;
  try {
    const parsed = BigInt(value);
    return parsed >= 0n ? parsed : fallback;
  } catch {
    return fallback;
  }
}
