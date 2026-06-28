import { NextRequest, NextResponse } from 'next/server';
import { encodePacked, keccak256 } from 'viem';

export const runtime = 'edge';

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

const SWAP_PAGE_SIZE = 1000;
const MAX_SWAPS_PER_DIRECTION = 5_000;
const MAX_MERGED_SWAPS = MAX_SWAPS_PER_DIRECTION * 2;
const RESPONSE_CACHE_TTL_MS = 3_000;
const GENESIS_CACHE_TTL_MS = 5 * 60_000;
const SWAP_CACHE_TTL_MS = 60_000;
const LATEST_SWAP_CACHE_TTL_MS = 2_500;
const INDEXED_SCHEMA_RETRY_MS = 60_000;
const SUPPORTED_INTERVALS = new Set([60, 240, 1440]);

interface SwapEvent {
  id: string;
  timestamp: string | { seconds?: string | number; nanos?: number };
  amountIn: string;
  amountOut: string;
  fee: string;
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

interface CandlesResponseBody {
  candles: CandleData[];
  count: number;
  interval: number;
  source: 'indexed-candles' | 'raw-swaps-fallback';
  timestampGte: number;
  recentWindowStart: number;
  genesisTime: number | null;
  latestPrice: LatestPrice | null;
}

interface LatestPrice {
  price: number;
  timestamp: number;
  source: 'subgraph-swap' | 'candle';
}

interface IndexedCandle {
  id: string;
  timestamp: string | { seconds?: string | number; nanos?: number };
  open: string;
  high: string;
  low: string;
  close: string;
}

interface LiquidityAddedEvent {
  id: string;
  pairId: string;
  amount0: string;
  amount1: string;
  timestamp: string | { seconds?: string | number; nanos?: number };
}

interface CandleBuildContext {
  t0: string;
  t1: string;
  token0Decimals: number;
  token1Decimals: number;
}

const responseCache = new Map<string, { expires: number; body: CandlesResponseBody }>();
const responseInFlight = new Map<string, Promise<CandlesResponseBody>>();
const genesisCache = new Map<string, { expires: number; value: LiquidityAddedEvent | null }>();
const genesisInFlight = new Map<string, Promise<LiquidityAddedEvent | null>>();
const swapCache = new Map<string, { expires: number; value: SwapEvent[] }>();
const swapInFlight = new Map<string, Promise<SwapEvent[]>>();
const latestSwapCache = new Map<string, { expires: number; value: SwapEvent | null }>();
const latestSwapInFlight = new Map<string, Promise<SwapEvent | null>>();
let indexedSchemaUnavailableUntil = 0;

const PAIR_QUERY = `
  query GetCandleSwaps(
    $timestampGte: BigInt!
    $tokenIn: Bytes!
    $tokenOut: Bytes!
    $limit: Int!
  ) {
    swaps(
      first: $limit
      orderBy: timestamp
      orderDirection: asc
      where: {
        timestamp_gte: $timestampGte
        tokenIn: $tokenIn
        tokenOut: $tokenOut
      }
    ) {
      id
      timestamp
      amountIn
      amountOut
      fee
      tokenIn
      tokenOut
    }
  }
`;

const GENESIS_QUERY = `
  query GetGenesisLiquidity($pairId: Bytes!) {
    liquidityAddeds(
      first: 1
      orderBy: timestamp
      orderDirection: asc
      where: { pairId: $pairId }
    ) {
      id
      pairId
      amount0
      amount1
      timestamp
    }
  }
`;

const LATEST_SWAP_QUERY = `
  query GetLatestCandleSwap(
    $tokenIn: Bytes!
    $tokenOut: Bytes!
  ) {
    swaps(
      first: 1
      orderBy: timestamp
      orderDirection: desc
      where: {
        tokenIn: $tokenIn
        tokenOut: $tokenOut
      }
    ) {
      id
      timestamp
      amountIn
      amountOut
      fee
      tokenIn
      tokenOut
    }
  }
`;

const CANDLES_QUERY = `
  query GetIndexedCandles(
    $pairId: Bytes!
    $interval: Int!
    $limit: Int!
    $lastTimestamp: BigInt!
  ) {
    candles(
      first: $limit
      orderBy: timestamp
      orderDirection: asc
      where: {
        pairId: $pairId
        interval: $interval
        timestamp_gt: $lastTimestamp
      }
    ) {
      id
      timestamp
      open
      high
      low
      close
    }
  }
`;

function getDaysBack(intervalMinutes: number): number {
  if (intervalMinutes <= 60) return 14;
  if (intervalMinutes <= 240) return 45;
  return 180;
}

function pairIdForTokens(a: string, b: string): string | null {
  try {
    const [tokenA, tokenB] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
    return keccak256(encodePacked(['address', 'address'], [tokenA as `0x${string}`, tokenB as `0x${string}`]));
  } catch {
    return null;
  }
}

function timestampOf(swap: SwapEvent): number {
  const rawTs = swap.timestamp;
  return typeof rawTs === 'object' && rawTs !== null
    ? Number(rawTs.seconds ?? 0)
    : Number(rawTs);
}

function timestampOfLiquidity(event: LiquidityAddedEvent): number {
  const rawTs = event.timestamp;
  return typeof rawTs === 'object' && rawTs !== null
    ? Number(rawTs.seconds ?? 0)
    : Number(rawTs);
}

function timestampOfIndexedCandle(candle: IndexedCandle): number {
  const rawTs = candle.timestamp;
  return typeof rawTs === 'object' && rawTs !== null
    ? Number(rawTs.seconds ?? 0)
    : Number(rawTs);
}

function parseDecimals(value: string | null, fallback = 18): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 36) return fallback;
  return parsed;
}

