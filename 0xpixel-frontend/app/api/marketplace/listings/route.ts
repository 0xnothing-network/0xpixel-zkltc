import { NextResponse } from "next/server";
import {
  publicClient,
  PIXEL_NFT_CONTRACT_ADDRESS,
  PIXEL_MARKETPLACE_ADDRESS,
} from "@/lib/contract";
import { MarketplaceAbi } from "@/lib/marketplaceAbi";
import { PixelNFTABI } from "@/lib/abi";
import { pixelDataToSVG } from "@/lib/gridParser";

export const runtime = "nodejs";
// Cache CDN for 15s. Stale-while-revalidate = 60s for snappy repeat loads.
export const revalidate = 15;

interface ListingDTO {
  listingId: string;
  tokenId: string;
  price: string;
  seller: `0x${string}`;
  active: boolean;
}

interface TokenDTO {
  tokenId: string;
  name: string;
  imageUrl: string;
  creator: `0x${string}`;
  mintedAt: number;
}

interface CacheEntry<T> {
  value: T;
  ts: number;
}

const TOKEN_TTL = 60_000;
const LISTING_TTL = 15_000;

const tokenCache = new Map<string, CacheEntry<TokenDTO | null>>();
const listingCache = new Map<string, CacheEntry<ListingDTO[]>>();

/**
 * Returns a single payload with active listings + per-token metadata so the
 * client renders the whole page from one round-trip instead of 4+ separate
 * RPC calls. Backed by an in-memory cache and Next.js route caching.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limitRaw = parseInt(searchParams.get("limit") || "20", 10);
  const limit = Math.min(Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20), 60);

  const cacheKey = `listings:${limit}`;
  const cached = listingCache.get(cacheKey);
  let listings: ListingDTO[];

  if (cached && Date.now() - cached.ts < LISTING_TTL) {
    listings = cached.value;
  } else {
    try {
      listings = await fetchActiveListings(limit);
      listingCache.set(cacheKey, { value: listings, ts: Date.now() });
    } catch (err) {
      console.error("[marketplace] fetchActiveListings failed:", err);
      // Return stale if available, otherwise propagate.
      if (cached) listings = cached.value;
      else {
        return NextResponse.json(
          { error: "RPC unavailable" },
          { status: 503 }
        );
      }
    }
  }

  if (listings.length === 0) {
    return NextResponse.json({ listings: [], tokens: {} });
  }

  const tokens = await fetchTokensForListings(listings.map((l) => l.tokenId));

  return NextResponse.json({ listings, tokens });
}

async function fetchActiveListings(limit: number): Promise<ListingDTO[]> {
  // Step 1: get active listing IDs in one call.
  const idsRaw = (await publicClient.readContract({
    address: PIXEL_MARKETPLACE_ADDRESS,
    abi: MarketplaceAbi,
    functionName: "getActiveListings",
    args: [0n, BigInt(limit)],
  })) as bigint[];
  if (!idsRaw || idsRaw.length === 0) return [];

  // Step 2: batch fetch listing details via multicall.
  const listingResults = await publicClient.multicall({
    allowFailure: true,
    contracts: idsRaw.map((id) => ({
      address: PIXEL_MARKETPLACE_ADDRESS,
      abi: MarketplaceAbi,
      functionName: "listings" as const,
      args: [id] as const,
    })),
  });

  const out: ListingDTO[] = [];
  for (let i = 0; i < idsRaw.length; i++) {
    const r = listingResults[i];
    if (!r || r.status !== "success") continue;
    const v = r.result as readonly [
      `0x${string}`,
      bigint,
      bigint,
      `0x${string}`,
      boolean,
    ];
    if (!v[4]) continue; // inactive
    out.push({
      listingId: idsRaw[i].toString(),
      tokenId: v[1].toString(),
      price: v[2].toString(),
      seller: v[3],
      active: v[4],
    });
  }
  return out;
}

async function fetchTokensForListings(
  tokenIds: string[]
): Promise<Record<string, TokenDTO | null>> {
  const unique = Array.from(new Set(tokenIds));
  const out: Record<string, TokenDTO | null> = {};

  const missing: string[] = [];
  for (const id of unique) {
    const c = tokenCache.get(id);
    if (c && Date.now() - c.ts < TOKEN_TTL) {
      out[id] = c.value;
    } else {
      missing.push(id);
    }
  }

  if (missing.length === 0) return out;

  // Single multicall for all missing tokens.
  const results = await publicClient.multicall({
    allowFailure: true,
    contracts: missing.map((id) => ({
      address: PIXEL_NFT_CONTRACT_ADDRESS,
      abi: PixelNFTABI,
      functionName: "tokenData" as const,
      args: [BigInt(id)] as const,
    })),
  });

  for (let i = 0; i < missing.length; i++) {
    const id = missing[i];
    const r = results[i];
    if (!r || r.status !== "success") {
      tokenCache.set(id, { value: null, ts: Date.now() });
      out[id] = null;
      continue;
    }
    const tuple = r.result as readonly [
      string,
      bigint,
      string,
      string,
      bigint,
      string,
    ];
    const [name, gridSize, pixelData, creator, mintedAt] = tuple;
    const imageUrl =
      pixelData && gridSize
        ? pixelDataToSVG(pixelData, Number(gridSize))
        : "";
    const meta: TokenDTO = {
      tokenId: id,
      name: name || `Token #${id}`,
      imageUrl,
      creator: creator as `0x${string}`,
      mintedAt: Number(mintedAt),
    };
    tokenCache.set(id, { value: meta, ts: Date.now() });
    out[id] = meta;
  }

  if (tokenCache.size > 4096) {
    const now = Date.now();
    for (const [k, v] of tokenCache) {
      if (now - v.ts > TOKEN_TTL) tokenCache.delete(k);
    }
  }

  return out;
}
