"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useBlockNumber, useAccount } from "wagmi";
import { formatEther } from "viem";
import {
  PIXEL_MARKETPLACE_ADDRESS,
  getMarketplaceTxUrl,
  shortenAddress,
} from "@/lib/contract";
import { MarketplaceAbi, type RawListing } from "@/lib/marketplaceAbi";
import { GridSkeleton } from "@/components/Skeleton";

type SortKey = "newest" | "price-asc" | "price-desc";

interface TokenMetadata {
  tokenId: string;
  name: string;
  imageUrl: string;
  creator: string;
  mintedAt: number;
}

const PAGE_SIZE = 24;
const SCAN_BATCH = 200; // how many listingIds to scan per call

export default function MarketplacePage() {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  return (
    <div className="min-h-[calc(100vh-64px)] px-4 py-8 max-w-7xl mx-auto">
      <MarketplaceHeader />
      <MarketplaceBody
        userAddress={address}
        blockNumber={blockNumber}
      />
    </div>
  );
}

function MarketplaceHeader() {
  const { data: paused } = useReadContract({
    address: PIXEL_MARKETPLACE_ADDRESS,
    abi: MarketplaceAbi,
    functionName: "paused",
  });

  return (
    <div className="mb-8 space-y-3">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1
            className="text-3xl sm:text-4xl font-bold text-white"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            MARKETPLACE
          </h1>
          <p
            className="text-[#94A3B8] mt-1"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            0xPIXEL pixel art for sale
          </p>
        </div>
        <Link
          href="/pixel/gallery"
          className="pixel-btn pixel-btn-secondary pixel-btn-sm"
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          MY GALLERY
        </Link>
      </div>
      {paused === true ? (
        <div
          className="px-4 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          Marketplace is paused. Buying and listing are temporarily disabled.
        </div>
      ) : null}
    </div>
  );
}

interface BodyProps {
  userAddress: `0x${string}` | undefined;
  blockNumber: bigint | undefined;
}

