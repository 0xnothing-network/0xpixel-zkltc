/**
 * Custom hook for candlestick (OHLC) data.
 *
 * Architecture (optimized for Vercel Edge):
 *
 *   Client → /api/candles (Edge)  ← OHLCV pre-computed on server
 *                    ↓
 *            Goldsky Subgraph (fetched by Edge, cached)
 *                    ↓
 *   Client receives ready-to-paint chart data
 *
 * Real-time updates:
 *   On-chain Swapped events → optimistic candle update (instant, no wait)
 *   Background refetch from Edge → correct candle data replaces optimistic
 *
 * What this replaces vs. the old approach:
 *   ✗ fetchPage() pagination loop          → single /api/candles call
 *   ✗ sessionStorage cache + prewarm       → Edge CDN cache
 *   ✗ buildCandles() on client            → pre-computed on Edge
 *   ✗ Manual delta tracking                → React Query staleTime
 */
import { useRef, useState, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useWatchContractEvent } from 'wagmi';
import { DEX_ADDRESS, DEX_ABI } from '@/lib/0xDexAbi';
import { SwappedEvent } from '@/lib/use0xDex';

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
  latestPrice: { price: number; timestamp: number } | null;
}

interface CandlesResponse {
  candles: CandleData[];
  count: number;
  interval: number;
}

const QUERY_KEY = 'candles-edge';

function priceFromEvent(e: SwappedEvent, t0: string, t1: string): number | null {
  const args = e.args;
  if (!args) return null;
  const { tokenIn, tokenOut, amountIn, amountOut } = args;
  const ti = tokenIn.toLowerCase();
  const to = tokenOut.toLowerCase();
  if (!((ti === t0 && to === t1) || (ti === t1 && to === t0))) return null;

  const ai = Number(amountIn);
  const ao = Number(amountOut);
  if (ai <= 0 || ao <= 0) return null;

  if (ti === t0 && to === t1) return ai > 0 ? ao / ai : 0;
  return ao > 0 ? ai / ao : 0;
}

function applyOptimisticCandle(
  candles: CandleData[],
  price: number,
  intervalMinutes: number,
  invertPrice: boolean,
): CandleData[] {
  if (!candles.length) return candles;

  const interval = intervalMinutes * 60;
  const now = Math.floor(Date.now() / 1000);
  const candleTime = Math.floor(now / interval) * interval;

  const dispPrice = invertPrice && price > 0 ? 1 / price : price;
  const last = candles[candles.length - 1];

  // Guard: skip if last candle has invalid time (prevents lightweight-charts crash)
  if (last && (typeof last.time !== 'number' || !isFinite(last.time))) {
    return candles;
  }

  if (last.time === candleTime) {
    // Update the current (ongoing) candle
    return candles.map((c, i) =>
      i === candles.length - 1
        ? {
            ...c,
            high: Math.max(c.high, dispPrice),
            low: c.low === 0 ? dispPrice : Math.min(c.low, dispPrice),
            close: dispPrice,
          }
        : c,
    );
  } else {
    // New candle period — append
    return [
      ...candles,
      {
        time: candleTime,
        open: dispPrice,
        high: dispPrice,
        low: dispPrice,
        close: dispPrice,
      },
    ];
  }
}

export function useCandleData({
  pairId,
  token0,
  token1,
  intervalMinutes,
  subgraphUrl = '/api/candles',
  enabled = true,
}: UseCandleDataParams): UseCandleDataReturn {
  const t0 = token0 ? token0.toLowerCase() : '';
  const t1 = token1 ? token1.toLowerCase() : '';
  const queryClient = useQueryClient();

  // Stable cache key for sessionStorage
  const cacheKey = `${t0}:${t1}:${intervalMinutes}`;

  // Track latest price from blockchain events (single source of truth)
  const [latestPrice, setLatestPrice] = useState<{ price: number; timestamp: number } | null>(null);

  // Optimistic candles — updated instantly from blockchain events
  const [optimisticCandles, setOptimisticCandles] = useState<CandleData[] | null>(() => {
    // Load from sessionStorage on first mount for instant display
    if (typeof window !== 'undefined' && t0 && t1) {
      try {
        const raw = sessionStorage.getItem(`candles:${cacheKey}`);
        if (raw) {
          const parsed = JSON.parse(raw) as CandleData[];
          // Guard: filter out candles with invalid time to prevent lightweight-charts crash
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed.filter((c) => typeof c?.time === 'number' && isFinite(c.time));
          }
        }
      } catch {}
    }
    return null;
  });

  // Track whether we have a confirmed (server) response
  const confirmedRef = useRef(false);

  // ── Base query: /api/candles ─────────────────────────────
  const {
    data: candlesResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CandlesResponse>({
    queryKey: [QUERY_KEY, pairId, t0, t1, intervalMinutes],
    queryFn: async (): Promise<CandlesResponse> => {
      if (!t0 || !t1) return { candles: [], count: 0, interval: intervalMinutes };

      const params = new URLSearchParams({
        token0: t0,
        token1: t1,
        interval: String(intervalMinutes),
      });

      const res = await fetch(`${subgraphUrl}?${params}`, {
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        if (res.status >= 500) throw new Error('server_error');
        throw new Error(`Candles request failed: ${res.status}`);
      }

      const json = await res.json();
      if (json.error) throw new Error(json.error);
      return json as CandlesResponse;
    },
    enabled: !!enabled && !!t0 && !!t1,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: 2,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 4000),
  });

  // Sync server data into optimistic state when it arrives
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const serverCandles = candlesResponse?.candles ?? [];
  useEffect(() => {
    if (candlesResponse?.candles) {
      confirmedRef.current = true;
      // Guard: filter out candles with invalid time before storing
      const validCandles = candlesResponse.candles.filter(
        (c) => typeof c?.time === 'number' && isFinite(c.time),
      );
      setOptimisticCandles(validCandles);
      // Persist to sessionStorage for instant restore on next mount
      try {
        sessionStorage.setItem(`candles:${cacheKey}`, JSON.stringify(validCandles));
      } catch {}
    }
  }, [serverCandles, cacheKey]);

  // ── Blockchain event: optimistic update ───────────────────
  const handleSwapEvent = useCallback(
    (log: SwappedEvent) => {
      const price = priceFromEvent(log, t0, t1);
      if (price === null || price <= 0) return;

      // Update latest price — single source of truth for both chart and UI
      setLatestPrice({ price, timestamp: Date.now() });

      setOptimisticCandles(prev => {
        const base: CandleData[] = prev ?? candlesResponse?.candles ?? [];
        return applyOptimisticCandle(base, price, intervalMinutes, false);
      });

      // In background: refetch Edge cache (stale-while-revalidate)
      queryClient.invalidateQueries({
        queryKey: [QUERY_KEY, pairId, t0, t1, intervalMinutes],
      });
    },
    [t0, t1, intervalMinutes, candlesResponse, pairId, queryClient],
  );

  useWatchContractEvent({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    eventName: 'Swapped',
    onLogs: (logs) => {
      for (const log of logs) {
        handleSwapEvent(log as unknown as SwappedEvent);
      }
    },
    enabled: !!enabled && !!t0 && !!t1,
  });

  // ── Merge: optimistic if available, else server ──────────
  const candles: CandleData[] = optimisticCandles ?? candlesResponse?.candles ?? [];

  return {
    candles,
    rawSwaps: [],
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
    latestPrice,
  };
}
