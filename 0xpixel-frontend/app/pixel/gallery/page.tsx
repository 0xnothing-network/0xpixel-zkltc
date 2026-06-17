"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useBlockNumber } from "wagmi";
import { OwnedNftCard, type OwnedNft } from "@/components/OwnedNftCard";
import { GridSkeleton } from "@/components/Skeleton";
import { PIXEL_MARKETPLACE_ADDRESS } from "@/lib/contract";
import { MarketplaceAbi } from "@/lib/marketplaceAbi";

type SortKey = "newest" | "oldest" | "name";

export default function GalleryPage() {
  const { address, isConnected } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const [refreshKey, setRefreshKey] = useState(0);
  const [sort, setSort] = useState<SortKey>("newest");

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const { data, isLoading, error } = useUserNfts(address, refreshKey);
  const { data: paused } = useReadContract({
    address: PIXEL_MARKETPLACE_ADDRESS,
    abi: MarketplaceAbi,
    functionName: "paused",
  });
  void blockNumber;

  const sorted = useMemo<OwnedNft[]>(() => {
    if (!data) return [];
    const arr = [...data];
    switch (sort) {
      case "newest":
        arr.sort((a, b) => Number(BigInt(b.tokenId) - BigInt(a.tokenId)));
        break;
      case "oldest":
        arr.sort((a, b) => Number(BigInt(a.tokenId) - BigInt(b.tokenId)));
        break;
      case "name":
        arr.sort((a, b) => a.name.localeCompare(b.name));
        break;
    }
    return arr;
  }, [data, sort]);

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-7xl mx-auto">
      <div className="mb-8 flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-3xl sm:text-4xl font-bold text-white"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            MY GALLERY
          </h1>
          <p
            className="text-[#94A3B8] mt-1"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Your 0xPIXEL collection
          </p>
        </div>
        <Link
          href="/pixel"
          className="pixel-btn pixel-btn-secondary pixel-btn-sm"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          + NEW PIXEL ART
        </Link>
      </div>

      {paused === true ? (
        <div
          className="mb-4 px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          Marketplace is paused. Listing and delisting are temporarily disabled.
        </div>
      ) : null}

      {!isConnected ? (
        <NotConnected />
      ) : error ? (
        <ErrorState message={(error as Error).message} onRetry={refresh} />
      ) : isLoading ? (
        <GridSkeleton count={6} />
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
            <div
              className="text-sm text-[#94A3B8]"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {sorted.length} {sorted.length === 1 ? "pixel" : "pixels"}
            </div>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-[#0F0F23] border border-[#2D2D44] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              <option value="newest">Newest</option>
              <option value="oldest">Oldest</option>
              <option value="name">Name</option>
            </select>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 nft-grid">
            {sorted.map((nft) => (
              <OwnedNftCard
                key={nft.tokenId}
                nft={nft}
                isPaused={paused === true}
                onChanged={refresh}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function NotConnected() {
  return (
    <div className="text-center py-20">
      <div className="w-24 h-24 mx-auto mb-6 bg-[#1A1A2E] rounded-2xl flex items-center justify-center border border-[#2D2D44]">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366F1"
          strokeWidth="1.5"
        >
          <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
          <path d="M16 21l3-3-3-3" />
          <path d="M19 18H9" />
        </svg>
      </div>
      <h2
        className="text-xl font-bold text-white mb-2"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Connect Your Wallet
      </h2>
      <p
        className="text-[#94A3B8] max-w-sm mx-auto"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Connect a wallet to view your 0xPIXEL collection
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="w-24 h-24 mx-auto mb-6 bg-[#1A1A2E] rounded-2xl flex items-center justify-center border border-[#2D2D44]">
        <svg
          width="48"
          height="48"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366F1"
          strokeWidth="1.5"
        >
          <path d="M3 3h18v18H3z" />
          <path d="M12 8v8M8 12h8" />
        </svg>
      </div>
      <h2
        className="text-xl font-bold text-white mb-2"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        No Pixels Yet
      </h2>
      <p
        className="text-[#94A3B8] max-w-sm mx-auto mb-8"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Mint your first pixel art NFT
      </p>
      <Link
        href="/pixel"
        className="pixel-btn pixel-btn-indigo pixel-btn-sm"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 20px",
        }}
      >
        START DRAWING
      </Link>
    </div>
  );
}

function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="text-center py-16 bg-[#1A1A2E] border border-red-500/30 rounded-2xl">
      <p
        className="text-red-300 mb-4"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Failed to load gallery: {message}
      </p>
      <button
        onClick={onRetry}
        className="pixel-btn pixel-btn-secondary pixel-btn-sm"
      >
        Retry
      </button>
    </div>
  );
}

function useUserNfts(address: `0x${string}` | undefined, refreshKey: number) {
  const [data, setData] = useState<OwnedNft[] | null>(null);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!address) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/user-nfts?address=${address}`, { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `HTTP ${r.status}`);
        }
        return r.json();
      })
      .then((body: { tokens: OwnedNftApiShape[] }) => {
        const tokens: OwnedNft[] = body.tokens.map((t) => ({
          tokenId: BigInt(t.tokenId),
          name: t.name,
          imageUrl: t.imageUrl,
          listing: t.listing
            ? {
                listingId: BigInt(t.listing.listingId),
                price: BigInt(t.listing.price),
              }
            : null,
        }));
        setData(tokens);
      })
      .catch((err: Error) => {
        if (err.name === "AbortError") return;
        setError(err);
        setData(null);
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });
    return () => ctrl.abort();
  }, [address, refreshKey]);

  return { data, isLoading, error };
}

interface OwnedNftApiShape {
  tokenId: string;
  name: string;
  imageUrl: string;
  listing: { listingId: string; price: string } | null;
}