function MarketplaceBody({ userAddress, blockNumber }: BodyProps) {
  const [sort, setSort] = useState<SortKey>("newest");
  const [page, setPage] = useState(1);

  // Pull the latest chunk of listingIds from the marketplace. The contract
  // has no public counter, so we walk backwards from the latest seen.
  const [activeIds, setActiveIds] = useState<bigint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Map tokenId (string) -> display metadata (name + image). Hydrated
  // lazily as cards mount so the marketplace header renders fast.
  const [tokenMeta, setTokenMeta] = useState<Record<string, TokenMetadata | null>>({});
  const metaReqRef = useRef<{ ids: Set<string>; pending: boolean }>({
    ids: new Set(),
    pending: false,
  });

  const requestTokenMeta = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    for (const id of ids) metaReqRef.current.ids.add(id);
    if (metaReqRef.current.pending) return;

    const drain = async () => {
      metaReqRef.current.pending = true;
      try {
        // Loop in case more ids queue up between requests.
        while (metaReqRef.current.ids.size > 0) {
          const batch = Array.from(metaReqRef.current.ids).slice(0, 96);
          for (const id of batch) metaReqRef.current.ids.delete(id);
          try {
            const r = await fetch(`/api/token-metadata?ids=${batch.join(",")}`);
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            const body = (await r.json()) as { tokens: Record<string, TokenMetadata | null> };
            setTokenMeta((prev) => ({ ...prev, ...body.tokens }));
          } catch (err) {
            console.error("[marketplace] token-metadata fetch failed:", err);
            // Don't spin forever on a single failure.
            break;
          }
        }
      } finally {
        metaReqRef.current.pending = false;
      }
    };
    void drain();
  }, []);

  const {
    data: idBatch,
    isLoading: idsLoading,
    refetch: refetchIds,
    error: idsError,
  } = useReadContract({
    address: PIXEL_MARKETPLACE_ADDRESS,
    abi: MarketplaceAbi,
    functionName: "getActiveListings",
    args: [0n, BigInt(SCAN_BATCH)],
  });

  // Sort & paginate
  useEffect(() => {
    if (idsError) {
      setError(idsError.message);
      setActiveIds([]);
    } else if (idBatch) {
      const ids = idBatch as bigint[];
      setActiveIds(ids);
      setError(null);
    }
  }, [idBatch, idsError, blockNumber]);

  const visibleIds = useMemo(() => {
    if (!activeIds) return [];
    return activeIds;
  }, [activeIds]);

  const {
    data: listingDetails,
    isLoading: detailsLoading,
    refetch: refetchDetails,
  } = useReadContracts({
    allowFailure: true,
    query: { enabled: visibleIds.length > 0 },
    contracts: visibleIds.map((id) => ({
      address: PIXEL_MARKETPLACE_ADDRESS,
      abi: MarketplaceAbi,
      functionName: "listings" as const,
      args: [id] as const,
    })),
  });

  const listings: RawListing[] = useMemo(() => {
    if (!listingDetails) return [];
    const out: RawListing[] = [];
    visibleIds.forEach((id, i) => {
      const r = listingDetails[i] as
        | { status: "success"; result: readonly [`0x${string}`, bigint, bigint, `0x${string}`, boolean] }
        | { status: "failure"; error: Error }
        | undefined;
      if (r && r.status === "success") {
        const v = r.result;
        if (v[4] === true) {
          out.push({
            listingId: id,
            tokenId: v[1],
            price: v[2],
            seller: v[3],
            active: v[4],
          });
        }
      }
    });
    return out;
  }, [visibleIds, listingDetails]);

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
  const pageItems = sorted.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE
  );

  // Request on-chain token metadata for whatever is currently on screen.
  // Skips ids we've already resolved, so flipping pages doesn't re-fetch.
  useEffect(() => {
    if (pageItems.length === 0) return;
    const needed = pageItems
      .map((n) => n.tokenId.toString())
      .filter((id) => !(id in tokenMeta));
    if (needed.length > 0) requestTokenMeta(needed);
  }, [pageItems, tokenMeta, requestTokenMeta]);

  const handleRefresh = useCallback(() => {
    setPage(1);
    setTokenMeta({});
    metaReqRef.current.ids.clear();
    refetchIds();
    refetchDetails();
  }, [refetchIds, refetchDetails]);

  const isLoading = idsLoading || detailsLoading;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div
          className="text-sm text-[#94A3B8]"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          {isLoading
            ? "Loading…"
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
            className="bg-[#0F0F23] border border-[#2D2D44] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            <option value="newest">Newest</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
          </select>
          <button
            onClick={handleRefresh}
            className="pixel-btn pixel-btn-secondary pixel-btn-icon"
            title="Refresh"
            aria-label="Refresh"
          >
            <RefreshIcon />
          </button>
        </div>
      </div>

      {error ? (
        <ErrorState message={error} onRetry={handleRefresh} />
      ) : isLoading && sorted.length === 0 ? (
        <GridSkeleton count={8} />
      ) : sorted.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 nft-grid">
            {pageItems.map((nft) => (
              <ListingCard
                key={nft.listingId.toString()}
                listing={nft}
                userAddress={userAddress}
                isPaused={false}
                meta={tokenMeta[nft.tokenId.toString()] ?? null}
                onActionComplete={handleRefresh}
              />
            ))}
          </div>
          {totalPages > 1 ? (
            <Pagination
              page={safePage}
              totalPages={totalPages}
              onChange={setPage}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-2 pt-4">
      <button
        onClick={() => onChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="pixel-btn pixel-btn-secondary pixel-btn-sm"
      >
        Prev
      </button>
      <span
        className="text-sm text-[#94A3B8] px-3"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        {page} / {totalPages}
      </span>
      <button
        onClick={() => onChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="pixel-btn pixel-btn-secondary pixel-btn-sm"
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
        No NFTs for Sale
      </h2>
      <p
        className="text-[#94A3B8] max-w-sm mx-auto mb-8"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        Be the first to list your 0xPIXEL NFT
      </p>
      <Link
        href="/pixel/gallery"
        className="pixel-btn pixel-btn-indigo pixel-btn-sm"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 20px",
        }}
      >
        MY GALLERY
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
        Failed to load marketplace: {message}
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

interface CardProps {
  listing: RawListing;
  userAddress: `0x${string}` | undefined;
  isPaused: boolean;
  meta: TokenMetadata | null;
  onActionComplete: () => void;
}

function ListingCard({
  listing,
  userAddress,
  isPaused,
  meta,
  onActionComplete,
}: CardProps) {
  const isOwner =
    !!userAddress &&
    userAddress.toLowerCase() === listing.seller.toLowerCase();

  // Show the on-chain name once we have it, but keep a visible token id
  // beneath so users can always reference it. Falls back to a skeleton
  // while loading and to "Token #N" if the metadata fetch failed.
  const tokenIdStr = listing.tokenId.toString();
  const displayName = meta?.name ?? (meta === undefined ? "" : `Token #${tokenIdStr}`);

  return (
    <div className="nft-card group bg-[#1A1A2E] rounded-2xl overflow-hidden border border-[#2D2D44] hover:border-indigo-500/50 transition-all duration-300 hover:shadow-xl hover:shadow-indigo-500/10 hover:-translate-y-1">
      <ListingImage
        tokenId={listing.tokenId}
        prefetchedUrl={meta?.imageUrl ?? undefined}
      />
      <div className="p-4 space-y-3">
        <div>
          <div
            className="text-[10px] text-[#64748B] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            0xPIXEL · #{tokenIdStr}
          </div>
          <h3
            className="text-white font-bold text-base mt-0.5 truncate"
            style={{ fontFamily: "var(--font-departure)" }}
            title={displayName}
          >
            {meta?.name ? (
              displayName
            ) : meta === null ? (
              <span className="text-[#94A3B8] font-medium">Token #{tokenIdStr}</span>
            ) : (
              <span
                className="inline-block h-4 w-32 rounded bg-white/5 animate-pulse"
                aria-label="Loading name"
              />
            )}
          </h3>
          <div
            className="text-[#94A3B8] text-xs mt-0.5 truncate"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Seller: {shortenAddress(listing.seller)}
          </div>
        </div>
        <div className="pt-3 border-t border-[#2D2D44] space-y-2">
          <div className="flex items-center justify-between">
            <span
              className="text-[#64748B] text-sm"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              Price
            </span>
            <span
              className="text-emerald-400 font-bold text-xl"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {formatEther(listing.price)}{" "}
              <span className="text-sm font-medium">zkLTC</span>
            </span>
          </div>
          {isOwner ? (
            <CancelListingButton
              listingId={listing.listingId}
              disabled={isPaused}
              onSuccess={onActionComplete}
            />
          ) : (
            <BuyButton
              listingId={listing.listingId}
              priceWei={listing.price}
              disabled={isPaused}
              onSuccess={onActionComplete}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ListingImage({
  tokenId,
  prefetchedUrl,
}: {
  tokenId: bigint;
  prefetchedUrl?: string;
}) {
  // If the parent already has the image (e.g. from /api/token-metadata),
  // skip the extra round-trip and render straight away.
  const [src, setSrc] = useState<string>(prefetchedUrl ?? "");
  const [loading, setLoading] = useState(!prefetchedUrl);

  useEffect(() => {
    if (prefetchedUrl) {
      setSrc(prefetchedUrl);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setSrc("");
    fetch(`/api/listing-image?tokenId=${tokenId.toString()}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.imageUrl === "string") {
          setSrc(data.imageUrl);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenId, prefetchedUrl]);

  return (
    <div className="relative aspect-square bg-[#0F0F23] flex items-center justify-center overflow-hidden">
      {loading ? (
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={`Token #${tokenId.toString()}`}
          className="w-full h-full object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span
          className="text-[#64748B] text-xs"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          No image
        </span>
      )}
    </div>
  );
}

function BuyButton({
  listingId,
  priceWei,
  disabled,
  onSuccess,
}: {
  listingId: bigint;
  priceWei: bigint;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const { writeContractAsync, isPending, data: txHash, error } =
    useWriteContract();
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  const firedRef = useRef(false);

  useEffect(() => {
    if (isSuccess && !firedRef.current) {
      firedRef.current = true;
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleBuy = async () => {
    firedRef.current = false;
    try {
      await writeContractAsync({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "buy",
        args: [listingId],
        value: priceWei,
      });
    } catch {
      // surfaced via error below
    }
  };

  const busy = isPending || waiting;

  return (
    <div className="space-y-1">
      <button
        onClick={handleBuy}
        disabled={busy || disabled}
        className="pixel-btn pixel-btn-emerald w-full"
        style={{ padding: "10px 16px" }}
      >
        {busy ? (
          <span className="flex items-center justify-center gap-2">
            <span className="pixel-spinner" />{" "}
            {waiting ? "Confirming…" : "Submitting…"}
          </span>
        ) : (
          "BUY"
        )}
      </button>
      {txHash ? (
        <a
          href={getMarketplaceTxUrl(txHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-xs text-indigo-300 hover:text-indigo-200 underline"
        >
          View on Explorer
        </a>
      ) : null}
      {error ? (
        <p className="text-xs text-red-300 break-all">{error.message}</p>
      ) : null}
    </div>
  );
}

function CancelListingButton({
  listingId,
  disabled,
  onSuccess,
}: {
  listingId: bigint;
  disabled: boolean;
  onSuccess: () => void;
}) {
  const { writeContractAsync, isPending, data: txHash, error } =
    useWriteContract();
  const { isLoading: waiting, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
  });
  const firedRef = useRef(false);

  useEffect(() => {
    if (isSuccess && !firedRef.current) {
      firedRef.current = true;
      onSuccess();
    }
  }, [isSuccess, onSuccess]);

  const handleCancel = async () => {
    firedRef.current = false;
    try {
      await writeContractAsync({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "cancelListing",
        args: [listingId],
      });
    } catch {
      // surfaced via error below
    }
  };

  const busy = isPending || waiting;

  return (
    <div className="space-y-1">
      <button
        onClick={handleCancel}
        disabled={busy || disabled}
        className="pixel-btn pixel-btn-red w-full"
        style={{ padding: "10px 16px" }}
      >
        {busy ? (
          <span className="flex items-center justify-center gap-2">
            <span className="pixel-spinner" />{" "}
            {waiting ? "Confirming…" : "Submitting…"}
          </span>
        ) : (
          "CANCEL LISTING"
        )}
      </button>
      {error ? (
        <p className="text-xs text-red-300 break-all">{error.message}</p>
      ) : null}
    </div>
  );
}

function RefreshIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}
