"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { gsap } from "gsap";
import { useGSAP } from "@gsap/react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther, formatEther } from "viem";
import {
  PIXEL_NFT_CONTRACT_ADDRESS,
  PIXEL_MARKETPLACE_ADDRESS,
  getExplorerUrl,
  getMarketplaceTxUrl,
} from "@/lib/contract";
import { PixelNFTABI } from "@/lib/abi";
import { MarketplaceAbi } from "@/lib/marketplaceAbi";

gsap.registerPlugin(useGSAP);

export interface OwnedNft {
  tokenId: bigint;
  name: string;
  imageUrl: string;
  listing: {
    listingId: bigint;
    price: bigint;
  } | null;
}

interface CardProps {
  nft: OwnedNft;
  isPaused: boolean;
  onChanged: () => void;
}

export function OwnedNftCard({ nft, isPaused, onChanged }: CardProps) {
  const [mode, setMode] = useState<"idle" | "list">("idle");
  const [price, setPrice] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useGSAP(() => {
    if (!cardRef.current) return;

    const card = cardRef.current;

    const handleMouseEnter = () => {
      gsap.to(card, {
        y: -8,
        scale: 1.02,
        duration: 0.4,
        ease: "power2.out",
      });
    };

    const handleMouseLeave = () => {
      gsap.to(card, {
        y: 0,
        scale: 1,
        duration: 0.4,
        ease: "power2.out",
      });
    };

    card.addEventListener("mouseenter", handleMouseEnter);
    card.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      card.removeEventListener("mouseenter", handleMouseEnter);
      card.removeEventListener("mouseleave", handleMouseLeave);
    };
  }, { scope: cardRef });

  return (
    <div
      ref={cardRef}
      className="nft-card group bg-[#1A1A2E] rounded-2xl overflow-hidden border border-[#2D2D44] hover:border-indigo-500/50 transition-shadow duration-300 hover:shadow-xl hover:shadow-indigo-500/10"
    >
      <Link
        href={getExplorerUrl(nft.tokenId)}
        target="_blank"
        rel="noopener noreferrer"
        className="block relative aspect-square bg-[#0F0F23] flex items-center justify-center overflow-hidden"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={nft.imageUrl}
          alt={nft.name}
          className="w-full h-full object-contain transition-transform group-hover:scale-105"
          style={{ imageRendering: "pixelated" }}
          loading="eager"
          fetchPriority="high"
        />
        {nft.listing ? (
          <div
            className="absolute top-2 left-2 px-2 py-1 rounded-md bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            FOR SALE · {formatEther(nft.listing.price)} zkLTC
          </div>
        ) : null}
      </Link>
      <div className="p-4 space-y-3">
        <div>
          <div
            className="text-[10px] text-[#64748B] uppercase tracking-wider"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            0xPIXEL
          </div>
          <h3
            className="text-white font-bold text-base truncate"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            {nft.name || "Untitled"}
          </h3>
          <div
            className="text-[#94A3B8] text-xs mt-0.5"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            #{nft.tokenId.toString()}
          </div>
        </div>

        {nft.listing ? (
          <CancelListingControl
            listingId={nft.listing.listingId}
            disabled={isPaused}
            onSuccess={onChanged}
          />
        ) : mode === "list" ? (
          <ListForSaleControl
            tokenId={nft.tokenId}
            price={price}
            onPriceChange={setPrice}
            onCancel={() => {
              setMode("idle");
              setPrice("");
            }}
            disabled={isPaused}
            onSuccess={() => {
              setMode("idle");
              setPrice("");
              onChanged();
            }}
          />
        ) : (
          <button
            onClick={() => setMode("list")}
            disabled={isPaused}
            className="pixel-btn pixel-btn-indigo w-full"
            style={{ padding: "10px 16px" }}
          >
            LIST FOR SALE
          </button>
        )}
      </div>
    </div>
  );
}

