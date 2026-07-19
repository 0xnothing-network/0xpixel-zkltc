import { NextRequest, NextResponse } from 'next/server';
import { encodePacked, keccak256 } from 'viem';
import {
  loadDexOnchainFallback,
  loadDexPoolSnapshot,
  type DexPoolSnapshot,
} from '@/lib/dexOnchainFallback';
import { DEX_SUBGRAPH_URL } from '@/lib/dexSubgraph';

export const runtime = 'nodejs';
export const maxDuration = 60;

const SUPPORTED_INTERVALS = new Set([15, 60, 240, 1440]);
const PAGE_SIZE = 1000;
const UPSTREAM_TIMEOUT_MS = 4_000;
const MAX_SUBGRAPH_BLOCK_LAG = 20_000;

type CandleSource = 'indexed-candles' | 'hybrid' | 'onchain' | 'unavailable';

interface CandleData {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface IndexedCandle {
  timestamp: string | number | { seconds?: string | number };
  open: string;
  high: string;
  low: string;
  close: string;
}

interface SubgraphMeta {
  hasIndexingErrors?: boolean;
  block?: { number?: string | number } | null;
}

interface CandlesResponseBody {
  candles: CandleData[];
  count: number;
  interval: number;
  source: CandleSource;
  complete: boolean;
  indexedBlock: number | null;
  hasIndexingErrors: boolean;
  latestPrice: {
    price: number;
    timestamp: number;
    source: 'candle' | 'pool';
  } | null;
  upstreamError?: string;
}

interface CachedResponse {
  expiresAt: number;
  body: CandlesResponseBody;
}

const responseCache = new Map<string, CachedResponse>();
const inFlight = new Map<string, Promise<CandlesResponseBody>>();

const CANDLES_QUERY = `
  query GetCandles(
    $pairId: Bytes!
    $interval: Int!
    $limit: Int!
    $after: BigInt!
  ) {
    candles(
      first: $limit
      orderBy: timestamp
      orderDirection: asc
      where: {
        pairId: $pairId
        interval: $interval
        timestamp_gt: $after
      }
    ) {
      timestamp
      open
      high
      low
      close
    }
    _meta {
      hasIndexingErrors
      block { number }
    }
  }
`;

function emptyResponse(
  interval: number,
  source: CandleSource,
  upstreamError?: string,
): CandlesResponseBody {
  return {
    candles: [],
    count: 0,
    interval,
    source,
    complete: source === 'indexed-candles',
    indexedBlock: null,
    hasIndexingErrors: false,
    latestPrice: null,
    ...(upstreamError ? { upstreamError } : {}),
  };
}

function cacheTtlMs(interval: number) {
  if (interval <= 15) return 12_000;
  if (interval <= 60) return 25_000;
  if (interval <= 240) return 60_000;
  return 120_000;
}

function cacheControl(interval: number) {
  if (interval <= 15) return 'public, max-age=0, s-maxage=12, stale-while-revalidate=90';
  if (interval <= 60) return 'public, max-age=0, s-maxage=25, stale-while-revalidate=180';
  if (interval <= 240) return 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
  return 'public, max-age=0, s-maxage=120, stale-while-revalidate=600';
}

function pairIdForTokens(tokenA: string, tokenB: string): `0x${string}` | null {
  try {
    const a = tokenA as `0x${string}`;
    const b = tokenB as `0x${string}`;
    const [first, second] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
    return keccak256(encodePacked(['address', 'address'], [first, second]));
  } catch {
    return null;
  }
}

function parseDecimals(value: string | null, fallback = 18) {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 36 ? parsed : fallback;
}

function timestampOf(value: IndexedCandle['timestamp']) {
  const raw = typeof value === 'object' && value !== null ? value.seconds : value;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

function normalizeOhlc(
  raw: IndexedCandle,
  token0: string,
  token1: string,
  token0Decimals: number,
  token1Decimals: number,
): CandleData | null {
  const time = timestampOf(raw.timestamp);
  let open = Number(raw.open);
  let high = Number(raw.high);
  let low = Number(raw.low);
  let close = Number(raw.close);

  if (
    time === null ||
    ![open, high, low, close].every(value => Number.isFinite(value) && value > 0)
  ) {
    return null;
  }

  const token0IsSortedFirst = BigInt(token0) < BigInt(token1);
  const sortedFirstDecimals = token0IsSortedFirst ? token0Decimals : token1Decimals;
  const sortedSecondDecimals = token0IsSortedFirst ? token1Decimals : token0Decimals;
  const decimalScale = 10 ** (sortedSecondDecimals - sortedFirstDecimals);

  open *= decimalScale;
  high *= decimalScale;
  low *= decimalScale;
  close *= decimalScale;

  // The subgraph stores reserve0/reserve1 for the address-sorted pair. The
  // frontend requests quote/base (NUSD/token), so invert when request token0 is
  // the sorted token1. High and low must swap when a candle is inverted.
  if (!token0IsSortedFirst) {
    const invertedOpen = 1 / open;
    const invertedClose = 1 / close;
    const invertedHigh = 1 / low;
    const invertedLow = 1 / high;
    open = invertedOpen;
    close = invertedClose;
    high = invertedHigh;
    low = invertedLow;
  }

  if (![open, high, low, close].every(value => Number.isFinite(value) && value > 0)) {
    return null;
  }

  return {
    time,
    open,
    high: Math.max(high, open, close),
    low: Math.min(low, open, close),
    close,
  };
}

function mergeCanonicalCandles(candles: CandleData[]) {
  candles.sort((a, b) => a.time - b.time);
  const merged: CandleData[] = [];

  for (const candle of candles) {
    const previous = merged[merged.length - 1];
    if (!previous || candle.time > previous.time) {
      merged.push(candle);
      continue;
    }

    if (candle.time === previous.time) {
      previous.high = Math.max(previous.high, candle.high);
      previous.low = Math.min(previous.low, candle.low);
      previous.close = candle.close;
    }
  }

  return merged;
}

function wait(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchGraphql(
  variables: Record<string, string | number>,
): Promise<{ candles: IndexedCandle[]; meta: SubgraphMeta | null }> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(DEX_SUBGRAPH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: CANDLES_QUERY, variables }),
        cache: 'no-store',
        signal: controller.signal,
      });

      if (response.ok) {
        const json = await response.json();
        if (json.errors?.length) {
          throw new Error(json.errors[0]?.message ?? 'Subgraph query failed');
        }
        return {
          candles: Array.isArray(json.data?.candles) ? json.data.candles : [],
          meta: json.data?._meta ?? null,
        };
      }

      lastError = new Error(`Subgraph request failed: ${response.status}`);
      if (response.status !== 429 && response.status < 500) throw lastError;

      const retryAfter = Number(response.headers.get('retry-after'));
      const delay = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 300 * 2 ** attempt;
      await wait(Math.min(delay, UPSTREAM_TIMEOUT_MS));
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt >= 1) break;
      await wait(300 * 2 ** attempt);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError ?? new Error('Subgraph request failed');
}

