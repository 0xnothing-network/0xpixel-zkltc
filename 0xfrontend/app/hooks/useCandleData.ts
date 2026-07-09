import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatUnits } from 'viem';
import { useReadContract, useWatchContractEvent } from 'wagmi';
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
  initialPrice?: number | null;
  token0Decimals?: number;
  token1Decimals?: number;
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

export interface CandlesResponse {
  candles: CandleData[];
  count: number;
  interval: number;
  latestPrice?: { price: number; timestamp: number; source?: string } | null;
}

export const CANDLE_QUERY_KEY = 'candles-edge-v18';
const SUPPORTED_INTERVALS = new Set([1, 15, 60, 240, 1440]);
const CANDLE_SESSION_CACHE_PREFIX = 'candles:v18';
const SWAP_REFETCH_THROTTLE_MS = 2_500;
const PRICE_SCALE_MAX_RATIO = 100;
const BYTES32_RE = /^0x[a-fA-F0-9]{64}$/;

interface OptimisticCandleState {
  cacheKey: string;
  candles: CandleData[] | null;
}

interface FetchCandlesParams {
  token0: string;
  token1: string;
  intervalMinutes: number;
  subgraphUrl?: string;
  token0Decimals?: number;
  token1Decimals?: number;
  requestSignal?: AbortSignal;
}

type PoolTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

function isBytes32(value: string): value is `0x${string}` {
  return BYTES32_RE.test(value);
}

function isPriceScaleMismatch(left: number | null | undefined, right: number | null | undefined) {
  if (!isFiniteNumber(left) || !isFiniteNumber(right) || left <= 0 || right <= 0) return false;
  const ratio = left / right;
  return ratio > PRICE_SCALE_MAX_RATIO || ratio < 1 / PRICE_SCALE_MAX_RATIO;
}

function resolveAnchoredPrice(candidate: number | null, anchor: number | null | undefined) {
  if (!isFiniteNumber(candidate) || candidate <= 0) return null;
  if (isFiniteNumber(anchor) && anchor > 0 && isPriceScaleMismatch(candidate, anchor)) {
    return anchor;
  }
  return candidate;
}

function priceFromPool(
  pool: PoolTuple | undefined,
  token0: string,
  token1: string,
  token0Decimals: number,
  token1Decimals: number,
) {
  if (!pool || !token0 || !token1) return null;

  const poolToken0 = pool[0].toLowerCase();
  const poolToken1 = pool[1].toLowerCase();
  const chartToken0 = token0.toLowerCase();
  const chartToken1 = token1.toLowerCase();

  const reserveForChartToken0 =
    chartToken0 === poolToken0 ? pool[2] : chartToken0 === poolToken1 ? pool[3] : null;
  const reserveForChartToken1 =
    chartToken1 === poolToken0 ? pool[2] : chartToken1 === poolToken1 ? pool[3] : null;

  if (reserveForChartToken0 === null || reserveForChartToken1 === null || reserveForChartToken1 <= 0n) {
    return null;
  }

  const token0Amount = Number(formatUnits(reserveForChartToken0, token0Decimals));
  const token1Amount = Number(formatUnits(reserveForChartToken1, token1Decimals));
  const price = token0Amount / token1Amount;
  return isFiniteNumber(price) && price > 0 ? price : null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCandleTime(value: unknown): number | null {
  const direct = toFiniteNumber(value);
  if (direct !== null) return Math.floor(direct);

  if (typeof value === 'object' && value !== null) {
    const seconds = toFiniteNumber((value as { seconds?: unknown }).seconds);
    if (seconds !== null) return Math.floor(seconds);
  }

  return null;
}

function sanitizeCandles(candles: unknown): CandleData[] {
  if (!Array.isArray(candles)) return [];

  const valid: CandleData[] = [];
  for (const item of candles) {
    const candle = item as Partial<CandleData> | null | undefined;
    const time = normalizeCandleTime(candle?.time);
    const open = toFiniteNumber(candle?.open);
    const high = toFiniteNumber(candle?.high);
    const low = toFiniteNumber(candle?.low);
    const close = toFiniteNumber(candle?.close);

    if (time === null || open === null || high === null || low === null || close === null) {
      continue;
    }

    valid.push({ time, open, high, low, close });
  }

  valid.sort((a, b) => a.time - b.time);

  const deduped: CandleData[] = [];
  for (const candle of valid) {
    const previous = deduped[deduped.length - 1];
    if (previous?.time === candle.time) {
      deduped[deduped.length - 1] = candle;
    } else if (!previous || candle.time > previous.time) {
      deduped.push(candle);
    }
  }

  return deduped;
}

function candlesEqual(a: CandleData[] | null | undefined, b: CandleData[]) {
  if (!a || a.length !== b.length) return false;
  for (let i = 0; i < b.length; i++) {
    const left = a[i];
    const right = b[i];
    if (
      left.time !== right.time ||
      left.open !== right.open ||
      left.high !== right.high ||
      left.low !== right.low ||
      left.close !== right.close
    ) {
      return false;
    }
  }
  return true;
}

function candleStaleTime(intervalMinutes: number) {
  if (intervalMinutes <= 1) return 3_000;
  if (intervalMinutes <= 15) return 10_000;
  if (intervalMinutes <= 60) return 20_000;
  return 45_000;
}

function candleRefetchInterval(intervalMinutes: number) {
  if (intervalMinutes <= 1) return 4_000;
  if (intervalMinutes <= 15) return 15_000;
  if (intervalMinutes <= 60) return 30_000;
  return 60_000;
}

function createTimeoutSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  const abortFromParent = () => controller.abort(parent?.reason);
  if (parent) {
    if (parent.aborted) abortFromParent();
    else parent.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      globalThis.clearTimeout(timeoutId);
      parent?.removeEventListener('abort', abortFromParent);
    },
  };
}

