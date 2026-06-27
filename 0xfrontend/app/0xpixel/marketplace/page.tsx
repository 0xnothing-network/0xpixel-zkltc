"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useAccount, useWriteContract, useWaitForTransactionReceipt, useBlockNumber } from "wagmi";
import { formatEther } from "viem";
import { PIXEL_MARKETPLACE_ADDRESS, shortenAddress, getMarketplaceTxUrl, getExplorerUrl } from "@/lib/contract";
import { MarketplaceAbi, type RawListing } from "@/lib/marketplaceAbi";
import { GridSkeleton } from "@/components/Skeleton";
import { useToast } from "@/components/Toast";

type SortKey = "newest" | "price-asc" | "price-desc";

interface TokenMetadata {
  tokenId: string;
  name: string;
  imageUrl: string;
  creator: string;
  mintedAt: number;
}

interface ListingsResponse {
  listings: Array<{
    listingId: string;
    tokenId: string;
    price: string;
    seller: `0x${string}`;
    active: boolean;
  }>;
  tokens: Record<string, TokenMetadata | null>;
}

const PAGE_SIZE = 20;

export default function MarketplacePage() {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: false });

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-7xl mx-auto" style={{ fontFamily: "var(--font-departure)" }}>
      <MarketplaceHeader />
      <MarketplaceBody userAddress={address} blockNumber={blockNumber} />
    </div>
  );
}

function MarketplaceHeader() {
  return (
    <div className="flex items-center justify-between mb-8">
      <div>
        <h1
          className="text-3xl font-bold text-white"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          Marketplace
        </h1>
        <p className="text-[#94A3B8] mt-1" style={{ fontFamily: "var(--font-departure)" }}>
          Buy and sell 0xPIXEL NFTs
        </p>
      </div>
    </div>
  );
}

interface BodyProps {
  userAddress: `0x${string}` | undefined;
  blockNumber: bigint | undefined;
}