async function loadIndexedCandles(
  pairId: `0x${string}`,
  token0: string,
  token1: string,
  interval: number,
  token0Decimals: number,
  token1Decimals: number,
): Promise<CandlesResponseBody> {
  const candles: CandleData[] = [];
  let cursor = -1;
  let complete = false;
  let indexedBlock: number | null = null;
  let hasIndexingErrors = false;

  while (!complete) {
    const page = await fetchGraphql(
      {
        pairId,
        interval,
        limit: PAGE_SIZE,
        after: String(cursor),
      },
    );

    const metaBlock = Number(page.meta?.block?.number);
    if (Number.isFinite(metaBlock)) indexedBlock = metaBlock;
    hasIndexingErrors = Boolean(page.meta?.hasIndexingErrors);

    if (page.candles.length === 0) {
      complete = true;
      break;
    }

    let nextCursor = cursor;
    for (const raw of page.candles) {
      const timestamp = timestampOf(raw.timestamp);
      if (timestamp !== null) nextCursor = Math.max(nextCursor, timestamp);

      const candle = normalizeOhlc(
        raw,
        token0,
        token1,
        token0Decimals,
        token1Decimals,
      );
      if (candle) candles.push(candle);
    }

    if (nextCursor <= cursor) {
      throw new Error('Subgraph candle pagination did not advance');
    }
    cursor = nextCursor;

    if (page.candles.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }

  const canonical = mergeCanonicalCandles(candles);
  const last = canonical[canonical.length - 1];
  return {
    candles: canonical,
    count: canonical.length,
    interval,
    source: 'indexed-candles',
    complete,
    indexedBlock,
    hasIndexingErrors,
    latestPrice: last
      ? { price: last.close, timestamp: last.time, source: 'candle' }
      : null,
  };
}

async function loadCandlesWithFallback({
  pairId,
  token0,
  token1,
  interval,
  token0Decimals,
  token1Decimals,
}: {
  pairId: `0x${string}`;
  token0: string;
  token1: string;
  interval: number;
  token0Decimals: number;
  token1Decimals: number;
}): Promise<CandlesResponseBody> {
  const snapshotPromise: Promise<DexPoolSnapshot | null> = loadDexPoolSnapshot({
    pairId,
    token0,
    token1,
    token0Decimals,
    token1Decimals,
  }).catch((error) => {
    console.warn('[dex] on-chain pool price read failed:', error);
    return null;
  });

  let indexed: CandlesResponseBody | null = null;
  let upstreamError = '';
  try {
    indexed = await loadIndexedCandles(
      pairId,
      token0,
      token1,
      interval,
      token0Decimals,
      token1Decimals,
    );
  } catch (error) {
    upstreamError = error instanceof Error ? error.message : 'Subgraph unavailable';
  }

  const snapshot = await snapshotPromise;
  if (indexed && snapshot) {
    const blockLag = indexed.indexedBlock === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, snapshot.blockNumber - indexed.indexedBlock);
    const needsHistoryFallback =
      indexed.hasIndexingErrors ||
      blockLag > MAX_SUBGRAPH_BLOCK_LAG ||
      indexed.candles.length === 0;

    if (!needsHistoryFallback) {
      return {
        ...indexed,
        latestPrice: {
          price: snapshot.price,
          timestamp: snapshot.timestamp,
          source: 'pool',
        },
      };
    }

    const onchain = await loadDexOnchainFallback({
      pairId,
      token0,
      token1,
      intervalMinutes: interval,
      token0Decimals,
      token1Decimals,
      snapshot,
    });
    const candles = mergeCanonicalCandles([
      ...indexed.candles,
      ...onchain.candles,
    ]);
    const staleReason = indexed.hasIndexingErrors
      ? 'DEX subgraph reports indexing errors'
      : indexed.candles.length === 0
        ? 'DEX subgraph returned no candles'
        : `DEX subgraph is ${blockLag} blocks behind`;

    return {
      candles,
      count: candles.length,
      interval,
      source: indexed.candles.length > 0 ? 'hybrid' : 'onchain',
      complete: false,
      indexedBlock: onchain.blockNumber,
      hasIndexingErrors: indexed.hasIndexingErrors,
      latestPrice: onchain.latestPrice,
      upstreamError: staleReason,
    };
  }

  if (indexed) return indexed;
  if (snapshot) {
    const onchain = await loadDexOnchainFallback({
      pairId,
      token0,
      token1,
      intervalMinutes: interval,
      token0Decimals,
      token1Decimals,
      snapshot,
    });
    return {
      candles: onchain.candles,
      count: onchain.candles.length,
      interval,
      source: 'onchain',
      complete: false,
      indexedBlock: onchain.blockNumber,
      hasIndexingErrors: false,
      latestPrice: onchain.latestPrice,
      ...(upstreamError ? { upstreamError } : {}),
    };
  }

  return emptyResponse(
    interval,
    'unavailable',
    upstreamError || 'Subgraph and on-chain price are unavailable',
  );
}

