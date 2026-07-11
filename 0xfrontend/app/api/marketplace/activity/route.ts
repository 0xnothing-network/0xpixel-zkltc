import { NextResponse } from "next/server";
import {
  fetchMarketplaceActivityFromSubgraph,
  hasMarketplaceSubgraph,
  type SubgraphMarketEventDTO,
  type SubgraphMarketEventType,
} from "@/lib/marketplaceSubgraph";
import { fetchMarketplaceActivityFromOnchain } from "@/lib/onchainMarketplace";
import { publicClient } from "@/lib/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 15;

interface CacheEntry {
  value: { events: SubgraphMarketEventDTO[] };
  ts: number;
}

const ACTIVITY_TTL = 15_000;
const MAX_SUBGRAPH_BLOCK_LAG = 20_000n;
const ACTIVITY_CACHE_MAX_ENTRIES = 256;
const activityCache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = clampNumber(searchParams.get("limit"), 1, 100, 30);
  const skip = clampNumber(searchParams.get("skip"), 0, 10_000, 0);
  const eventTypes = parseEventTypes(searchParams.get("type"));
  const force = searchParams.get("force") === "1";
  const cacheKey = `${limit}:${skip}:${eventTypes.join(",") || "all"}`;
  const cached = activityCache.get(cacheKey);

  if (!force && cached && Date.now() - cached.ts < ACTIVITY_TTL) {
    return NextResponse.json(cached.value);
  }

  let staleSubgraphPayload: { events: SubgraphMarketEventDTO[] } | null = null;

  if (hasMarketplaceSubgraph()) {
    try {
      const payload = await fetchMarketplaceActivityFromSubgraph({
        limit,
        skip,
        eventTypes: eventTypes.length ? eventTypes : undefined,
      });
      const value = { events: payload.events };
      if (await isSubgraphFresh(payload)) {
        writeActivityCache(cacheKey, value);
        return NextResponse.json(value);
      }
      staleSubgraphPayload = value;
      console.warn(
        `[marketplace] subgraph is stale at block ${payload.indexedBlock ?? "unknown"}; using on-chain activity`
      );
    } catch (err) {
      console.warn("[marketplace] activity subgraph failed; using on-chain data:", err);
    }
  }

  try {
    const payload = await fetchMarketplaceActivityFromOnchain({
      limit,
      skip,
      eventTypes: eventTypes.length ? eventTypes : undefined,
    });
    writeActivityCache(cacheKey, payload);
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[marketplace] on-chain activity fallback failed:", err);
    if (staleSubgraphPayload) return NextResponse.json(staleSubgraphPayload);
    if (cached) return NextResponse.json(cached.value);
    return NextResponse.json(
      { error: "Marketplace activity is unavailable" },
      { status: 503 }
    );
  }
}

function writeActivityCache(key: string, value: CacheEntry["value"]) {
  activityCache.delete(key);
  activityCache.set(key, { value, ts: Date.now() });
  while (activityCache.size > ACTIVITY_CACHE_MAX_ENTRIES) {
    const oldestKey = activityCache.keys().next().value;
    if (oldestKey === undefined) break;
    activityCache.delete(oldestKey);
  }
}

async function isSubgraphFresh(payload: {
  indexedBlock: number | null;
  hasIndexingErrors: boolean;
}): Promise<boolean> {
  if (payload.hasIndexingErrors || payload.indexedBlock === null) return false;

  try {
    const currentBlock = await withTimeout(publicClient.getBlockNumber(), 2_500);
    return BigInt(payload.indexedBlock) + MAX_SUBGRAPH_BLOCK_LAG >= currentBlock;
  } catch {
    // An RPC outage should not discard otherwise valid indexed data.
    return true;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("RPC head check timed out")),
      timeoutMs
    );
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function clampNumber(
  raw: string | null,
  min: number,
  max: number,
  fallback: number
): number {
  if (raw === null || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function parseEventTypes(raw: string | null): SubgraphMarketEventType[] {
  if (!raw || raw === "all") return [];
  const values = raw.split(",").map((value) => value.trim().toUpperCase());
  return values.filter(isMarketEventType);
}

function isMarketEventType(value: string): value is SubgraphMarketEventType {
  return value === "MINTED" || value === "LISTED" || value === "BOUGHT" || value === "CANCELLED";
}