function readCachedCandles(cacheKey: string): CandleData[] | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(`${CANDLE_SESSION_CACHE_PREFIX}:${cacheKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const candles = sanitizeCandles(parsed);
    return candles.length > 0 ? candles : null;
  } catch {
    return null;
  }
}

function readCachedLatestPrice(priceKey: string): { price: number; timestamp: number } | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = sessionStorage.getItem(`latestPrice:v7:${priceKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<{ price: number; timestamp: number }>;
    if (!isFiniteNumber(parsed.price) || parsed.price <= 0) return null;
    return {
      price: parsed.price,
      timestamp: normalizePriceTimestamp(parsed.timestamp),
    };
  } catch {
    return null;
  }
}

function normalizePriceTimestamp(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed < 0) return Date.now();
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
}

function writeCachedLatestPrice(priceKey: string, latestPrice: { price: number; timestamp: number }) {
  if (typeof window === 'undefined') return;

  try {
    sessionStorage.setItem(`latestPrice:v7:${priceKey}`, JSON.stringify(latestPrice));
  } catch {}
}

export function getCandlesCacheKey(
  token0: string,
  token1: string,
  intervalMinutes: number,
  token0Decimals = 18,
  token1Decimals = 18,
) {
  return `${token0.toLowerCase()}:${token1.toLowerCase()}:${intervalMinutes}:${token0Decimals}:${token1Decimals}`;
}

export function getCachedCandlesResponse(
  token0: string,
  token1: string,
  intervalMinutes: number,
  token0Decimals = 18,
  token1Decimals = 18,
): CandlesResponse | undefined {
  const cacheKey = getCandlesCacheKey(token0, token1, intervalMinutes, token0Decimals, token1Decimals);
  const candles = readCachedCandles(cacheKey);
  return candles
    ? { candles, count: candles.length, interval: intervalMinutes }
    : undefined;
}

function getPriceCacheKey(token0: string, token1: string, token0Decimals = 18, token1Decimals = 18) {
  return `${token0.toLowerCase()}:${token1.toLowerCase()}:${token0Decimals}:${token1Decimals}`;
}

function isResponseForInterval(
  response: CandlesResponse | null | undefined,
  intervalMinutes: number,
): response is CandlesResponse {
  return response?.interval === intervalMinutes;
}

export function getCandlesQueryKey(
  pairId: string,
  token0: string,
  token1: string,
  intervalMinutes: number,
  token0Decimals = 18,
  token1Decimals = 18,
) {
  return [
    CANDLE_QUERY_KEY,
    pairId,
    token0.toLowerCase(),
    token1.toLowerCase(),
    intervalMinutes,
    token0Decimals,
    token1Decimals,
  ] as const;
}