function pruneCache() {
  if (responseCache.size <= 200) return;
  const now = Date.now();
  for (const [key, value] of responseCache) {
    if (value.expiresAt <= now) responseCache.delete(key);
  }
  while (responseCache.size > 200) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey === undefined) break;
    responseCache.delete(oldestKey);
  }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const token0 = params.get('token0')?.toLowerCase() ?? '';
  const token1 = params.get('token1')?.toLowerCase() ?? '';
  const interval = Number(params.get('interval') ?? 15);
  const token0Decimals = parseDecimals(params.get('token0Decimals'));
  const token1Decimals = parseDecimals(params.get('token1Decimals'));

  if (!SUPPORTED_INTERVALS.has(interval)) {
    return NextResponse.json(
      { error: 'Unsupported candle interval' },
      { status: 400 },
    );
  }

  const pairId = pairIdForTokens(token0, token1);
  if (!pairId) {
    return NextResponse.json({ error: 'Invalid token address' }, { status: 400 });
  }

  const headers = { 'Cache-Control': cacheControl(interval) };
  const cacheKey = `${pairId}:${token0}:${token1}:${interval}:${token0Decimals}:${token1Decimals}`;
  const cached = responseCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return NextResponse.json(cached.body, { headers });
  }

  let requestPromise = inFlight.get(cacheKey);
  if (!requestPromise) {
    requestPromise = loadCandlesWithFallback({
      pairId,
      token0,
      token1,
      interval,
      token0Decimals,
      token1Decimals,
    });
    inFlight.set(cacheKey, requestPromise);
  }

  try {
    const body = await requestPromise;
    responseCache.set(cacheKey, {
      expiresAt: Date.now() + cacheTtlMs(interval),
      body,
    });
    pruneCache();
    return NextResponse.json(body, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Subgraph unavailable';
    return NextResponse.json(
      emptyResponse(interval, 'unavailable', message),
      { headers: { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' } },
    );
  } finally {
    if (inFlight.get(cacheKey) === requestPromise) inFlight.delete(cacheKey);
  }
}
