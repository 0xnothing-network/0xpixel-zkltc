/**
 * Custom hook for fetching candlestick (OHLC) data from Subgraph
 * Uses TanStack Query for caching and automatic refetching
 */
import { useQuery } from '@tanstack/react-query';

// Subgraph URL
const SUBGRAPH_URL = 'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.2/gn';

// ============================================================
// TYPES
// ============================================================

export interface CandleData {
  time: number; // Unix timestamp in seconds
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
  token0: string; // NUSD address (checksummed from contract)
  token1: string; // The other token (checksummed from contract)
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

// ============================================================
// GRAPHQL QUERY
// ============================================================

const SWAP_EVENTS_QUERY = `
  query GetSwapEvents($token0: String!, $token1: String!) {
    swaps(
      first: 1000,
      orderBy: timestamp,
      orderDirection: asc,
      where: {
        or: [
          { tokenIn: $token0, tokenOut: $token1 },
          { tokenIn: $token1, tokenOut: $token0 }
        ]
      }
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

// ============================================================
// MAIN HOOK
// ============================================================

export function useCandleData({
  pairId,
  token0,
  token1,
  intervalMinutes,
  subgraphUrl = SUBGRAPH_URL,
  enabled = true,
}: UseCandleDataParams): UseCandleDataReturn {
  // Subgraph addresses may be lowercase or checksummed - normalize
  const t0 = token0 ? token0.toLowerCase() : '';
  const t1 = token1 ? token1.toLowerCase() : '';

  const {
    data: rawSwaps,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['candle-data', pairId, t0, t1, intervalMinutes],
    queryFn: async () => {
      const response = await fetch(subgraphUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: SWAP_EVENTS_QUERY,
          variables: { token0: t0, token1: t1 },
        }),
      });

      if (!response.ok) {
        throw new Error(`Subgraph request failed: ${response.status}`);
      }

      const json = await response.json();
      if (json.errors) {
        throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
      }

      const allSwaps: SwapEvent[] = json.data?.swaps || [];
      // Filter client-side to ensure exact match (subgraph may return loosely matched)
      return allSwaps.filter((s) => {
        const ti = (s.tokenIn || '').toLowerCase();
        const to = (s.tokenOut || '').toLowerCase();
        return (ti === t0 && to === t1) || (ti === t1 && to === t0);
      });
    },
    enabled: !!subgraphUrl && !!enabled && !!t0 && !!t1,
    staleTime: 3 * 1000,
    refetchInterval: 5 * 1000,
    retry: 2,
  });

  // Group raw swaps into OHLC candles
  const candles = buildCandles(rawSwaps || [], intervalMinutes, t0, t1);

  return {
    candles,
    rawSwaps: rawSwaps || [],
    isLoading,
    isError,
    error: error as Error | null,
    refetch,
  };
}

// ============================================================
// CANDLE BUILDER
// ============================================================

/**
 * Groups raw swap events into OHLC candles.
 * Price convention: N per NUSD (N is the quote token)
 * - NUSD (t0) → Token (t1): price = amountOut / amountIn
 * - Token (t1) → NUSD (t0): price = amountIn / amountOut
 */
function buildCandles(swaps: SwapEvent[], intervalMinutes: number, t0: string, t1: string): CandleData[] {
  if (!swaps || swaps.length === 0) return [];

  const interval = intervalMinutes * 60;
  const candles: CandleData[] = [];
  let current: CandleData | null = null;

  // The subgraph emits amountIn AFTER the 1% sender-side fee was deducted.
  // Both chart and swap UI use (amountIn, amountOut) from the same subgraph event,
  // so the raw ratio amountOut/amountIn gives the executed price — consistent
  // with what the swap UI estimates when using the same event data.
  // No separate fee reversal needed here.

  // Subgraph query returns swaps sorted asc by timestamp, but guard with sort anyway.
  const sorted = [...swaps].sort(
    (a, b) => Number(a.timestamp) - Number(b.timestamp)
  );

  for (const swap of sorted) {
    const amountIn = Number(swap.amountIn);
    const amountOut = Number(swap.amountOut);
    const ti = (swap.tokenIn || '').toLowerCase();
    const to = (swap.tokenOut || '').toLowerCase();

    if (amountIn <= 0 || amountOut <= 0) continue;

    // NUSD (t0) / Token (t1) pair: price = Token per 1 NUSD.
    // NUSD→Token (t0→t1): price = amountOut / amountIn (Token received per NUSD spent).
    // Token→NUSD (t1→t0): price = amountIn / amountOut (Token received per NUSD spent).
    let price: number;
    if (ti === t0 && to === t1) {
      price = amountOut / amountIn;
    } else if (ti === t1 && to === t0) {
      price = amountIn / amountOut;
    } else {
      continue;
    }

    if (!isFinite(price) || price <= 0) continue;

    const timestampNum = Number(swap.timestamp);
    const candleTime = Math.floor(timestampNum / interval) * interval;

    if (!current || current.time !== candleTime) {
      if (current) candles.push(current);
      current = {
        time: candleTime,
        open: price,
        high: price,
        low: price,
        close: price,
      };
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }

  if (current) candles.push(current);
  return candles;
}

// ============================================================
// UTILITY EXPORTS
// ============================================================

export const TIMEFRAME_OPTIONS = [
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '1h', value: 60 },
] as const;

export type TimeframeValue = (typeof TIMEFRAME_OPTIONS)[number]['value'];