export async function fetchCandlesRequest({
  token0,
  token1,
  intervalMinutes,
  subgraphUrl = '/api/candles',
  token0Decimals = 18,
  token1Decimals = 18,
  requestSignal,
}: FetchCandlesParams): Promise<CandlesResponse> {
  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  if (!t0 || !t1 || !SUPPORTED_INTERVALS.has(intervalMinutes)) {
    return { candles: [], count: 0, interval: intervalMinutes };
  }

  const params = new URLSearchParams({
    token0: t0,
    token1: t1,
    interval: String(intervalMinutes),
    token0Decimals: String(token0Decimals),
    token1Decimals: String(token1Decimals),
  });

  const separator = subgraphUrl.includes('?') ? '&' : '?';
  const timeout = createTimeoutSignal(requestSignal, 15_000);
  let res: Response;
  try {
    res = await fetch(`${subgraphUrl}${separator}${params}`, {
      cache: 'default',
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
  } finally {
    timeout.cleanup();
  }

  if (!res.ok) {
    if (res.status >= 500) throw new Error('server_error');
    throw new Error(`Candles request failed: ${res.status}`);
  }

  const json = await res.json();
  if (json.error) throw new Error(json.error);

  const candles = sanitizeCandles(json.candles);
  const latestPrice = json.latestPrice && isFiniteNumber(json.latestPrice.price) && json.latestPrice.price > 0
    ? {
        price: json.latestPrice.price,
        timestamp: isFiniteNumber(json.latestPrice.timestamp) ? json.latestPrice.timestamp : Date.now(),
        source: typeof json.latestPrice.source === 'string' ? json.latestPrice.source : undefined,
      }
    : null;
  return {
    candles,
    count: candles.length,
    interval: Number(json.interval ?? intervalMinutes),
    latestPrice,
  };
}

function isSwapForPair(e: SwappedEvent, t0: string, t1: string): boolean {
  const args = e.args;
  if (!args) return false;

  const { tokenIn, tokenOut } = args;
  const ti = tokenIn.toLowerCase();
  const to = tokenOut.toLowerCase();
  return (ti === t0 && to === t1) || (ti === t1 && to === t0);
}

export function useCandleData({
  pairId,
  token0,
  token1,
  intervalMinutes,
  subgraphUrl = '/api/candles',
  enabled = true,
  initialPrice,
  token0Decimals = 18,
  token1Decimals = 18,
}: UseCandleDataParams): UseCandleDataReturn {
  const t0 = token0 ? token0.toLowerCase() : '';
  const t1 = token1 ? token1.toLowerCase() : '';
  const queryClient = useQueryClient();
  const cacheKey = getCandlesCacheKey(t0, t1, intervalMinutes, token0Decimals, token1Decimals);
  const priceKey = getPriceCacheKey(t0, t1, token0Decimals, token1Decimals);
  const pairIdBytes = isBytes32(pairId) ? pairId : undefined;
  const queryStaleTime = candleStaleTime(intervalMinutes);
  const queryRefetchInterval = candleRefetchInterval(intervalMinutes);
  const lastSwapRefetchAtRef = useRef(0);

  const [latestPrice, setLatestPrice] = useState<{ price: number; timestamp: number } | null>(() => {
    if (isFiniteNumber(initialPrice) && initialPrice > 0) {
      return { price: initialPrice, timestamp: Date.now() };
    }
    return readCachedLatestPrice(priceKey);
  });
  const [optimisticState, setOptimisticState] = useState<OptimisticCandleState>(() => ({
    cacheKey,
    candles: readCachedCandles(cacheKey),
  }));

  const { data: poolData, refetch: refetchPoolData } = useReadContract({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    functionName: 'pools',
    args: pairIdBytes ? [pairIdBytes] : undefined,
    query: {
      enabled: !!enabled && !!pairIdBytes && !!t0 && !!t1,
      staleTime: 1_000,
      gcTime: 60_000,
      refetchInterval: enabled ? Math.min(queryRefetchInterval, 5_000) : false,
      refetchOnMount: 'always',
      refetchOnWindowFocus: false,
    },
  });

  useEffect(() => {
    setOptimisticState({ cacheKey, candles: readCachedCandles(cacheKey) });
  }, [cacheKey]);

  useEffect(() => {
    const seededPrice = isFiniteNumber(initialPrice) && initialPrice > 0
      ? { price: initialPrice, timestamp: Date.now() }
      : readCachedLatestPrice(priceKey);
    setLatestPrice(seededPrice);
  }, [initialPrice, priceKey]);

  useEffect(() => {
    if (!latestPrice) return;
    writeCachedLatestPrice(priceKey, latestPrice);
  }, [latestPrice, priceKey]);

  useEffect(() => {
    const poolPrice = resolveAnchoredPrice(
      priceFromPool(poolData as PoolTuple | undefined, t0, t1, token0Decimals, token1Decimals),
      initialPrice,
    );

    if (poolPrice === null) return;
    setLatestPrice({ price: poolPrice, timestamp: Date.now() });
  }, [poolData, t0, t1, token0Decimals, token1Decimals, initialPrice]);

  const {
    data: candlesResponse,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<CandlesResponse>({
    queryKey: getCandlesQueryKey(pairId, t0, t1, intervalMinutes, token0Decimals, token1Decimals),
    queryFn: ({ signal }) =>
      fetchCandlesRequest({
        token0: t0,
        token1: t1,
        intervalMinutes,
        subgraphUrl,
        token0Decimals,
        token1Decimals,
        requestSignal: signal,
      }),
    enabled: !!enabled && !!t0 && !!t1,
    staleTime: queryStaleTime,
    gcTime: 10 * 60_000,
    refetchInterval: enabled ? queryRefetchInterval : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: attempt => Math.min(500 * 2 ** attempt, 4000),
    initialData: () => getCachedCandlesResponse(t0, t1, intervalMinutes, token0Decimals, token1Decimals),
    initialDataUpdatedAt: 0,
  });

  useEffect(() => {
    if (!isResponseForInterval(candlesResponse, intervalMinutes)) return;

    const validCandles = sanitizeCandles(candlesResponse.candles);
    const subgraphPrice = candlesResponse.latestPrice?.price;
    if (isFiniteNumber(subgraphPrice) && subgraphPrice > 0) {
      const nextLatestPrice = {
        price: subgraphPrice,
        timestamp: normalizePriceTimestamp(candlesResponse.latestPrice?.timestamp),
      };
      setLatestPrice(prev => (
        !prev || nextLatestPrice.timestamp >= prev.timestamp ? nextLatestPrice : prev
      ));
    }

    setOptimisticState(prev => (
      prev.cacheKey === cacheKey && candlesEqual(prev.candles, validCandles)
        ? prev
        : { cacheKey, candles: validCandles }
    ));

    try {
      sessionStorage.setItem(`${CANDLE_SESSION_CACHE_PREFIX}:${cacheKey}`, JSON.stringify(validCandles));
    } catch {}
  }, [candlesResponse, cacheKey, intervalMinutes]);

  const handleSwapLogs = useCallback(
    (logs: readonly unknown[]) => {
      const hasPairSwap = logs.some(log => isSwapForPair(log as SwappedEvent, t0, t1));
      if (!hasPairSwap) return;
      const now = Date.now();
      const shouldRefetch = now - lastSwapRefetchAtRef.current >= SWAP_REFETCH_THROTTLE_MS;
      if (shouldRefetch) lastSwapRefetchAtRef.current = now;

      if (shouldRefetch) {
        void refetchPoolData();
        void queryClient.invalidateQueries({
          queryKey: getCandlesQueryKey(pairId, t0, t1, intervalMinutes, token0Decimals, token1Decimals),
          refetchType: 'active',
        });
      }
    },
    [
      t0,
      t1,
      intervalMinutes,
      queryClient,
      pairId,
      refetchPoolData,
      token0Decimals,
      token1Decimals,
    ],
  );

  useWatchContractEvent({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    eventName: 'Swapped',
    onLogs: logs => handleSwapLogs(logs as readonly unknown[]),
    enabled: !!enabled && !!t0 && !!t1,
  });

  const responseCandles = isResponseForInterval(candlesResponse, intervalMinutes)
    ? candlesResponse.candles
    : [];
  const candles = optimisticState.cacheKey === cacheKey
    ? optimisticState.candles ?? responseCandles
    : responseCandles;

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
