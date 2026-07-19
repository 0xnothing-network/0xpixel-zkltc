import { NextResponse } from "next/server";
import {
  isAddress,
  keccak256,
  pad,
  toBytes,
  type Address,
  type Hex,
} from "viem";
import {
  PREDICTION_ABI,
  PREDICTION_ADDRESS,
} from "@/lib/0xPredictionAbi";
import { LITVM_EXPLORER_URL, publicClient } from "@/lib/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PREDICTION_DEPLOY_BLOCK = 26_054_120n;
const BET_PLACED_TOPIC = keccak256(
  toBytes("BetPlaced(uint256,address,uint8,uint256,uint256,uint256)")
);
const EXPLORER_TIMEOUT_MS = 8_000;
const HISTORY_LIMIT = 16;
const HISTORY_CACHE_TTL_MS = 15_000;
const HISTORY_CACHE_MAX_ENTRIES = 256;

interface ExplorerLog {
  address?: Hex;
  blockNumber?: string;
  logIndex?: string;
  topics?: Array<Hex | null>;
  transactionHash?: Hex;
}

interface ExplorerLogsResponse {
  status?: string;
  message?: string;
  result?: ExplorerLog[] | string;
}

interface RoundReference {
  roundId: bigint;
  blockNumber: bigint;
  logIndex: bigint;
  txHash?: Hex;
}

interface PredictionHistoryItemDTO {
  roundId: string;
  symbol: string;
  upAmount: string;
  downAmount: string;
  claimable: string;
  claimed: boolean;
  outcome: number;
  txHash?: Hex;
}

interface PredictionHistoryPayload {
  history: PredictionHistoryItemDTO[];
  source: "explorer";
}

interface CacheEntry {
  value: PredictionHistoryPayload;
  timestamp: number;
}

type RoundCoreTuple = readonly [
  Hex,
  string,
  Address,
  bigint,
  bigint,
  bigint,
  bigint,
  number,
  boolean,
  boolean,
];

type PositionTuple = readonly [bigint, bigint, boolean];

const historyCache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const rawAddress = searchParams.get("address")?.trim() ?? "";
  if (!isAddress(rawAddress, { strict: false })) {
    return json({ error: "A valid wallet address is required" }, 400);
  }

  const userAddress = rawAddress.toLowerCase() as Address;
  const force = searchParams.get("force") === "1";
  const cached = historyCache.get(userAddress);
  if (!force && cached && Date.now() - cached.timestamp < HISTORY_CACHE_TTL_MS) {
    return json(cached.value);
  }

  try {
    const rounds = await fetchBetRounds(userAddress);
    const history = await fetchRoundHistory(rounds, userAddress);
    const value: PredictionHistoryPayload = { history, source: "explorer" };
    writeCache(userAddress, value);
    return json(value);
  } catch (error) {
    console.error("[prediction-history] history fetch failed:", error);
    return json({ error: "Prediction history is unavailable" }, 503);
  }
}

async function fetchBetRounds(userAddress: Address): Promise<RoundReference[]> {
  const topic2 = pad(userAddress, { size: 32 }).toLowerCase() as Hex;
  const url = new URL(`${LITVM_EXPLORER_URL.replace(/\/$/, "")}/api`);
  const params: Record<string, string> = {
    module: "logs",
    action: "getLogs",
    fromBlock: PREDICTION_DEPLOY_BLOCK.toString(),
    toBlock: "latest",
    address: PREDICTION_ADDRESS,
    topic0: BET_PLACED_TOPIC,
    topic2,
    topic0_2_opr: "and",
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
    throw new Error(`Explorer history request failed: ${response.status}`);
  }

  const payload = (await response.json()) as ExplorerLogsResponse;
  const logs = readExplorerLogs(payload);
  const byRound = new Map<string, RoundReference>();

  for (const log of logs) {
    const topics = log.topics;
    if (
      log.address?.toLowerCase() !== PREDICTION_ADDRESS.toLowerCase() ||
      topics?.[0]?.toLowerCase() !== BET_PLACED_TOPIC.toLowerCase() ||
      topics?.[2]?.toLowerCase() !== topic2
    ) {
      continue;
    }

    const roundTopic = topics[1];
    if (!roundTopic) continue;

    try {
      const reference: RoundReference = {
        roundId: BigInt(roundTopic),
        blockNumber: parseQuantity(log.blockNumber),
        logIndex: parseQuantity(log.logIndex),
        txHash: isTransactionHash(log.transactionHash)
          ? log.transactionHash
          : undefined,
      };
      const key = reference.roundId.toString();
      const current = byRound.get(key);
      if (!current || isNewer(reference, current)) byRound.set(key, reference);
    } catch {
      // Ignore malformed explorer rows while retaining valid history records.
    }
  }

  return Array.from(byRound.values())
    .sort(compareNewestFirst)
    .slice(0, HISTORY_LIMIT);
}

