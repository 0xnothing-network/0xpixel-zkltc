import { NextResponse } from "next/server";
import { loadDexInitialLiquidity } from "@/lib/dexInitialLiquidity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await loadDexInitialLiquidity();
    return NextResponse.json(data, {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[dex] failed to load initial liquidity:", error);
    return NextResponse.json(
      { error: "Initial pool prices are temporarily unavailable" },
      { status: 503 },
    );
  }
}