function amountToFloat(raw: string | number, decimals: number): number {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return n / 10 ** decimals;
}

function decimalsForPoolToken(poolToken: string, ctx: CandleBuildContext): number {
  if (poolToken === ctx.t0) return ctx.token0Decimals;
  if (poolToken === ctx.t1) return ctx.token1Decimals;
  return 18;
}

async function fetchGenesisLiquidity(pairId: string): Promise<LiquidityAddedEvent | null> {
  const cached = genesisCache.get(pairId);
  if (cached && cached.expires > Date.now()) return cached.value;

  const existing = genesisInFlight.get(pairId);
  if (existing) return existing;

  const request = fetchGenesisLiquidityUncached(pairId);
  genesisInFlight.set(pairId, request);
  try {
    const value = await request;
    genesisCache.set(pairId, { expires: Date.now() + GENESIS_CACHE_TTL_MS, value });
    return value;
  } finally {
    genesisInFlight.delete(pairId);
  }
}

async function fetchGenesisLiquidityUncached(pairId: string): Promise<LiquidityAddedEvent | null> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: GENESIS_QUERY,
      variables: { pairId },
    }),
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) throw new Error(`Genesis subgraph request failed: ${res.status}`);

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message ?? 'Genesis subgraph query error');
  }

  return json.data?.liquidityAddeds?.[0] ?? null;
}

function normalizeIndexedCandle(candle: CandleData, invert: boolean): CandleData | null {
  if (!invert) return candle;
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) return null;

  const open = 1 / candle.open;
  const close = 1 / candle.close;
  const high = 1 / candle.low;
  const low = 1 / candle.high;
  return { time: candle.time, open, high, low, close };
}

async function fetchIndexedCandles(
  pairId: string,
  intervalMinutes: number,
  invertPrice: boolean,
  timestampGte: number,
): Promise<CandleData[] | null> {
  if (Date.now() < indexedSchemaUnavailableUntil) return null;

  const out: CandleData[] = [];
  let lastTimestamp = Math.max(-1, timestampGte - 1);
  const pageSize = 1000;

  while (true) {
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: CANDLES_QUERY,
        variables: {
          pairId,
          interval: intervalMinutes,
          limit: pageSize,
          lastTimestamp: String(lastTimestamp),
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) return null;

    const json = await res.json();
    if (json.errors?.length) {
      indexedSchemaUnavailableUntil = Date.now() + INDEXED_SCHEMA_RETRY_MS;
      return null;
    }

    const page: IndexedCandle[] = json.data?.candles ?? [];
    if (page.length === 0) break;

    for (const candle of page) {
      const time = timestampOfIndexedCandle(candle);
      const open = Number(candle.open);
      const high = Number(candle.high);
      const low = Number(candle.low);
      const close = Number(candle.close);
      if (![time, open, high, low, close].every(Number.isFinite)) continue;
      if (time <= lastTimestamp) continue;
      const normalized = normalizeIndexedCandle({ time, open, high, low, close }, invertPrice);
      if (!normalized) continue;
      out.push(normalized);
      lastTimestamp = time;
    }

    if (page.length < pageSize) break;
  }

  return out;
}

