/**
 * Chart data pre-warming system.
 *
 * When the app loads, this module fetches candlestick data for a list of
 * "priority pairs" and stores results in sessionStorage.
 * CandleChart / useCandleData then reads from sessionStorage first,
 * making chart open near-instantly for pre-warmed pairs.
 */
import { buildCandles } from '@/app/hooks/useCandleData';
import { SwapEvent } from '@/app/hooks/useCandleData';

const SUBGRAPH_URL =
  typeof window !== 'undefined'
    ? '/api/subgraph' // Use local proxy on client to bypass CORS and 429s
    : process.env.SUBGRAPH_URL ||
      process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
      'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

const PREWARM_PAIRS: Array<{ pairId: string; token0: string; token1: string; intervalMinutes: number }> = [
  { pairId: '', token0: '', token1: '', intervalMinutes: 5 }, // placeholder — replaced dynamically
];

function getDaysBack(intervalMinutes: number): number {
  if (intervalMinutes <= 1) return 3;
  if (intervalMinutes <= 5) return 7;
  if (intervalMinutes <= 15) return 14;
  if (intervalMinutes <= 60) return 21;
  if (intervalMinutes <= 240) return 30;
  if (intervalMinutes <= 1440) return 60;
  if (intervalMinutes <= 10080) return 180;
  return 365;
}

const FULL_QUERY = `
  query GetAllSwaps($timestampGte: String!, $limit: Int!) {
    swaps(
      first: $limit,
      orderBy: timestamp,
      orderDirection: asc,
      where: { timestamp_gte: $timestampGte }
    ) {
      id
      timestamp
      amountIn
      amountOut
      tokenIn
      tokenOut
      fee
    }
  }
`;

async function fetchSwaps(
  url: string,
  t0: string,
  t1: string,
  timestampGte: number,
): Promise<SwapEvent[]> {
  const out: SwapEvent[] = [];
  let cursor = timestampGte - 1;
  const seen = new Set<string>();

  while (out.length < 5000) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: FULL_QUERY, variables: { timestampGte: String(cursor), limit: 500 } }),
    });

    if (!res.ok) break;
    const json = await res.json();
    const page = (json.data?.swaps as SwapEvent[] | undefined) || [];
    if (page.length === 0) break;

    for (const s of page) {
      const ti = s.tokenIn.toLowerCase();
      const to = s.tokenOut.toLowerCase();
      if (
        ((ti === t0 && to === t1) || (ti === t1 && to === t0)) &&
        !seen.has(s.id)
      ) {
        seen.add(s.id);
        out.push(s);
      }
    }

    const lastTs = Number(page[page.length - 1].timestamp);
    if (lastTs <= cursor || page.length < 500) break;
    cursor = lastTs;
  }

  return out;
}

function cacheKey(pairId: string, t0: string, t1: string, intervalMinutes: number): string {
  return `candles:${pairId}:${t0}:${t1}:${intervalMinutes}`;
}

export async function prewarmPair(
  pairId: string,
  token0: string,
  token1: string,
  intervalMinutes = 5,
): Promise<void> {
  if (!pairId || !token0 || !token1) return;

  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const ck = cacheKey(pairId, t0, t1, intervalMinutes);

  // Skip if already cached and fresh enough (< 2 min old)
  try {
    const existing = sessionStorage.getItem(ck + ':ts');
    if (existing) {
      const age = Date.now() - Number(existing);
      if (age < 120_000) return; // still fresh enough
    }
  } catch {}

  try {
    const t0c = t0;
    const t1c = t1;
    const daysBack = getDaysBack(intervalMinutes);
    const timestampGte = Math.floor(Date.now() / 1000) - daysBack * 86400;

    const swaps = await fetchSwaps(SUBGRAPH_URL, t0c, t1c, timestampGte);
    if (swaps.length === 0) return;

    // Store swaps + timestamp
    sessionStorage.setItem(ck, JSON.stringify(swaps));
    sessionStorage.setItem(ck + ':ts', String(Date.now()));

    // Also pre-warm other timeframes for the same pair (1m, 15m, 1h)
    const otherTFs = [1, 15, 60].filter(tf => tf !== intervalMinutes);
    await Promise.all(
      otherTFs.map(tf =>
        (async () => {
          const ck2 = cacheKey(pairId, t0c, t1c, tf);
          try {
            if (sessionStorage.getItem(ck2)) return;
            const days = getDaysBack(tf);
            const ts2 = Math.floor(Date.now() / 1000) - days * 86400;
            const sw = await fetchSwaps(SUBGRAPH_URL, t0c, t1c, ts2);
            if (sw.length > 0) {
              sessionStorage.setItem(ck2, JSON.stringify(sw));
              sessionStorage.setItem(ck2 + ':ts', String(Date.now()));
            }
          } catch {}
        })(),
      ),
    );
  } catch {
    // Silent — pre-warm failure should never break UX
  }
}

/**
 * Pre-warm chart data for a list of pool options (called once on mount).
 * Each pool option should have: pairId, token, token0, token1 (nusd).
 */
export function prewarmPools(
  pools: Array<{ pairId: string; token: string; nusd: string }>,
  topN = 5,
): void {
  if (typeof window === 'undefined') return;
  const slice = pools.slice(0, topN);
  slice.forEach(pool => {
    if (!pool.pairId) return;
    // Fetch async, don't await — fire and forget
    prewarmPair(pool.pairId, pool.nusd || '', pool.token || '', 5);
    prewarmPair(pool.pairId, pool.nusd || '', pool.token || '', 60);
  });
}