function MarketplaceBody({ userAddress }: BodyProps) {
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();

  // Cache for API responses (persists across renders)
  const cacheRef = useRef<{ data: ListingsResponse | null; timestamp: number }>({ data: null, timestamp: 0 });
  const CACHE_DURATION = 15_000; // 15 seconds

  const fetchListings = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      // Check cache first
      const now = Date.now();
      if (cacheRef.current.data && now - cacheRef.current.timestamp < CACHE_DURATION) {
        setData(cacheRef.current.data);
        setLoading(false);
        return;
      }

      const r = await fetch(`/api/marketplace/listings?limit=${PAGE_SIZE * 2}`, {
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = (await r.json()) as ListingsResponse;
      cacheRef.current = { data: body, timestamp: now };
      setData(body);
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return;
      console.error("[marketplace] load failed:", err);
      setError("Couldn't load listings. Please retry.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchListings();
    return () => abortRef.current?.abort();
  }, [fetchListings, reloadKey]);

  const listings: RawListing[] = useMemo(() => {
    if (!data) return [];
    return data.listings
      .filter((l) => l.active)
      .map((l) => ({
        listingId: BigInt(l.listingId),
        tokenId: BigInt(l.tokenId),
        price: BigInt(l.price),
        seller: l.seller,
        active: l.active,
      }));
  }, [data]);

  const sorted = useMemo(() => {
    const arr = [...listings];
    switch (sort) {
      case "price-asc":
        arr.sort((a, b) => Number(a.price - b.price));
        break;
      case "price-desc":
        arr.sort((a, b) => Number(b.price - a.price));
        break;
      case "newest":
      default:
        arr.sort((a, b) => Number(b.listingId - a.listingId));
    }
    return arr;
  }, [listings, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const handleRefresh = useCallback(() => {
    setPage(1);
    setReloadKey((k) => k + 1);
  }, []);

  const handleActionComplete = useCallback(() => {
    handleRefresh();
  }, [handleRefresh]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-[#94A3B8]" style={{ fontFamily: "var(--font-departure)" }}>
          {loading && !data
            ? "Loading..."
            : sorted.length === 0
            ? "No listings"
            : `${sorted.length} listing${sorted.length === 1 ? "" : "s"}`}
        </div>
        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as SortKey);
              setPage(1);
            }}
            className="bg-[#0F0F23] border border-[#2D2D44] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#8888ff]"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            <option value="newest">Newest</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
          <button
            onClick={handleRefresh}
            className="px-3 py-2 bg-[#8888ff]/10 border border-[#8888ff]/20 transition-colors"
            aria-label="Refresh"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 0 0-9-9M3 12a9 9 0 0 0 9 9" />
              <path d="M21 3v6h-6M3 21v-6h6" />
            </svg>
          </button>
        </div>
      </div>

      {error ? (
        <div className="text-center py-20">
          <p className="text-red-400 mb-4" style={{ fontFamily: "var(--font-departure)" }}>{error}</p>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-[#8888ff] hover:bg-indigo-600 text-white rounded-lg"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Retry
          </button>
        </div>
      ) : loading && !data ? (
        <GridSkeleton count={8} />
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {pageItems.map((nft) => (
              <ListingCard
                key={nft.listingId.toString()}
                listing={nft}
                userAddress={userAddress}
                meta={data?.tokens[nft.tokenId.toString()] ?? null}
                onActionComplete={handleActionComplete}
              />
            ))}
          </div>
          {totalPages > 1 && (
            <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-4 py-2 bg-[#1A1A2E] border border-[#2D2D44] rounded-lg text-white disabled:opacity-50 hover:border-[#8888ff]/50 transition-colors"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Prev
      </button>
      <span className="text-sm text-[#94A3B8] px-3" style={{ fontFamily: "var(--font-departure)" }}>{page} / {totalPages}</span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-4 py-2 bg-[#1A1A2E] border border-[#2D2D44] rounded-lg text-white disabled:opacity-50 hover:border-[#8888ff]/50 transition-colors"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Next
      </button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20">
      <div className="w-24 h-24 mx-auto mb-6 bg-[#1A1A2E] rounded-2xl flex items-center justify-center border border-[#2D2D44]">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#6366F1" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3h18v18H3z M3 9h18 M9 21V9" />
        </svg>
      </div>
      <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: "var(--font-departure)" }}>No active listings</h2>
      <p className="text-[#94A3B8] mb-6" style={{ fontFamily: "var(--font-departure)" }}>Be the first to list your 0xPIXEL NFT</p>
      <a
        href="/0xpixel"
        className="inline-block px-6 py-3 bg-[#8888ff] hover:bg-indigo-600 text-white font-bold rounded-lg transition-colors"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Create one now
      </a>
    </div>
  );
}

function ListingCard({
  listing,
  userAddress,
  meta,
  onActionComplete,
}: {
  listing: RawListing;
  userAddress: `0x${string}` | undefined;
  meta: TokenMetadata | null;
  onActionComplete: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState<"buy" | "cancel" | null>(null);
  const [showBuyModal, setShowBuyModal] = useState(false);

  const priceEth = formatEther(listing.price);
  const isOwner = userAddress && listing.seller.toLowerCase() === userAddress.toLowerCase();

  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (!isConfirmed || !txHash) return;
    const action = busy === "buy" ? "Purchase" : "Cancelled";
    toast.show({
      title: `${action} successful`,
      description: `${meta?.name || `Token #${listing.tokenId}`}`,
      href: getMarketplaceTxUrl(txHash),
      hrefLabel: "View on Explorer",
    });
    setBusy(null);
    setShowBuyModal(false);
    onActionComplete();
  }, [isConfirmed, txHash, busy, listing.tokenId, meta, toast, onActionComplete]);

  const handleBuy = useCallback(async () => {
    try {
      setBusy("buy");
      const hash = await writeContractAsync({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "buy",
        args: [listing.listingId],
        value: listing.price,
      });
      toast.show({
        title: "Purchase submitted",
        description: "Waiting for confirmation...",
        href: getMarketplaceTxUrl(hash),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Purchase failed");
      setBusy(null);
    }
  }, [listing.listingId, listing.price, writeContractAsync, toast]);

  const handleCancel = useCallback(async () => {
    try {
      setBusy("cancel");
      const hash = await writeContractAsync({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "cancelListing",
        args: [listing.listingId],
      });
      toast.show({
        title: "Cancellation submitted",
        description: "Waiting for confirmation...",
        href: getMarketplaceTxUrl(hash),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Cancel failed");
      setBusy(null);
    }
  }, [listing.listingId, writeContractAsync, toast]);

  return (
    <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] overflow-hidden hover:border-[#8888ff]/40 transition-all hover:shadow-lg hover:shadow-[#8888ff]/10">
      <a
        href={getExplorerUrl(listing.tokenId)}
        target="_blank"
        rel="noopener noreferrer"
        className="block aspect-square bg-gradient-to-br from-[#1A1A2E] to-[#0F0F23] relative overflow-hidden"
      >
        {meta?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.imageUrl}
            alt={meta.name}
            loading="lazy"
            className="w-full h-full object-cover transition-transform hover:scale-105"
            style={{ imageRendering: "pixelated" }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-12 h-12 border-2 border-[#2D2D44] border-t-[#8888ff] rounded-full animate-spin" />
          </div>
        )}
        <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/60 backdrop-blur text-[10px] font-bold text-white">
          #{listing.tokenId.toString()}
        </div>
      </a>

      <div className="p-4 space-y-3" style={{ fontFamily: "var(--font-departure)" }}>
        <div>
          <h3 className="text-white font-bold text-sm truncate">
            {meta?.name || `Token #${listing.tokenId.toString()}`}
          </h3>
          <p className="text-[#64748B] text-[11px] mt-0.5 truncate">
            Seller: {shortenAddress(listing.seller)}
          </p>
        </div>

        <div className="flex items-baseline justify-between">
          <div>
            <p className="text-[#64748B] text-[10px] uppercase tracking-wider">Price</p>
            <p className="text-white font-bold text-lg">{priceEth} zkLTC</p>
          </div>
        </div>

        {isOwner ? (
          <button
            onClick={handleCancel}
            disabled={busy !== null || isConfirming}
            className="w-full py-2.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-bold hover:bg-red-500/30 transition-colors disabled:opacity-50"
          >
            {busy === "cancel" || isConfirming ? "Cancelling..." : "Cancel Listing"}
          </button>
        ) : (
          <button
            onClick={() => setShowBuyModal(true)}
            disabled={busy !== null || isConfirming}
            className="w-full py-2.5 rounded-lg bg-[#8888ff] hover:bg-[#AAAADD] text-white text-xs font-bold transition-colors disabled:opacity-50"
          >
            {busy === "buy" || isConfirming ? "Buying..." : "Buy Now"}
          </button>
        )}
      </div>

      {showBuyModal && (
        <BuyModal
          listing={listing}
          meta={meta}
          busy={busy === "buy"}
          isConfirming={isConfirming}
          onConfirm={handleBuy}
          onClose={() => setShowBuyModal(false)}
        />
      )}
    </div>
  );
}

function BuyModal({
  listing,
  meta,
  busy,
  isConfirming,
  onConfirm,
  onClose,
}: {
  listing: RawListing;
  meta: TokenMetadata | null;
  busy: boolean;
  isConfirming: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const priceEth = formatEther(listing.price);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="bg-[#13133A] rounded-2xl border border-[#2D2D44] max-w-sm w-full overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {meta?.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={meta.imageUrl}
            alt={meta.name}
            className="w-full aspect-square object-cover"
            style={{ imageRendering: "pixelated" }}
          />
        )}
        <div className="p-5 space-y-4" style={{ fontFamily: "var(--font-departure)" }}>
          <div>
            <h3 className="text-white font-bold text-lg">{meta?.name || `Token #${listing.tokenId.toString()}`}</h3>
            <p className="text-[#64748B] text-xs">Sold by {shortenAddress(listing.seller)}</p>
          </div>
          <div className="bg-[#0F0F23] rounded-xl p-4 text-center">
            <p className="text-[#64748B] text-[10px] uppercase tracking-wider">Total price</p>
            <p className="text-white font-bold text-2xl mt-1">{priceEth} zkLTC</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={busy || isConfirming}
              className="flex-1 py-2.5 rounded-lg bg-[#1A1A2E] border border-[#2D2D44] text-white text-xs font-bold hover:border-[#4D4D64] transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={busy || isConfirming}
              className="flex-1 py-2.5 rounded-lg bg-[#8888ff] hover:bg-[#AAAADD] text-white text-xs font-bold transition-colors disabled:opacity-50"
            >
              {isConfirming ? "Confirming..." : busy ? "Submitting..." : "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
