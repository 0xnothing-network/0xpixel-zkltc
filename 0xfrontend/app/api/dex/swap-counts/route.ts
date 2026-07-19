import { NextResponse } from 'next/server';
import { DEX_SUBGRAPH_URL } from '@/lib/dexSubgraph';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 1000;
const CACHE_TTL_MS = 15_000;
const UPSTREAM_TIMEOUT_MS = 10_000;

interface IndexedCandleCount {
  id: string;
  pairId: string;
  swapCount: string;
}

interface SubgraphMeta {
  block?: { number?: string | number } | null;
  hasIndexingErrors?: boolean;
}

interface SubgraphResponse {
  data?: {
    candles?: IndexedCandleCount[];
    _meta?: SubgraphMeta | null;
  };
  errors?: Array<{ message?: string }>;
}

interface SwapCountsResponse {
  total: string;
  pairs: Record<string, string>;
  indexedBlock: string | null;
  hasIndexingErrors: boolean;
}

interface CachedResponse {
  body: SwapCountsResponse;
  expiresAt: number;
}

const SWAP_COUNTS_QUERY = `
  query GetSwapCounts($limit: Int!, $after: String!) {
    candles(
      first: $limit
      orderBy: id
      orderDirection: asc
      where: { interval: 15, id_gt: $after }
    ) {
      id
      pairId
      swapCount
    }
    _meta {
      block { number }
      hasIndexingErrors
    }
  }
`;

let cachedResponse: CachedResponse | null = null;
let inFlight: Promise<SwapCountsResponse> | null = null;

function parseSwapCount(value: string, candleId: string): bigint {
  try {
    const count = BigInt(value);
    if (count < 0n) throw new Error('negative count');
    return count;
  } catch {
    throw new Error(`Invalid swapCount for candle ${candleId}`);
  }
}

async function fetchPage(after: string): Promise<{
  candles: IndexedCandleCount[];
  meta: SubgraphMeta | null;
}> {
  const response = await fetch(DEX_SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: SWAP_COUNTS_QUERY,
      variables: { limit: PAGE_SIZE, after },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DEX subgraph request failed: ${response.status}`);
  }

  const payload = (await response.json()) as SubgraphResponse;
  if (payload.errors?.length) {
    throw new Error(payload.errors[0]?.message || 'DEX subgraph query failed');
  }

  return {
    candles: Array.isArray(payload.data?.candles) ? payload.data.candles : [],
    meta: payload.data?._meta ?? null,
  };
}

async function loadSwapCounts(): Promise<SwapCountsResponse> {
  // Each indexed swap increments exactly one interval-15 candle.
  let cursor = '';
  let total = 0n;
  let indexedBlock: string | null = null;
  let hasIndexingErrors = false;
  const pairCounts = new Map<string, bigint>();

  while (true) {
    const page = await fetchPage(cursor);
    const blockNumber = page.meta?.block?.number;
    if (blockNumber !== undefined && blockNumber !== null) {
      indexedBlock = String(blockNumber);
    }
    hasIndexingErrors ||= page.meta?.hasIndexingErrors === true;

    let previousId = cursor;
    for (const candle of page.candles) {
      if (typeof candle.id !== 'string' || candle.id <= previousId) {
        throw new Error('DEX subgraph candle cursor did not advance');
      }
      previousId = candle.id;

      if (typeof candle.pairId !== 'string' || candle.pairId.length === 0) {
        throw new Error(`Invalid pairId for candle ${candle.id}`);
      }

      const count = parseSwapCount(candle.swapCount, candle.id);
      const pairId = candle.pairId.toLowerCase();
      total += count;
      pairCounts.set(pairId, (pairCounts.get(pairId) ?? 0n) + count);
    }

    if (page.candles.length < PAGE_SIZE) break;
    if (previousId === cursor) {
      throw new Error('DEX subgraph candle cursor did not advance');
    }
    cursor = previousId;
  }

  const pairs = Object.fromEntries(
    [...pairCounts.entries()].map(([pairId, count]) => [pairId, count.toString()]),
  );

  return {
    total: total.toString(),
    pairs,
    indexedBlock,
    hasIndexingErrors,
  };
}

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' };

  const now = Date.now();
  if (cachedResponse && cachedResponse.expiresAt > now) {
    return NextResponse.json(cachedResponse.body, {
      headers: { ...headers, 'X-Cache': 'HIT' },
    });
  }

  if (!inFlight) {
    inFlight = loadSwapCounts()
      .then((body) => {
        cachedResponse = {
          body,
          expiresAt: Date.now() + CACHE_TTL_MS,
        };
        return body;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  try {
    const body = await inFlight;
    return NextResponse.json(body, {
      headers: { ...headers, 'X-Cache': 'MISS' },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unable to count DEX swaps' },
      { status: 502, headers },
    );
  }
}
