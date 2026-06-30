/**
 * /api/subgraph — Optimized GraphQL proxy for Vercel Edge.
 *
 * Key optimizations:
 * - Edge Runtime: runs on Vercel's distributed network, close to Goldsky
 * - Two-tier TTL:
 *     SHORT (5s)  — delta/realtime queries (react-query polls every 5s)
 *     LONG  (2m)  — historical queries (timeframe switch within 2 min = cache hit)
 * - Stale-While-Revalidate: serves stale data instantly, refreshes in background
 * - Delta query detection: uses query name to differentiate cache keys
 * - LRU eviction: max 512 entries, oldest half evicted when full
 * - FNV-1a cache key: fast 32-bit hash per query+variables
 * - Upstream timeout: 10s hard cap to prevent hanging requests
 *
 * This eliminates:
 * - In-memory Map TTL (2s was too short — every 5s poll caused cache miss)
 * - Rate limit hammering (same historical query hit Goldsky repeatedly)
 * - 429 errors from Goldsky (cache absorbs repeated queries)
 */
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'edge';

const SUBGRAPH_URL =
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

interface CacheEntry {
  body: string;
  ts: number;
  status: number;
  accessed: number;
  isDelta: boolean;
}

const SHORT_TTL = 5_000;   // delta queries — matches React Query poll interval
const LONG_TTL  = 120_000; // historical queries — 2 min window for timeframe switches
const MAX_CACHE = 512;

// Module-level singleton — persists across requests in Edge runtime
const cache = new Map<string, CacheEntry>();

function isDeltaQuery(query: string, variables: Record<string, unknown>): boolean {
  if (!query.includes('GetDeltaSwaps')) return false;
  const gt = Number(variables.timestampGt);
  if (!gt) return false;
  const age = Date.now() / 1000 - gt;
  return age < 600; // delta = last 10 min of data
}

function cacheKey(query: string, variables: Record<string, unknown>, isDelta: boolean): string {
  const payload = JSON.stringify({ query, variables });
  const seed = isDelta ? 0x811c9dc5 : 0x84222325; // different seed per type
  let h = seed;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = (h * 0x01000193) | 0;
  }
  return `${isDelta ? 'd' : 'h'}_${(h >>> 0).toString(36)}`;
}

function evictLRU(): void {
  if (cache.size < MAX_CACHE) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].accessed - b[1].accessed);
  const toDelete = entries.slice(0, Math.ceil(entries.length / 2));
  for (const [k] of toDelete) cache.delete(k);
}

export async function POST(request: NextRequest) {
  let payload: { query?: string; variables?: Record<string, unknown> };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { query = '', variables = {} } = payload;
  const delta = isDeltaQuery(query, variables);
  const key = cacheKey(query, variables, delta);
  const now = Date.now();

  // ── Cache hit (fresh) ────────────────────────────────────
  const cached = cache.get(key);
  if (cached) {
    const ttl = delta ? SHORT_TTL : LONG_TTL;
    const age = now - cached.ts;

    if (age < ttl) {
      cached.accessed = now;
      return new NextResponse(cached.body, {
        status: cached.status,
        headers: {
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'Cache-Control': 'no-store',
          'X-Cache-TTL-Remaining': String(Math.ceil((ttl - age) / 1000)),
        },
      });
    }

    // Stale: serve immediately, refresh non-blocking
    cached.accessed = now;
    refreshStale(key, query, variables, delta, cached);
    return new NextResponse(cached.body, {
      status: cached.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'STALE',
        'Cache-Control': 'no-store',
      },
    });
  }

  // ── Cache miss: fetch upstream ───────────────────────────
  evictLRU();

  try {
    const upstream = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });

    const text = await upstream.text();

    cache.set(key, {
      body: text,
      ts: now,
      status: upstream.status,
      accessed: now,
      isDelta: delta,
    });

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upstream error' },
      { status: 502 },
    );
  }
}

async function refreshStale(
  key: string,
  query: string,
  variables: Record<string, unknown>,
  delta: boolean,
  existing: CacheEntry,
): Promise<void> {
  try {
    const upstream = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!upstream.ok) return;

    const text = await upstream.text();
    cache.set(key, {
      body: text,
      ts: Date.now(),
      status: upstream.status,
      accessed: existing.accessed,
      isDelta: delta,
    });
  } catch {
    // Background refresh failed — keep serving stale, no action needed
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    endpoint: 'subgraph-proxy-edge',
    cacheSize: cache.size,
  });
}
