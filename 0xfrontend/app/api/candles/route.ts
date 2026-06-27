/**
 * /api/candles — Server-side OHLCV pre-computation.
 *
 * Runs at the Edge (Vercel Edge Runtime) so it executes on Vercel's
 * distributed network close to Goldsky, minimizing latency.
 *
 * Flow:
 *   1. Client → Vercel Edge (/api/candles)   — < 50ms from Vercel CDN
 *   2. Vercel Edge → Goldsky (if cache miss) — cached at Edge layer
 *   3. OHLCV built ON THE SERVER (no client CPU)
 *   4. Client receives ready-to-paint chart data
 *
 * Caching strategy (Vercel Edge + stale-while-revalidate):
 *   - swr = 60s: stale data served instantly, revalidated in background
 *   - max-age = 30s: fresh data cached for 30s on CDN
 *
 * This eliminates:
 *   - Multiple round-trips for pagination (fetchPage loop)
 *   - OHLCV computation on the client
 *   - SessionStorage cache (no longer needed)
 *   - Pre-warm chart (no longer needed — Edge cache handles it)
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

const PAGE_SIZE = 1000;
const MAX_SWAPS = 20_000;

interface SwapEvent {
  id: string;
  timestamp: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
}

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const FULL_QUERY = `
  query GetCandleSwaps($timestampGte: String!, $limit: Int!) {
    swaps(
      first: $limit
      orderBy: timestamp
      orderDirection: asc
      where: { timestamp_gte: $timestampGte }
    ) {
      id
      timestamp
      amountIn
      amountOut
      tokenIn
      tokenOut
    }
  }
`;

function getDaysBack(intervalMinutes: number): number {
  if (intervalMinutes <= 1)   return 3;
  if (intervalMinutes <= 5)   return 7;
  if (intervalMinutes <= 15)  return 14;
  if (intervalMinutes <= 60) return 21;
  if (intervalMinutes <= 240) return 30;
  if (intervalMinutes <= 1440) return 60;
  if (intervalMinutes <= 10080) return 180;
  return 365;
}

async function fetchSwaps(
  timestampGte: number,
  t0: string,
  t1: string,
): Promise<SwapEvent[]> {
  const out: SwapEvent[] = [];
  let cursor = timestampGte - 1;
  const seen = new Set<string>();

  while (out.length < MAX_SWAPS) {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: FULL_QUERY,
        variables: { timestampGte: String(cursor), limit: PAGE_SIZE },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) break;
    const json = await res.json();
    const page: SwapEvent[] = json.data?.swaps ?? [];

    if (page.length === 0) break;

    for (const s of page) {
      const ti = s.tokenIn.toLowerCase();
      const to = s.tokenOut.toLowerCase();
      if (((ti === t0 && to === t1) || (ti === t1 && to === t0)) && !seen.has(s.id)) {
        seen.add(s.id);
        out.push(s);
      }
    }

    const lastTs = Number(page[page.length - 1].timestamp);
    if (lastTs <= cursor || page.length < PAGE_SIZE) break;
    cursor = lastTs;
  }

  return out;
}

function buildCandles(swaps: SwapEvent[], intervalMinutes: number, t0: string, t1: string): CandleData[] {
  if (swaps.length === 0) return [];

  const interval = intervalMinutes * 60;
  const candles: CandleData[] = [];
  let current: CandleData | null = null;

  for (let i = 0; i < swaps.length; i++) {
    const s = swaps[i];
    const ai = Number(s.amountIn);
    const ao = Number(s.amountOut);
    if (ai <= 0 || ao <= 0) continue;

    const ti = s.tokenIn.toLowerCase();
    const to = s.tokenOut.toLowerCase();
    let price: number;

    if (ti === t0 && to === t1) {
      price = ai / ao;
    } else if (ti === t1 && to === t0) {
      price = ao / ai;
    } else {
      continue;
    }

    if (price <= 0 || !isFinite(price)) continue;
    const rawTs = s.timestamp;
    // Handle both string timestamps ("1700000000") and GraphQL object form ({seconds,nanos})
    const ts = typeof rawTs === 'object' && rawTs !== null
      ? Number((rawTs as { seconds?: string | number; nanos?: number }).seconds ?? 0)
      : Number(rawTs);
    if (ts <= 0 || !isFinite(ts)) continue;

    const candleTime = Math.floor(ts / interval) * interval;

    if (!current || current.time !== candleTime) {
      if (current) candles.push(current);
      current = { time: candleTime, open: price, high: price, low: price, close: price };
    } else {
      if (price > current.high) current.high = price;
      else if (price < current.low) current.low = price;
      current.close = price;
    }
  }

  if (current) candles.push(current);
  return candles;
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token0    = searchParams.get('token0') ?? '';
  const token1    = searchParams.get('token1') ?? '';
  const interval  = parseInt(searchParams.get('interval') ?? '1440', 10);

  if (!token0 || !token1 || !interval) {
    return NextResponse.json({ error: 'Missing token0, token1, or interval' }, { status: 400 });
  }

  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const daysBack = getDaysBack(interval);
  const timestampGte = Math.floor(Date.now() / 1000) - daysBack * 86400;

  try {
    const swaps = await fetchSwaps(timestampGte, t0, t1);
    const candles = buildCandles(swaps, interval, t0, t1);

    return NextResponse.json(
      { candles, count: candles.length, interval, timestampGte },
      {
        headers: {
          'Content-Type': 'application/json',
          // Vercel Edge caching: serve stale for up to 60s, CDN caches for 30s
          'Cache-Control': 'public, max-age=30, s-maxage=30, stale-while-revalidate=60',
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
