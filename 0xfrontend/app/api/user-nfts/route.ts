import { NextResponse } from "next/server";
import {
  PIXEL_NFT_CONTRACT_ADDRESS,
  PIXEL_MARKETPLACE_ADDRESS,
  getUserTokenIds,
  fetchTokenDataCached,
  publicClient,
} from "@/lib/contract";
import { pixelDataToSVG } from "@/lib/gridParser";
import { MarketplaceAbi } from "@/lib/marketplaceAbi";

export const runtime = "nodejs";
export const revalidate = 30;

interface CacheEntry<T> {
  value: T;
  ts: number;
}
const CACHE = new Map<string, CacheEntry<NativeNft[]>>();
const CACHE_TTL = 30_000;

export interface NativeNft {
  tokenId: string;
  name: string;
  imageUrl: string;
  listing: { listingId: string; price: string } | null;
}

async function fetchNativeNfts(address: string): Promise<NativeNft[]> {
  const cached = CACHE.get(address);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.value;
  }

  const addr = address as `0x${string}`;

  // Get token IDs first
  const tokenIds = await getUserTokenIds(address);
  if (tokenIds.length === 0) {
    CACHE.set(address, { value: [], ts: Date.now() });
    return [];
  }

  // Fetch token data and listing data in parallel for maximum speed
  const [tokenDataResults, listingResults] = await Promise.all([
    // All token data in parallel
    Promise.all(tokenIds.map((id) => fetchTokenDataCached(id))),
    // All listing data in single multicall
    publicClient.multicall({
      allowFailure: true,
      contracts: tokenIds.map((n) => ({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "getListingByToken" as const,
        args: [PIXEL_NFT_CONTRACT_ADDRESS, n] as const,
      })),
    }),
  ]);

  const tokens: NativeNft[] = tokenIds.map((tokenId, i) => {
    const data = tokenDataResults[i];
    let listing: NativeNft["listing"] = null;

    const r = listingResults[i];
    if (r.status === "success" && r.result) {
      const [listingId, listingData] = r.result as readonly [bigint, {
        collection: `0x${string}`;
        tokenId: bigint;
        price: bigint;
        seller: `0x${string}`;
        active: boolean;
      }];
      if (listingId !== 0n && listingData.active) {
        listing = {
          listingId: listingId.toString(),
          price: listingData.price.toString(),
        };
      }
    }

    return {
      tokenId: tokenId.toString(),
      name: data?.name ?? "Untitled",
      imageUrl: data?.pixelData && data?.gridSize
        ? pixelDataToSVG(data.pixelData, Number(data.gridSize))
        : "",
      listing,
    };
  });

  CACHE.set(address, { value: tokens, ts: Date.now() });
  return tokens;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "Invalid address" }, { status: 400 });
  }
  try {
    const tokens = await fetchNativeNfts(address);
    return NextResponse.json({ tokens, count: tokens.length });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || "Unknown error" },
      { status: 500 }
    );
  }
}
