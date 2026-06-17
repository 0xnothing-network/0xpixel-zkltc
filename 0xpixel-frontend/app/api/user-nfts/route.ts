import { NextResponse } from "next/server";
import {
  PIXEL_NFT_CONTRACT_ADDRESS,
  PIXEL_MARKETPLACE_ADDRESS,
  getUserNFTs,
  publicClient,
} from "@/lib/contract";
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

  const owned = await getUserNFTs(address);
  if (owned.length === 0) {
    CACHE.set(address, { value: [], ts: Date.now() });
    return [];
  }

  // Single multicall to look up every owned token's listing state.
  const listingResults = await publicClient.multicall({
    allowFailure: true,
    contracts: owned.map((n) => ({
      address: PIXEL_MARKETPLACE_ADDRESS,
      abi: MarketplaceAbi,
      functionName: "getListingByToken" as const,
      args: [PIXEL_NFT_CONTRACT_ADDRESS, n.tokenId] as const,
    })),
  });

  const tokens: NativeNft[] = owned.map((nft, i) => {
    let listing: NativeNft["listing"] = null;
    const r = listingResults[i];
    if (r.status === "success" && r.result) {
      const [listingId, data] = r.result as readonly [bigint, {
        collection: `0x${string}`;
        tokenId: bigint;
        price: bigint;
        seller: `0x${string}`;
        active: boolean;
      }];
      if (listingId !== 0n && data.active) {
        listing = {
          listingId: listingId.toString(),
          price: data.price.toString(),
        };
      }
    }
    return {
      tokenId: nft.tokenId.toString(),
      name: nft.data?.name ?? "Untitled",
      imageUrl: nft.imageUrl,
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