async function fetchSwapDirection(
  timestampGte: number,
  tokenIn: string,
  tokenOut: string,
): Promise<SwapEvent[]> {
  const out: SwapEvent[] = [];
  let cursor = timestampGte;

  while (out.length < MAX_SWAPS_PER_DIRECTION) {
    const limit = Math.min(SWAP_PAGE_SIZE, MAX_SWAPS_PER_DIRECTION - out.length);
    const res = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: PAIR_QUERY,
        variables: {
          timestampGte: String(cursor),
          tokenIn,
          tokenOut,
          limit,
        },
      }),
      signal: AbortSignal.timeout(8_000),
    });

    if (!res.ok) {
      throw new Error(`Subgraph request failed: ${res.status}`);
    }

    const json = await res.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message ?? 'Subgraph query error');
    }

    const page: SwapEvent[] = json.data?.swaps ?? [];
    if (page.length === 0) break;

    out.push(...page);

    const lastTs = timestampOf(page[page.length - 1]);
    if (!isFinite(lastTs) || lastTs <= cursor || page.length < limit) break;
    cursor = lastTs + 1;
  }

  return out;
}

async function fetchSwaps(
  timestampGte: number,
  t0: string,
  t1: string,
): Promise<SwapEvent[]> {
  const sortedA = BigInt(t0) < BigInt(t1) ? t0 : t1;
  const sortedB = sortedA === t0 ? t1 : t0;
  const cacheKey = `${sortedA}:${sortedB}:${timestampGte}`;
  const cached = swapCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const existing = swapInFlight.get(cacheKey);
  if (existing) return existing;

  const request = fetchSwapsUncached(timestampGte, t0, t1);
  swapInFlight.set(cacheKey, request);
  try {
    const value = await request;
    swapCache.set(cacheKey, { expires: Date.now() + SWAP_CACHE_TTL_MS, value });
    return value;
  } finally {
    swapInFlight.delete(cacheKey);
  }
}

async function fetchSwapsUncached(
  timestampGte: number,
  t0: string,
  t1: string,
): Promise<SwapEvent[]> {
  const results = await Promise.allSettled([
    fetchSwapDirection(timestampGte, t0, t1),
    fetchSwapDirection(timestampGte, t1, t0),
  ]);
  const [forward, reverse] = results.map(result => (
    result.status === 'fulfilled' ? result.value : []
  ));

  const seen = new Set<string>();
  const merged: SwapEvent[] = [];

  for (const swap of [...forward, ...reverse]) {
    if (seen.has(swap.id)) continue;
    seen.add(swap.id);
    merged.push(swap);
  }

  merged.sort((a, b) => {
    const tsDiff = timestampOf(a) - timestampOf(b);
    return tsDiff || a.id.localeCompare(b.id);
  });

  return merged.slice(0, MAX_MERGED_SWAPS);
}

async function fetchLatestSwapDirection(tokenIn: string, tokenOut: string): Promise<SwapEvent | null> {
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: LATEST_SWAP_QUERY,
      variables: { tokenIn, tokenOut },
    }),
    signal: AbortSignal.timeout(5_000),
  });

  if (!res.ok) return null;
  const json = await res.json();
  if (json.errors?.length) return null;
  return json.data?.swaps?.[0] ?? null;
}

async function fetchLatestSwap(t0: string, t1: string): Promise<SwapEvent | null> {
  const sortedA = BigInt(t0) < BigInt(t1) ? t0 : t1;
  const sortedB = sortedA === t0 ? t1 : t0;
  const cacheKey = `${sortedA}:${sortedB}`;
  const cached = latestSwapCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const existing = latestSwapInFlight.get(cacheKey);
  if (existing) return existing;

  const request = (async () => {
    const results = await Promise.allSettled([
      fetchLatestSwapDirection(t0, t1),
      fetchLatestSwapDirection(t1, t0),
    ]);
    const swaps = results
      .filter((result): result is PromiseFulfilledResult<SwapEvent | null> => result.status === 'fulfilled')
      .map(result => result.value)
      .filter((swap): swap is SwapEvent => !!swap);

    swaps.sort((a, b) => timestampOf(b) - timestampOf(a) || b.id.localeCompare(a.id));
    return swaps[0] ?? null;
  })();

  latestSwapInFlight.set(cacheKey, request);
  try {
    const value = await request;
    latestSwapCache.set(cacheKey, { expires: Date.now() + LATEST_SWAP_CACHE_TTL_MS, value });
    return value;
  } finally {
    latestSwapInFlight.delete(cacheKey);
  }
}

