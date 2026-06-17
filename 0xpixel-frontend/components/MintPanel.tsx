"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  useAccount,
  useSendTransaction,
  useWaitForTransactionReceipt,
  useReadContract,
  usePublicClient,
} from "wagmi";
import { decodeEventLog, encodeFunctionData } from "viem";
import { publicClient, PIXEL_NFT_CONTRACT_ADDRESS, getMarketplaceTxUrl } from "@/lib/contract";
import { PixelNFTABI, MintAbi } from "@/lib/abi";
import { PixelButton } from "@/components/PixelButton";
import { pixelDataToPNG, pixelDataToPackedBytes } from "@/lib/gridParser";

interface MintPanelProps {
  pixelData: string[][];
  gridSize: number;
  onMintSuccess: () => void;
}

const DEBOUNCE_MS = 600;

export function MintPanel({ pixelData, gridSize, onMintSuccess }: MintPanelProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  const { address, isConnected } = useAccount();
  const wcClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash: txHash ?? undefined });

  const firedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const hasDrawing = useMemo(
    () => pixelData.some((row) => row.some((cell) => cell !== "transparent")),
    [pixelData]
  );

  const previewBase64 = useMemo(() => {
    if (!hasDrawing) return "";
    return pixelDataToPNG(pixelData, gridSize);
  }, [pixelData, gridSize, hasDrawing]);

  const packedPixelBytes = useMemo(() => {
    if (!hasDrawing) return "0x" as `0x${string}`;
    return pixelDataToPackedBytes(pixelData, gridSize);
  }, [pixelData, gridSize, hasDrawing]);

  // Debounce so we don't spam checkOriginal on every pixel stroke.
  const [debouncedPackedBytes, setDebouncedPackedBytes] = useState<`0x${string}`>("0x");

  useEffect(() => {
    if (!hasDrawing) {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      setDebouncedPackedBytes("0x");
      return;
    }
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedPackedBytes(packedPixelBytes);
    }, DEBOUNCE_MS);
  }, [packedPixelBytes, hasDrawing]);

  const isCheckingOriginal = debouncedPackedBytes === "0x" && hasDrawing;

  const { data: isOriginal } = useReadContract({
    address: PIXEL_NFT_CONTRACT_ADDRESS,
    abi: PixelNFTABI,
    functionName: "checkOriginal",
    args: [debouncedPackedBytes, BigInt(gridSize)],
    query: {
      enabled: debouncedPackedBytes !== "0x",
    },
  });

  // Once tx confirms, decode the Minted event from the receipt to get the
  // real tokenId. Calling onMintSuccess with a hard-coded 0n used to break
  // gallery refresh — this fixes that race.
  useEffect(() => {
    if (!isConfirmed || !txHash || firedRef.current) return;
    firedRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const client = wcClient ?? publicClient;
        const receipt = await client.getTransactionReceipt({ hash: txHash });
        for (const log of receipt.logs) {
          try {
            const decoded = decodeEventLog({
              abi: PixelNFTABI,
              data: log.data,
              topics: log.topics,
            });
            if (decoded.eventName === "Minted") {
              // Could surface the new tokenId in a toast here.
              if (!cancelled) onMintSuccess();
              return;
            }
          } catch {
            // not our event, skip
          }
        }
        if (!cancelled) onMintSuccess();
      } catch (err) {
        console.error("[Mint] failed to decode receipt:", err);
        if (!cancelled) onMintSuccess();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isConfirmed, txHash, wcClient, onMintSuccess]);

  const handleMint = useCallback(async () => {
    if (!isConnected || !address) {
      setError("Please connect your wallet first!");
      return;
    }
    if (!name.trim()) {
      setError("Please enter a name for your pixel art!");
      return;
    }
    if (!hasDrawing) {
      setError("Please draw something first!");
      return;
    }
    if (isOriginal === false) {
      setError("This artwork has already been minted!");
      return;
    }

    setIsLoading(true);
    setTxHash(null);
    setError(null);
    firedRef.current = false;

    try {
      if (packedPixelBytes === "0x" || packedPixelBytes.length <= 2) {
        setError("Please draw something first!");
        setIsLoading(false);
        return;
      }

      const data = encodeFunctionData({
        abi: MintAbi,
        functionName: "mint",
        args: [name.trim(), BigInt(gridSize), packedPixelBytes],
      });

      // Calldata is huge (pixel data stored on-chain), so intrinsic gas alone
      // exceeds viem's default ceiling. Compute gas from calldata size and
      // add a comfortable margin for contract execution. Cap at 30M to stay
      // well under MetaMask's ~50M hard cap while covering RLE-packed 64x64.
      const dataHex = data.slice(2);
      let zeroBytes = 0;
      let nonZeroBytes = 0;
      for (let i = 0; i < dataHex.length; i += 2) {
        const byte = parseInt(dataHex.slice(i, i + 2), 16);
        if (byte === 0) zeroBytes++;
        else nonZeroBytes++;
      }
      const intrinsic =
        21_000n + 16n * BigInt(zeroBytes) + 68n * BigInt(nonZeroBytes);
      const desiredGas = intrinsic * 2n;
      const cap = 30_000_000n;
      const floor = 1_500_000n;
      const gasLimit = desiredGas < floor ? floor : desiredGas > cap ? cap : desiredGas;

      const hash = await sendTransactionAsync({
        to: PIXEL_NFT_CONTRACT_ADDRESS,
        value: 0n,
        data,
        gas: gasLimit,
      });

      setTxHash(hash);
    } catch (err: unknown) {
      const e = err as { shortMessage?: string; message?: string; details?: string };
      const msg = e.shortMessage || e.message || e.details || "";
      console.error("Mint error:", err);
      if (msg.includes("already minted")) {
        setError("This artwork has already been minted!");
      } else {
        setError(msg || "Failed to mint. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  }, [
    isConnected,
    address,
    name,
    hasDrawing,
    isOriginal,
    gridSize,
    sendTransactionAsync,
    packedPixelBytes,
  ]);

  const canMint =
    !isLoading &&
    !isConfirming &&
    !!name.trim() &&
    hasDrawing &&
    isOriginal === true;

  const gridByteSize = useMemo(() => {
    const pixels = gridSize * gridSize;
    return ((pixels * 7) / 1024).toFixed(1);
  }, [gridSize]);

  if (!mounted) {
    return (
      <div className="bg-[#1A1A2E] rounded-2xl p-4 space-y-4 border border-[#2D2D44]">
        <div className="space-y-3">
          <div className="h-9 bg-white/5 rounded-xl animate-pulse" />
          <div className="h-16 bg-white/5 rounded-xl animate-pulse" />
          <div className="h-9 bg-white/5 rounded-xl animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] overflow-hidden">
      <div className="px-4 py-3 border-b border-[#2D2D44]">
        <h3
          className="text-white font-bold text-sm"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          MINT YOUR ARTWORK
        </h3>
      </div>

      <div className="p-4 space-y-4">
        <div
          className="relative rounded-xl overflow-hidden border"
          style={{
            background: "#0F0F23",
            aspectRatio: "1 / 1",
            borderColor: hasDrawing
              ? "rgba(99,102,241,0.15)"
              : "rgba(255,255,255,0.05)",
          }}
        >
          {hasDrawing ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={`data:image/png;base64,${previewBase64}`}
              alt="NFT Preview"
              className="w-full h-full object-contain"
              style={{ imageRendering: "pixelated" }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2">
              <svg
                width="40"
                height="40"
                fill="none"
                stroke="rgba(255,255,255,0.1)"
                strokeWidth="1"
                viewBox="0 0 24 24"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M3 9h18M9 21V9" />
              </svg>
              <p
                className="text-[#374151] text-[10px] text-center px-4"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                Draw something to see preview
              </p>
            </div>
          )}
          {hasDrawing ? (
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              {isCheckingOriginal ? (
                <span
                  className="flex items-center gap-1 text-[9px] px-2 py-1 rounded-md bg-black/40 text-indigo-300"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  <span className="w-2.5 h-2.5 border border-indigo-400/50 border-t-indigo-400 rounded-full animate-spin" />
                  CHECKING
                </span>
              ) : isOriginal === false ? (
                <span
                  className="text-[9px] px-2 py-1 rounded-md bg-red-500/20 text-red-300 border border-red-500/30 font-bold"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  TAKEN
                </span>
              ) : (
                <span
                  className="text-[9px] px-2 py-1 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  ORIGINAL
                </span>
              )}
            </div>
          ) : null}
        </div>

        <div
          className="flex items-center justify-between text-[11px]"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          <div className="flex items-center gap-1">
            <span className="text-[#64748B]">Grid:</span>
            <span className="text-white font-medium">
              {gridSize}×{gridSize}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[#64748B]">Size:</span>
            <span className="text-white font-medium">~{gridByteSize} KB</span>
          </div>
        </div>

        <div className="h-px bg-[#2D2D44]" />

        {!isConnected ? (
          <div className="flex items-center gap-3 py-1">
            <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">
              <svg
                width="16"
                height="16"
                fill="none"
                stroke="#6366F1"
                strokeWidth="1.5"
                viewBox="0 0 24 24"
              >
                <path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h7" />
                <path d="M16 16l2 2 4-4" />
              </svg>
            </div>
            <p className="text-[#64748B] text-sm">Connect wallet to mint</p>
          </div>
        ) : (
          <>
            <div>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 32))}
                placeholder="Artwork name"
                maxLength={32}
                className="w-full bg-[#1A1A2E] border border-[#2D2D44] rounded-xl px-3.5 py-2.5 text-white placeholder-[#374151] focus:outline-none focus:border-indigo-500/50 transition-all text-sm"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>

            <div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value.slice(0, 256))}
                placeholder="Description (optional, not stored on-chain)"
                maxLength={256}
                rows={2}
                className="w-full bg-[#1A1A2E] border border-[#2D2D44] rounded-xl px-3.5 py-2.5 text-white placeholder-[#374151] focus:outline-none focus:border-indigo-500/50 transition-all resize-none text-sm"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>

            {error ? (
              <div className="p-2.5 rounded-xl border flex items-center gap-2 bg-red-500/10 border-red-500/30">
                <svg
                  className="w-4 h-4 flex-shrink-0"
                  fill="none"
                  stroke="#f87171"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-red-300 text-xs">{error}</p>
              </div>
            ) : null}

            {txHash ? (
              <div className="p-2.5 rounded-xl border bg-emerald-500/10 border-emerald-500/30">
                <p
                  className="text-emerald-300 text-xs font-medium mb-1"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  {isConfirmed
                    ? "Minted successfully!"
                    : isConfirming
                    ? "Waiting for confirmation..."
                    : "Transaction submitted"}
                </p>
                <a
                  href={getMarketplaceTxUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] hover:underline flex items-center gap-1 text-indigo-300"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  View on Explorer
                  <svg
                    width="9"
                    height="9"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                    <path d="M15 3h6v6" />
                    <path d="M10 14L21 3" />
                  </svg>
                </a>
              </div>
            ) : null}

            <PixelButton
              variant="indigo"
              onClick={handleMint}
              disabled={!canMint}
              loading={isLoading || isConfirming || isCheckingOriginal}
              className="w-full justify-center py-3"
            >
              {isConfirming
                ? "CONFIRMING..."
                : isCheckingOriginal
                ? "CHECKING..."
                : isOriginal === false
                ? "ALREADY MINTED"
                : !hasDrawing
                ? "DRAW FIRST"
                : !name.trim()
                ? "ENTER NAME"
                : (
                  <>
                    <svg
                      width="13"
                      height="13"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                      style={{
                        display: "inline",
                        verticalAlign: "middle",
                        marginRight: 6,
                      }}
                    >
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                    MINT NFT
                  </>
                )}
            </PixelButton>
          </>
        )}
      </div>
    </div>
  );
}
