import { NextResponse } from "next/server";
import {
  fetchMarketplaceActivityFromSubgraph,
  hasMarketplaceSubgraph,
  type SubgraphMarketEventDTO,
  type SubgraphMarketEventType,
} from "@/lib/marketplaceSubgraph";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 15;

interface CacheEntry {
  value: { events: SubgraphMarketEventDTO[] };
  ts: number;
}

const ACTIVITY_TTL = 15_000;
const activityCache = new Map<string, CacheEntry>();

export async function GET(request: Request) {
  if (!hasMarketplaceSubgraph()) {
    return NextResponse.json({ events: [] });
  }

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

  try {
    const payload = await fetchMarketplaceActivityFromSubgraph({
      limit,
      skip,
      eventTypes: eventTypes.length ? eventTypes : undefined,
    });
    activityCache.set(cacheKey, { value: payload, ts: Date.now() });
    return NextResponse.json(payload);
  } catch (err) {
    console.error("[marketplace] activity fetch failed:", err);
    if (cached) return NextResponse.json(cached.value);
    return NextResponse.json({ events: [] });
  }
}

function clampNumber(
  raw: string | null,
  min: number,
  max: number,
  fallback: number
): number {
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
  return value === "LISTED" || value === "BOUGHT" || value === "CANCELLED";
}