function buildGenesisCandle(
  genesis: LiquidityAddedEvent | null,
  intervalMinutes: number,
  ctx: CandleBuildContext,
): CandleData | null {
  if (!genesis) return null;

  const poolToken0 = BigInt(ctx.t0) < BigInt(ctx.t1) ? ctx.t0 : ctx.t1;
  const poolToken1 = poolToken0 === ctx.t0 ? ctx.t1 : ctx.t0;
  const amount0 = amountToFloat(genesis.amount0, decimalsForPoolToken(poolToken0, ctx));
  const amount1 = amountToFloat(genesis.amount1, decimalsForPoolToken(poolToken1, ctx));
  if (!isFinite(amount0) || !isFinite(amount1) || amount0 <= 0 || amount1 <= 0) return null;

  const ts = timestampOfLiquidity(genesis);
  if (!isFinite(ts) || ts <= 0) return null;

  const price = poolToken0 === ctx.t0 ? amount0 / amount1 : amount1 / amount0;
  if (!isFinite(price) || price <= 0) return null;

  const interval = intervalMinutes * 60;
  const candleTime = Math.floor(ts / interval) * interval;
  return { time: candleTime, open: price, high: price, low: price, close: price };
}

function priceFromSwapForChart(swap: SwapEvent, ctx: CandleBuildContext): number | null {
  const ti = swap.tokenIn.toLowerCase();
  const to = swap.tokenOut.toLowerCase();
  if (!((ti === ctx.t0 && to === ctx.t1) || (ti === ctx.t1 && to === ctx.t0))) return null;

  const amountIn = amountToFloat(swap.amountIn, decimalsForPoolToken(ti, ctx));
  const amountOut = amountToFloat(swap.amountOut, decimalsForPoolToken(to, ctx));
  if (!Number.isFinite(amountIn) || !Number.isFinite(amountOut) || amountIn <= 0 || amountOut <= 0) {
    return null;
  }

  const price = ti === ctx.t0
    ? amountIn / amountOut
    : amountOut / amountIn;
  return Number.isFinite(price) && price > 0 ? price : null;
}

function buildCandlesFromSwaps(
  swaps: SwapEvent[],
  intervalMinutes: number,
  ctx: CandleBuildContext,
): CandleData[] {
  const interval = intervalMinutes * 60;
  const candles: CandleData[] = [];
  let current: CandleData | null = null;

  for (const swap of swaps) {
    const ts = timestampOf(swap);
    const price = priceFromSwapForChart(swap, ctx);
    if (!price || !Number.isFinite(ts) || ts <= 0) continue;

    const candleTime = Math.floor(ts / interval) * interval;
    if (!current || current.time !== candleTime) {
      if (current) candles.push(current);
      current = { time: candleTime, open: price, high: price, low: price, close: price };
    } else {
      current.high = Math.max(current.high, price);
      current.low = Math.min(current.low, price);
      current.close = price;
    }
  }

  if (current) candles.push(current);
  return candles;
}

function latestPriceFromSwap(swap: SwapEvent | null, ctx: CandleBuildContext): LatestPrice | null {
  if (!swap) return null;
  const price = priceFromSwapForChart(swap, ctx);
  const timestamp = timestampOf(swap);
  if (!price || !Number.isFinite(timestamp) || timestamp <= 0) return null;
  return { price, timestamp, source: 'subgraph-swap' };
}

function latestPriceFromCandles(candles: CandleData[]): LatestPrice | null {
  const last = candles[candles.length - 1];
  if (!last || !Number.isFinite(last.close) || last.close <= 0) return null;
  return { price: last.close, timestamp: last.time, source: 'candle' };
}

async function refreshCachedLatestPrice(
  body: CandlesResponseBody,
  t0: string,
  t1: string,
  token0Decimals: number,
  token1Decimals: number,
): Promise<CandlesResponseBody> {
  const latestSwap = await fetchLatestSwap(t0, t1);
  const latestPrice = latestPriceFromSwap(latestSwap, { t0, t1, token0Decimals, token1Decimals })
    ?? body.latestPrice
    ?? latestPriceFromCandles(body.candles);
  return latestPrice === body.latestPrice ? body : { ...body, latestPrice };
}

function prependGenesisCandle(candles: CandleData[], genesis: CandleData | null): CandleData[] {
  if (!genesis) return candles;
  if (candles.length === 0) return [genesis];

  const first = candles[0];
  if (genesis.time < first.time) return [genesis, ...candles];
  if (genesis.time > first.time) return candles;

  return [
    {
      time: first.time,
      open: genesis.open,
      high: Math.max(genesis.high, first.high),
      low: Math.min(genesis.low, first.low),
      close: first.close,
    },
    ...candles.slice(1),
  ];
}

