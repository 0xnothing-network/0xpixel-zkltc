import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

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

export interface CandlesResponse {
  candles: CandleData[];
  count: number;
  interval: number;
  source?: 'indexed-candles' | 'hybrid' | 'onchain' | 'unavailable';
  complete?: boolean;
  indexedBlock?: number | null;
  hasIndexingErrors?: boolean;
  latestPrice?: { price: number; timestamp: number; source?: string } | null;
  upstreamError?: string;
}

export interface UseCandleDataReturn {
  candles: CandleData[];
  rawSwaps: SwapEvent[];
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: Error | null;
  refetch: () => void;
  latestPrice: { price: number; timestamp: number } | null;
  source: 'indexed-candles' | 'hybrid' | 'onchain' | 'unavailable';
  complete: boolean;
  indexedBlock: number | null;
  hasIndexingErrors: boolean;
  upstreamError: string | null;
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

interface StoredResponse {
  version: 31;
  savedAt: number;
  response: CandlesResponse;
}

export const CANDLE_QUERY_KEY = 'candles-edge-v31';
const CANDLE_SESSION_CACHE_PREFIX = 'candles:v31';
const SUPPORTED_INTERVALS = new Set([15, 60, 240, 1440]);
const SESSION_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function toFiniteNumber(value: unknown) {
  if (isFiniteNumber(value)) return value;
  if (typeof value !== 'string') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeTime(value: unknown) {
  const direct = toFiniteNumber(value);
  if (direct !== null) return Math.floor(direct);
  if (typeof value !== 'object' || value === null) return null;
  const seconds = toFiniteNumber((value as { seconds?: unknown }).seconds);
  return seconds === null ? null : Math.floor(seconds);
}

function sanitizeCandles(input: unknown): CandleData[] {
  if (!Array.isArray(input)) return [];

  const byTime = new Map<number, CandleData>();
  for (const item of input) {
    const raw = item as Partial<CandleData> | null;
    const time = normalizeTime(raw?.time);
    const open = toFiniteNumber(raw?.open);
    const high = toFiniteNumber(raw?.high);
    const low = toFiniteNumber(raw?.low);
    const close = toFiniteNumber(raw?.close);

    if (
      time === null ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      continue;
    }

    const normalized = {
      time,
      open,
      high: Math.max(high, open, close),
      low: Math.min(low, open, close),
      close,
    };
    const previous = byTime.get(time);
    byTime.set(time, previous
      ? {
          time,
          open: previous.open,
          high: Math.max(previous.high, normalized.high),
          low: Math.min(previous.low, normalized.low),
          close: normalized.close,
        }
      : normalized);
  }

  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

function staleTimeFor(intervalMinutes: number) {
  if (intervalMinutes <= 15) return 10_000;
  if (intervalMinutes <= 60) return 20_000;
  if (intervalMinutes <= 240) return 45_000;
  return 90_000;
}

function refetchIntervalFor(intervalMinutes: number) {
  if (intervalMinutes <= 15) return 15_000;
  if (intervalMinutes <= 60) return 30_000;
  if (intervalMinutes <= 240) return 60_000;
  return 120_000;
}

function normalizePriceTimestamp(value: unknown) {
  const parsed = toFiniteNumber(value);
  if (parsed === null || parsed <= 0) return Date.now();
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
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

export function getCandlesCacheKey(
  token0: string,
  token1: string,
  intervalMinutes: number,
  token0Decimals = 18,
  token1Decimals = 18,
) {
  return `${token0.toLowerCase()}:${token1.toLowerCase()}:${intervalMinutes}:${token0Decimals}:${token1Decimals}`;
}

function readCachedResponse(cacheKey: string): CandlesResponse | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    const raw = sessionStorage.getItem(`${CANDLE_SESSION_CACHE_PREFIX}:${cacheKey}`);
    if (!raw) return undefined;
    const stored = JSON.parse(raw) as Partial<StoredResponse>;
    if (
      stored.version !== 31 ||
      !isFiniteNumber(stored.savedAt) ||
      Date.now() - stored.savedAt > SESSION_CACHE_MAX_AGE_MS ||
      !stored.response
    ) {
      return undefined;
    }

    const interval = Number(stored.response.interval);
    return {
      ...stored.response,
      interval,
      candles: sanitizeCandles(stored.response.candles),
    };
  } catch {
    return undefined;
  }
}

function writeCachedResponse(cacheKey: string, response: CandlesResponse) {
  if (typeof window === 'undefined') return;
  try {
    const stored: StoredResponse = { version: 31, savedAt: Date.now(), response };
    sessionStorage.setItem(
      `${CANDLE_SESSION_CACHE_PREFIX}:${cacheKey}`,
      JSON.stringify(stored),
    );
  } catch {}
}

export function getCachedCandlesResponse(
  token0: string,
  token1: string,
  intervalMinutes: number,
  token0Decimals = 18,
  token1Decimals = 18,
) {
  return readCachedResponse(
    getCandlesCacheKey(token0, token1, intervalMinutes, token0Decimals, token1Decimals),
  );
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
    pairId.toLowerCase(),
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
  const normalizedToken0 = token0.toLowerCase();
  const normalizedToken1 = token1.toLowerCase();
  if (
    !normalizedToken0 ||
    !normalizedToken1 ||
    !SUPPORTED_INTERVALS.has(intervalMinutes)
  ) {
    return { candles: [], count: 0, interval: intervalMinutes, source: 'unavailable' };
  }

  const params = new URLSearchParams({
    token0: normalizedToken0,
    token1: normalizedToken1,
    interval: String(intervalMinutes),
    token0Decimals: String(token0Decimals),
    token1Decimals: String(token1Decimals),
  });
  const separator = subgraphUrl.includes('?') ? '&' : '?';
  const timeout = createTimeoutSignal(requestSignal, 22_000);

  try {
    const response = await fetch(`${subgraphUrl}${separator}${params}`, {
      cache: 'default',
      headers: { Accept: 'application/json' },
      signal: timeout.signal,
    });
    if (!response.ok) throw new Error(`Candles request failed: ${response.status}`);

    const json = await response.json();
    if (json.error) throw new Error(String(json.error));

    const candles = sanitizeCandles(json.candles);
    const parsedLatestPrice = toFiniteNumber(json.latestPrice?.price);
    const latestPrice = parsedLatestPrice !== null && parsedLatestPrice > 0
      ? {
          price: parsedLatestPrice,
          timestamp: Number(json.latestPrice.timestamp ?? 0),
          source: typeof json.latestPrice.source === 'string' ? json.latestPrice.source : undefined,
        }
      : null;

    return {
      candles,
      count: candles.length,
      interval: Number(json.interval ?? intervalMinutes),
      source:
        json.source === 'indexed-candles' ||
        json.source === 'hybrid' ||
        json.source === 'onchain'
          ? json.source
          : 'unavailable',
      complete: Boolean(json.complete),
      indexedBlock: toFiniteNumber(json.indexedBlock),
      hasIndexingErrors: Boolean(json.hasIndexingErrors),
      latestPrice,
      upstreamError: typeof json.upstreamError === 'string' ? json.upstreamError : undefined,
    };
  } finally {
    timeout.cleanup();
  }
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
  const normalizedToken0 = token0.toLowerCase();
  const normalizedToken1 = token1.toLowerCase();
  const cacheKey = getCandlesCacheKey(
    normalizedToken0,
    normalizedToken1,
    intervalMinutes,
    token0Decimals,
    token1Decimals,
  );
  const queryKey = getCandlesQueryKey(
    pairId,
    normalizedToken0,
    normalizedToken1,
    intervalMinutes,
    token0Decimals,
    token1Decimals,
  );

  const [spotPrice, setSpotPrice] = useState<{ price: number; timestamp: number } | null>(() => (
    isFiniteNumber(initialPrice) && initialPrice > 0
      ? { price: initialPrice, timestamp: Date.now() }
      : null
  ));

  useEffect(() => {
    if (isFiniteNumber(initialPrice) && initialPrice > 0) {
      setSpotPrice({ price: initialPrice, timestamp: Date.now() });
    }
  }, [initialPrice]);

  const query = useQuery<CandlesResponse>({
    queryKey,
    queryFn: ({ signal }) => fetchCandlesRequest({
      token0: normalizedToken0,
      token1: normalizedToken1,
      intervalMinutes,
      subgraphUrl,
      token0Decimals,
      token1Decimals,
      requestSignal: signal,
    }),
    enabled: enabled && Boolean(normalizedToken0) && Boolean(normalizedToken1),
    staleTime: staleTimeFor(intervalMinutes),
    gcTime: 30 * 60_000,
    refetchInterval: enabled ? refetchIntervalFor(intervalMinutes) : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 1,
    retryDelay: 750,
    initialData: () => readCachedResponse(cacheKey),
    initialDataUpdatedAt: 0,
  });

  const response = query.data?.interval === intervalMinutes ? query.data : undefined;
  const candles = useMemo(
    () => sanitizeCandles(response?.candles),
    [response?.candles],
  );

  useEffect(() => {
    if (!response) return;
    writeCachedResponse(cacheKey, { ...response, candles });
  }, [cacheKey, candles, response]);

  const indexedLatestPrice = response?.latestPrice && response.latestPrice.price > 0
    ? {
        price: response.latestPrice.price,
        timestamp: normalizePriceTimestamp(response.latestPrice.timestamp),
      }
    : null;
  const latestPrice = spotPrice ?? indexedLatestPrice;
  const triggerRefetch = useCallback(() => {
    void query.refetch();
  }, [query]);

  return {
    candles,
    rawSwaps: [],
    isLoading: query.isPending,
    isFetching: query.isFetching,
    isError: query.isError,
    error: query.error as Error | null,
    refetch: triggerRefetch,
    latestPrice,
    source: response?.source ?? 'unavailable',
    complete: Boolean(response?.complete),
    indexedBlock: response?.indexedBlock ?? null,
    hasIndexingErrors: Boolean(response?.hasIndexingErrors),
    upstreamError: response?.upstreamError ?? null,
  };
}
