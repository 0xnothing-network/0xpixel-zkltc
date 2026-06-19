import { NextResponse } from "next/server";
import {
  buildLeaderboard,
  getNext7UtcMs,
  type LeaderboardData,
} from "@/lib/leaderboard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let cached: LeaderboardData | null = null;
let lastFetch = 0;
const ACTIVE_TTL = 60_000;

function serialize(data: LeaderboardData) {
  return {
    entries: data.entries.map((e) => ({
      address: e.address,
      rigCount: e.rigCount,
      totalMined: e.totalMined.toString(),
    })),
    totalRigs: data.totalRigs,
    totalMined: data.totalMined.toString(),
    uniqueMiners: data.uniqueMiners,
    refreshedAt: data.refreshedAt,
    nextRefreshAt: data.nextRefreshAt,
  };
}

export async function GET() {
  const now = Date.now();
  const next7 = getNext7UtcMs(now);
  const shouldRefresh = !cached || now - lastFetch > ACTIVE_TTL;

  if (shouldRefresh) {
    try {
      cached = await buildLeaderboard();
      lastFetch = now;
    } catch (err) {
      console.error("[leaderboard] build error:", err);
      if (cached) {
        return NextResponse.json({
          ...serialize(cached),
          stale: true,
        });
      }
      return NextResponse.json(
        { error: "Leaderboard temporarily unavailable" },
        { status: 503 }
      );
    }
  }

  return NextResponse.json(serialize(cached!));
}