function shouldFetchFromGenesis(genesis: LiquidityAddedEvent | null, fallbackTimestampGte: number): number {
  if (!genesis) return fallbackTimestampGte;
  const genesisTs = timestampOfLiquidity(genesis);
  if (!isFinite(genesisTs) || genesisTs <= 0) return fallbackTimestampGte;
  return Math.min(fallbackTimestampGte, genesisTs);
}

async function buildCandlesResponse(
  t0: string,
  t1: string,
  interval: number,
  token0Decimals: number,
  token1Decimals: number,
): Promise<CandlesResponseBody> {
  const daysBack = getDaysBack(interval);
  const timestampGte = Math.floor(Date.now() / 1000) - daysBack * 86400;
  const pairId = pairIdForTokens(t0, t1);
  const ctx: CandleBuildContext = { t0, t1, token0Decimals, token1Decimals };
  const [genesisLiquidity, latestSwap] = await Promise.all([
    pairId ? fetchGenesisLiquidity(pairId) : Promise.resolve(null),
    fetchLatestSwap(t0, t1),
  ]);
  const genesisCandle = buildGenesisCandle(genesisLiquidity, interval, ctx);
  const sortedToken0 = BigInt(t0) < BigInt(t1) ? t0 : t1;
  const indexedCandles = pairId ? await fetchIndexedCandles(pairId, interval, sortedToken0 !== t0, timestampGte) : null;

  if (indexedCandles && indexedCandles.length > 0) {
    const candles = prependGenesisCandle(indexedCandles, genesisCandle);
    const latestPrice = latestPriceFromSwap(latestSwap, ctx) ?? latestPriceFromCandles(candles);
    return {
      candles,
      count: candles.length,
      interval,
      source: 'indexed-candles',
      timestampGte: genesisCandle?.time ?? candles[0]?.time ?? timestampGte,
      recentWindowStart: timestampGte,
      genesisTime: genesisCandle?.time ?? null,
      latestPrice,
    };
  }

  const historyStart = interval === 1440
    ? shouldFetchFromGenesis(genesisLiquidity, timestampGte)
    : timestampGte;
  const swaps = await fetchSwaps(historyStart, t0, t1);
  const candles = prependGenesisCandle(buildCandlesFromSwaps(swaps, interval, ctx), genesisCandle);
  const latestPrice = latestPriceFromSwap(latestSwap ?? swaps[swaps.length - 1] ?? null, ctx)
    ?? latestPriceFromCandles(candles);

  return {
    candles,
    count: candles.length,
    interval,
    source: 'raw-swaps-fallback',
    timestampGte: historyStart,
    recentWindowStart: timestampGte,
    genesisTime: genesisCandle?.time ?? null,
    latestPrice,
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token0 = searchParams.get('token0') ?? '';
  const token1 = searchParams.get('token1') ?? '';
  const interval = parseInt(searchParams.get('interval') ?? '1440', 10);
  const token0Decimals = parseDecimals(searchParams.get('token0Decimals'));
  const token1Decimals = parseDecimals(searchParams.get('token1Decimals'));

  if (!token0 || !token1 || !Number.isFinite(interval) || !SUPPORTED_INTERVALS.has(interval)) {
    return NextResponse.json({ error: 'Missing token0, token1, or supported interval' }, { status: 400 });
  }

  const t0 = token0.toLowerCase();
  const t1 = token1.toLowerCase();
  const responseKey = `${t0}:${t1}:${interval}:${token0Decimals}:${token1Decimals}`;
  const cached = responseCache.get(responseKey);
  if (cached && cached.expires > Date.now()) {
    const body = await refreshCachedLatestPrice(cached.body, t0, t1, token0Decimals, token1Decimals);
    return NextResponse.json(body, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Candles-Cache': 'HIT',
      },
    });
  }

  try {
    const existing = responseInFlight.get(responseKey);
    const body = existing ?? buildCandlesResponse(t0, t1, interval, token0Decimals, token1Decimals);
    if (!existing) responseInFlight.set(responseKey, body);
    const payload = await body;
    responseInFlight.delete(responseKey);
    responseCache.set(responseKey, { expires: Date.now() + RESPONSE_CACHE_TTL_MS, body: payload });

    return NextResponse.json(
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Candles-Cache': existing ? 'JOINED' : 'MISS',
        },
      },
    );
  } catch (err) {
    responseInFlight.delete(responseKey);
    const message = err instanceof Error ? err.message : 'Server error';
    return NextResponse.json(
      { candles: [], count: 0, interval, timestampGte: 0, upstreamError: message },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'public, max-age=5, s-maxage=5, stale-while-revalidate=30',
        },
      },
    );
  }
}
