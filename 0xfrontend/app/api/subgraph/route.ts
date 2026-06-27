import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const SUBGRAPH_URL =
  process.env.SUBGRAPH_URL ||
  process.env.NEXT_PUBLIC_SUBGRAPH_URL ||
  'https://api.goldsky.com/api/public/project_cmqmpust19i8v01t595z8hpq4/subgraphs/zeroxdex/1.0.4/gn';

interface CacheEntry {
  body: string;
  ts: number;
  status: number;
}
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL = 2_000;
const MAX_CACHE = 256;

function hashBody(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) {
    h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  }
  return String(h);
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const bodyText = JSON.stringify(payload);
  const cacheKey = hashBody(bodyText);

  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return new NextResponse(cached.body, {
      status: cached.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'HIT',
      },
    });
  }

  try {
    const upstream = await fetch(SUBGRAPH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
      cache: 'no-store',
    });

    const text = await upstream.text();

    if (CACHE.size > MAX_CACHE) {
      const now = Date.now();
      for (const [k, v] of CACHE) {
        if (now - v.ts > CACHE_TTL) CACHE.delete(k);
      }
      if (CACHE.size > MAX_CACHE) CACHE.clear();
    }
    CACHE.set(cacheKey, { body: text, ts: Date.now(), status: upstream.status });

    return new NextResponse(text, {
      status: upstream.status,
      headers: {
        'Content-Type': 'application/json',
        'X-Cache': 'MISS',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Upstream error' },
      { status: 502 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'subgraph-proxy' });
}