function readExplorerLogs(payload: ExplorerLogsResponse): ExplorerLog[] {
  if (Array.isArray(payload.result)) return payload.result;

  const message = `${payload.message ?? ""} ${
    typeof payload.result === "string" ? payload.result : ""
  }`.toLowerCase();
  if (
    payload.status === "0" &&
    (message.includes("no records found") || message.includes("no logs found"))
  ) {
    return [];
  }

  throw new Error(payload.message || "Explorer returned invalid history data");
}

async function fetchRoundHistory(
  rounds: RoundReference[],
  userAddress: Address
): Promise<PredictionHistoryItemDTO[]> {
  if (rounds.length === 0) return [];

  const contracts = rounds.flatMap(({ roundId }) => [
    {
      address: PREDICTION_ADDRESS,
      abi: PREDICTION_ABI,
      functionName: "getRoundCore" as const,
      args: [roundId] as const,
    },
    {
      address: PREDICTION_ADDRESS,
      abi: PREDICTION_ABI,
      functionName: "getPosition" as const,
      args: [roundId, userAddress] as const,
    },
    {
      address: PREDICTION_ADDRESS,
      abi: PREDICTION_ABI,
      functionName: "getClaimable" as const,
      args: [roundId, userAddress] as const,
    },
  ]);
  const results = await publicClient.multicall({
    allowFailure: true,
    contracts,
  });

  const history: PredictionHistoryItemDTO[] = [];
  for (let index = 0; index < rounds.length; index += 1) {
    const coreResult = results[index * 3];
    const positionResult = results[index * 3 + 1];
    const claimableResult = results[index * 3 + 2];
    if (
      coreResult?.status !== "success" ||
      positionResult?.status !== "success"
    ) {
      continue;
    }

    const core = coreResult.result as unknown as RoundCoreTuple;
    const position = positionResult.result as unknown as PositionTuple;
    const [upAmount, downAmount, claimed] = position;
    if (upAmount === 0n && downAmount === 0n) continue;

    const claimable =
      claimableResult?.status === "success"
        ? (claimableResult.result as bigint)
        : 0n;
    history.push({
      roundId: rounds[index].roundId.toString(),
      symbol: core[1],
      upAmount: upAmount.toString(),
      downAmount: downAmount.toString(),
      claimable: claimable.toString(),
      claimed,
      outcome: Number(core[7]),
      txHash: rounds[index].txHash,
    });
  }

  return history;
}

function parseQuantity(value: string | undefined): bigint {
  if (!value) return 0n;
  return BigInt(value);
}

function isTransactionHash(value: Hex | undefined): value is Hex {
  return !!value && /^0x[0-9a-fA-F]{64}$/.test(value);
}

function isNewer(left: RoundReference, right: RoundReference): boolean {
  return compareNewestFirst(left, right) < 0;
}

function compareNewestFirst(left: RoundReference, right: RoundReference): number {
  if (left.blockNumber !== right.blockNumber) {
    return left.blockNumber > right.blockNumber ? -1 : 1;
  }
  if (left.logIndex !== right.logIndex) {
    return left.logIndex > right.logIndex ? -1 : 1;
  }
  if (left.roundId !== right.roundId) {
    return left.roundId > right.roundId ? -1 : 1;
  }
  return 0;
}

function writeCache(key: string, value: PredictionHistoryPayload) {
  historyCache.delete(key);
  historyCache.set(key, { value, timestamp: Date.now() });
  while (historyCache.size > HISTORY_CACHE_MAX_ENTRIES) {
    const oldestKey = historyCache.keys().next().value;
    if (oldestKey === undefined) break;
    historyCache.delete(oldestKey);
  }
}

function json(value: unknown, status = 200) {
  return NextResponse.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}
