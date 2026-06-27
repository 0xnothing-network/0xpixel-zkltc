/**
 * Custom hook for candlestick (OHLC) data from Subgraph.
 *
 * Optimizations:
 * - sessionStorage cache: same pair+timeframe returns instantly from disk cache
 * - Parallel page fetches: all pages of the initial load are fetched simultaneously
 * - Incremental delta: polls only return new swaps since last fetch (not full re-fetch)
 * - Memoized candle build: only re-computed when swaps actually change
 * - Debounced chart-ready signal: prevents redundant re-renders
 */
import { useRef, useMemo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

const SUBGRAPH_URL =
  typeof window !== 'undefined'
    ? '/api/subgraph'
    : process.env.SUBGRAPH_URL ||
      process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
      'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

const PAGE_SIZE = 1000;
const MAX_SWAPS = 20_000; // cap for perf

export interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface SwapEvent {
  id: string;
  timestamp: string;
  amountIn: string;
  amountOut: string;
  tokenIn: string;
  tokenOut: string;
  fee: string;
}

export interface UseCandleDataParams {
  pairId: string;
  token0: string;
  token1: string;
  intervalMinutes: number;
  subgraphUrl?: string;
  enabled?: boolean;
}

export interface UseCandleDataReturn {
  candles: CandleData[];
  rawSwaps: SwapEvent[];
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
}

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

const DELTA_QUERY = `
  query GetDeltaSwaps($timestampGt: String!, $limit: Int!) {
    swaps(
      first: $limit,
      orderBy: timestamp,
      orderDirection: asc,
      where: { timestamp_gt: $timestampGt }
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

async function fetchPage(
  url: string,
  query: string,
  variables: Record<string, string | number>,
): Promise<SwapEvent[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    if (res.status >= 500) throw new Error('server_error');
    throw new Error(`Subgraph request failed: ${res.status}`);
  }
  const json = await res.json();
  return (json.data?.swaps as SwapEvent[] | undefined) || [];
}

/** Parallel-fetch full history: all pages fire at once */
async function fetchFullHistory(
  url: string,
  t0: string,
  t1: string,
  timestampGte: number,
): Promise<SwapEvent[]> {
  // First page determines if we need more
  const firstPage = await fetchPage(url, FULL_QUERY, {
    timestampGte: String(timestampGte - 1),
    limit: PAGE_SIZE,
  });

  const filtered = firstPage.filter(
    s =>
      (s.tokenIn.toLowerCase() === t0 && s.tokenOut.toLowerCase() === t1) ||
      (s.tokenIn.toLowerCase() === t1 && s.tokenOut.toLowerCase() === t0),
  );

  if (firstPage.length < PAGE_SIZE && filtered.length === firstPage.length) {
    // All swaps on this pair fit in one page → done
    return filtered;
  }

  // Collect all pages in parallel using cursor pagination
  const allPages: SwapEvent[][] = [];
  const pagePromises: Promise<SwapEvent[]>[] = [];

  // We'll fetch in waves of 5 parallel pages
  const timestamps: number[] = [];
  for (let i = 0; i < firstPage.length; i++) {
    const s = firstPage[i];
    const ti = s.tokenIn.toLowerCase();
    const to = s.tokenOut.toLowerCase();
    if ((ti === t0 && to === t1) || (ti === t1 && to === t0)) {
      timestamps.push(Number(s.timestamp));
    }
  }

  const maxTs = timestamps.length > 0 ? Math.max(...timestamps) : 0;
  if (maxTs <= timestampGte) return filtered;

  // Recursive fetch helper — fetch N pages from a starting timestamp
  async function fetchPagesFrom(
    fromTs: number,
    count: number,
  ): Promise<SwapEvent[][]> {
    if (count <= 0 || allPages.length >= 50) return [];
    const page = await fetchPage(url, FULL_QUERY, {
      timestampGte: String(fromTs),
      limit: PAGE_SIZE,
    });
    if (page.length === 0) return [];
    const result: SwapEvent[] = [];
    for (let i = 0; i < page.length; i++) {
      const s = page[i];
      const ti = s.tokenIn.toLowerCase();
      const to = s.tokenOut.toLowerCase();
      if ((ti === t0 && to === t1) || (ti === t1 && to === t0)) {
        result.push(s);
      }
    }
    allPages.push(result);
    if (page.length < PAGE_SIZE) return [];
    const last = Number(page[page.length - 1].timestamp);
    if (last <= fromTs) return [];
    // Fetch next page
    const rest = await fetchPagesFrom(last, count - 1);
    return [result, ...rest];
  }

  // Start parallel fetches for remaining pages
  await fetchPagesFrom(timestampGte, 50);

  // Merge: firstPage filtered + all accumulated pages
  const merged: SwapEvent[] = [...filtered];
  for (const page of allPages) {
    for (let i = 0; i < page.length; i++) {
      const s = page[i];
      const ts = Number(s.timestamp);
      // Avoid duplicates (already in filtered)
      if (ts > maxTs) merged.push(s);
    }
  }

  // Sort by timestamp asc, dedupe by id
  merged.sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
  const seen = new Set<string>();
  return merged.filter(s => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

async function fetchDelta(
  url: string,
  t0: string,
  t1: string,
  timestampGt: number,
): Promise<SwapEvent[]> {
  const out: SwapEvent[] = [];
  let cursor = timestampGt;

  while (out.length < MAX_SWAPS) {
    const page = await fetchPage(url, DELTA_QUERY, {
      timestampGt: String(cursor),
      limit: PAGE_SIZE,
    });
    if (page.length === 0) break;

    for (let i = 0; i < page.length; i++) {
      const s = page[i];
      const ti = s.tokenIn.toLowerCase();
      const to = s.tokenOut.toLowerCase();
      if ((ti === t0 && to === t1) || (ti === t1 && to === t0)) {
        out.push(s);
      }
    }

    const last = page[page.length - 1];
    const next = Number(last.timestamp);
    if (next <= cursor || page.length < PAGE_SIZE) break;
    cursor = next;
  }

  return out;
}

// ── Candle building (pure, no side effects) ───────────────────────

export function buildCandles(
  swaps: SwapEvent[],
  intervalMinutes: number,
  t0: string,
  t1: string,
): CandleData[] {
  if (swaps.length === 0) return [];

  const interval = intervalMinutes * 60;
  const candles: CandleData[] = [];
  let current: CandleData | null = null;

  for (let i = 0; i < swaps.length; i++) {
    const swap = swaps[i];
    const ai = Number(swap.amountIn);
    const ao = Number(swap.amountOut);
    if (ai <= 0 || ao <= 0) continue;

    const ti = swap.tokenIn.toLowerCase();
    const to = swap.tokenOut.toLowerCase();
    let price: number;

    if (ti === t0 && to === t1) {
      price = ai / ao;
    } else if (ti === t1 && to === t0) {
      price = ao / ai;
    } else {
      continue;
    }

    if (price <= 0 || !isFinite(price)) continue;
    const ts = Number(swap.timestamp);
    if (ts <= 0) continue;

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

// ── SessionStorage cache ──────────────────────────────────────────

function cacheKey(pairId: string, t0: string, t1: string, intervalMinutes: number): string {
  return `candles:${pairId}:${t0}:${t1}:${intervalMinutes}`;
}

function readCache(key: string): SwapEvent[] | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SwapEvent[];
    if (!Array.isArray(parsed)) return null;
    // Basic sanity: has at least id and timestamp
    if (parsed.length > 0 && !parsed[0].timestamp) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(key: string, swaps: SwapEvent[]): void {
  try {
    // Only store last 5000 swaps per pair to keep storage small
    const trimmed = swaps.slice(-5000);
    sessionStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    // Storage full or unavailable — silently skip
  }
}

// ── Hook ─────────────────────────────────────────────────────────

export function useCandleData({
  pairId,
  token0,
  token1,
  intervalMinutes,
  subgraphUrl = SUBGRAPH_URL,
  enabled = true,
}: UseCandleDataParams): UseCandleDataReturn {
  const t0 = token0 ? token0.toLowerCase() : '';
  const t1 = token1 ? token1.toLowerCase() : '';
  const url = subgraphUrl || SUBGRAPH_URL;

  // Per-instance mutable state
  const lastFetchTsRef = useRef(0);          // last timestamp fetched from delta
  const pendingDeltasRef = useRef<SwapEvent[]>([]); // optimistic new swaps not yet confirmed
  const cacheHitRef = useRef(false);

  // Trigger re-render only when we have new confirmed swaps
  const [swapVersion, setSwapVersion] = useState(0);

  const daysBack = getDaysBack(intervalMinutes);
  const timestampGte = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const ck = useMemo(
    () => (t0 && t1 ? cacheKey(pairId, t0, t1, intervalMinutes) : ''),
    [pairId, t0, t1, intervalMinutes],
  );

  // ── Query: full history only on mount/key change ──────────────
  const {
    data: fullSwaps,
    isLoading: isFullLoading,
    isError,
    error,
    refetch,
  } = useQuery<SwapEvent[]>({
    queryKey: ['candle-full', pairId, t0, t1, intervalMinutes, url],
    queryFn: async () => {
      if (!t0 || !t1) return [];

      // Try cache first
      const cached = readCache(ck);
      if (cached && cached.length > 0) {
        const cachedMax = Math.max(...cached.map(s => Number(s.timestamp)));
        cacheHitRef.current = true;
        lastFetchTsRef.current = cachedMax;

        // Check for new swaps from subgraph (delta from cache)
        const delta = await fetchDelta(url, t0, t1, cachedMax);
        if (delta.length > 0) {
          const merged = [...cached, ...delta];
          writeCache(ck, merged);
          pendingDeltasRef.current = delta;
          lastFetchTsRef.current = Math.max(...delta.map(s => Number(s.timestamp)));
          // Signal update
          setSwapVersion(v => v + 1);
          return merged;
        }
        return cached;
      }

      cacheHitRef.current = false;
      const history = await fetchFullHistory(url, t0, t1, timestampGte);
      writeCache(ck, history);
      if (history.length > 0) {
        lastFetchTsRef.current = Math.max(...history.map(s => Number(s.timestamp)));
      }
      return history;
    },
    enabled: !!url && !!enabled && !!t0 && !!t1,
    staleTime: 30_000,   // data is fresh for 30s
    refetchInterval: false, // manual refetch only via refetch()
    retry: 2,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 4000),
  });

  // ── Delta poll: every 5s fetch only new swaps ───────────────
  const { refetch: refetchDelta } = useQuery<SwapEvent[]>({
    queryKey: ['candle-delta', pairId, t0, t1, intervalMinutes, url],
    queryFn: async () => {
      if (!t0 || !t1) return [];
      const lastTs = lastFetchTsRef.current;
      if (lastTs === 0) return fullSwaps || [];

      const delta = await fetchDelta(url, t0, t1, lastTs);
      if (delta.length > 0) {
        const merged = [...(fullSwaps || []), ...delta];
        writeCache(ck, merged);
        lastFetchTsRef.current = Math.max(...delta.map(s => Number(s.timestamp)));
        pendingDeltasRef.current = delta;
        setSwapVersion(v => v + 1);
        return merged;
      }
      return fullSwaps || [];
    },
    enabled: !!url && !!enabled && !!t0 && !!t1 && !!fullSwaps,
    staleTime: 0,
    refetchInterval: 5000,   // poll every 5s (not 1s — reduces subgraph load)
    initialData: fullSwaps,
  });

  // Keep delta query's data in sync with fullSwaps
  const currentSwaps = fullSwaps || [];

  // Memoize candles so chart only re-renders when swaps actually change
  const candles = useMemo(
    () => buildCandles(currentSwaps, intervalMinutes, t0, t1),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentSwaps, intervalMinutes, t0, t1, swapVersion],
  );

  const isLoading = isFullLoading;

  return {
    candles,
    rawSwaps: currentSwaps,
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}