function ListForSaleControl({
  tokenId,
  price,
  onPriceChange,
  onCancel,
  onSuccess,
  disabled,
}: {
  tokenId: bigint;
  price: string;
  onPriceChange: (s: string) => void;
  onCancel: () => void;
  onSuccess: () => void;
  disabled: boolean;
}) {
  const { writeContractAsync, isPending, data: approveHash, error: approveErr } =
    useWriteContract();
  const { isSuccess: approved, isLoading: waitingApprove } =
    useWaitForTransactionReceipt({ hash: approveHash });
  const {
    writeContractAsync: writeListAsync,
    isPending: listing,
    data: listHash,
    error: listErr,
  } = useWriteContract();
  const { isSuccess: listed, isLoading: waitingList } =
    useWaitForTransactionReceipt({ hash: listHash });
  const firedRef = useRef(false);

  useEffect(() => {
    if (listed && !firedRef.current) {
      firedRef.current = true;
      onSuccess();
    }
  }, [listed, onSuccess]);

  const priceValid = /^\d+(?:\.\d+)?$/.test(price) && parseEther(price) > 0n;
  const busy = isPending || waitingApprove || listing || waitingList;

  const doList = useCallback(async () => {
    if (!priceValid) return;
    try {
      await writeListAsync({
        address: PIXEL_MARKETPLACE_ADDRESS,
        abi: MarketplaceAbi,
        functionName: "list",
        args: [PIXEL_NFT_CONTRACT_ADDRESS, tokenId, parseEther(price)],
      });
    } catch {
      // surfaced via listErr
    }
  }, [priceValid, writeListAsync, price, tokenId]);

  useEffect(() => {
    if (approved && price && !firedRef.current && !listing && !listHash) {
      void doList();
    }
  }, [approved, price, listing, listHash, doList]);

  const handleSubmit = async () => {
    firedRef.current = false;
    if (!priceValid) return;
    try {
      await writeContractAsync({
        address: PIXEL_NFT_CONTRACT_ADDRESS,
        abi: PixelNFTABI,
        functionName: "approve",
        args: [PIXEL_MARKETPLACE_ADDRESS, tokenId],
      });
    } catch {
      // surfaced via approveErr
    }
  };

  return (
    <div className="space-y-2">
      <input
        type="number"
        step="0.001"
        min="0"
        value={price}
        onChange={(e) => onPriceChange(e.target.value)}
        placeholder="Price (zkLTC)"
        className="w-full bg-[#0F0F23] border border-[#2D2D44] text-white text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-indigo-500"
        style={{ fontFamily: "var(--font-departure)" }}
        disabled={busy}
      />
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onCancel}
          disabled={busy}
          className="pixel-btn pixel-btn-secondary pixel-btn-sm"
        >
          CANCEL
        </button>
        <button
          onClick={handleSubmit}
          disabled={busy || !priceValid || disabled}
          className="pixel-btn pixel-btn-emerald pixel-btn-sm"
        >
          {busy ? (
            <span className="flex items-center justify-center gap-1">
              <span className="pixel-spinner" />
              {waitingApprove
                ? "Approving…"
                : waitingList
                ? "Listing…"
                : "Submitting…"}
            </span>
          ) : (
            "CONFIRM"
          )}
        </button>
      </div>
      {approveHash ? (
        <a
          href={getMarketplaceTxUrl(approveHash)}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-center text-[10px] text-indigo-300 hover:text-indigo-200 underline"
        >
          Approval tx ↗
        </a>
      ) : null}
      {approveErr || listErr ? (
        <p className="text-xs text-red-300 break-all">
          {(approveErr || listErr)?.message}
        </p>
      ) : null}
    </div>
  );
}

function CancelListingControl({
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
      // surfaced via error
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
          "REMOVE LISTING"
        )}
      </button>
      {error ? (
        <p className="text-xs text-red-300 break-all">{error.message}</p>
      ) : null}
    </div>
  );
}
