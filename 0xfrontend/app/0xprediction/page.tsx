"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import {
  formatUnits,
  keccak256,
  maxUint256,
  parseUnits,
  toBytes,
} from "viem";
import { litvm } from "@/config/wagmi";
import { NUSD_ABI, NUSD_ADDRESS } from "@/lib/NUSDContract";
import {
  PREDICTION_ABI,
  PREDICTION_ADDRESS,
  PREDICTION_ASSETS,
} from "@/lib/0xPredictionAbi";
import {
  NUSD_FAUCET_ABI,
  NUSD_FAUCET_ADDRESS,
} from "@/lib/0xNUSDFaucetAbi";
import { useToast } from "@/components/Toast";
import { useDocumentVisibility } from "@/app/hooks/useDocumentVisibility";

type AssetTuple = readonly [
  string,
  `0x${string}`,
  number,
  number,
  number,
  bigint,
  bigint,
  boolean,
  boolean
];

type CanBetTuple = readonly [boolean, bigint, bigint, bigint, bigint, bigint];
type RoundCoreTuple = readonly [
  `0x${string}`,
  string,
  `0x${string}`,
  bigint,
  bigint,
  bigint,
  bigint,
  number,
  boolean,
  boolean
];
type RoundPoolsTuple = readonly [bigint, bigint, bigint, bigint, bigint, bigint];
type RoundTimesTuple = readonly [bigint, bigint, bigint, bigint];
type PositionTuple = readonly [bigint, bigint, boolean];
type PreviewTuple = readonly [bigint, bigint, bigint];
type LatestPriceTuple = readonly [bigint, bigint, bigint];

type HistoryItem = {
  roundId: bigint;
  symbol: string;
  upAmount: bigint;
  downAmount: bigint;
  claimable: bigint;
  claimed: boolean;
  outcome: string;
  result: "Win" | "Loss" | "Refund" | "Pending" | "Mixed";
  txHash?: `0x${string}`;
};

type HistoryApiItem = {
  roundId: string;
  symbol: string;
  upAmount: string;
  downAmount: string;
  claimable: string;
  claimed: boolean;
  outcome: number;
  txHash?: `0x${string}`;
};

type HistoryApiResponse = {
  history?: HistoryApiItem[];
  error?: string;
};

const DEFAULT_AMOUNT = "100";
const PRICE_DECIMALS = 18;
const NUSD_DECIMALS = 18;
const OUTCOME_LABELS = ["Pending", "UP", "DOWN", "DRAW", "Cancelled"] as const;

function assetIdOf(symbol: string): `0x${string}` {
  return keccak256(toBytes(symbol));
}

function shortAddress(address?: string) {
  if (!address) return "0x0000...0000";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatNusd(value?: bigint, digits = 2) {
  if (value === undefined) return "0";
  const numeric = Number(formatUnits(value, NUSD_DECIMALS));
  if (!Number.isFinite(numeric)) return formatUnits(value, NUSD_DECIMALS);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: numeric > 0 && numeric < 1 ? Math.min(digits, 4) : 0,
  }).format(numeric);
}

function formatPrice(value?: bigint, digits = 4) {
  if (value === undefined) return "--";
  const numeric = Number(formatUnits(value, PRICE_DECIMALS));
  if (!Number.isFinite(numeric)) return formatUnits(value, PRICE_DECIMALS);
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: numeric >= 100 ? 2 : digits,
    minimumFractionDigits: numeric >= 100 ? 2 : 0,
  }).format(numeric);
}

function timeLeft(timestamp?: bigint, nowMs = Date.now()) {
  if (!timestamp || nowMs <= 0) return "--";
  const seconds = Math.max(0, Number(timestamp) - Math.floor(nowMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function durationLeft(seconds?: bigint) {
  if (seconds === undefined) return "--";
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return "Ready";
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const rest = value % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function formatClock(timestamp?: bigint) {
  if (!timestamp) return "--";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(Number(timestamp) * 1000);
}

function percentOf(part: bigint, total: bigint) {
  if (total <= 0n) return 0;
  return Number((part * 10000n) / total) / 100;
}

function outcomeLabel(index: number) {
  return index >= 0 && index < OUTCOME_LABELS.length
    ? OUTCOME_LABELS[index]
    : "Unknown";
}

function historyResult(outcomeIndex: number, upAmount: bigint, downAmount: bigint) {
  if (outcomeIndex === 0) return "Pending" as const;
  if (outcomeIndex === 3 || outcomeIndex === 4) return "Refund" as const;

  const wonUp = outcomeIndex === 1 && upAmount > 0n;
  const wonDown = outcomeIndex === 2 && downAmount > 0n;
  const lostUp = outcomeIndex === 2 && upAmount > 0n;
  const lostDown = outcomeIndex === 1 && downAmount > 0n;

  if ((wonUp || wonDown) && (lostUp || lostDown)) return "Mixed" as const;
  if (wonUp || wonDown) return "Win" as const;
  return "Loss" as const;
}

function StatusBadge({
  status,
  children,
}: {
  status: "green" | "red" | "yellow" | "white";
  children: React.ReactNode;
}) {
  const tone =
    status === "green"
      ? "border-[var(--pixel-green)] bg-[rgba(0,255,138,0.1)] text-[var(--pixel-green)]"
      : status === "red"
        ? "border-[var(--pixel-red)] bg-[rgba(255,52,93,0.1)] text-[var(--pixel-red)]"
        : status === "yellow"
          ? "border-[var(--pixel-yellow)] bg-[rgba(255,232,79,0.1)] text-[var(--pixel-yellow)]"
          : "border-white/20 bg-white/5 text-white";

  return (
    <span className={`inline-flex shrink-0 items-center whitespace-nowrap border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${tone}`}>
      {children}
    </span>
  );
}

function PairStatusButton({
  symbol,
  selected,
  now,
  onSelect,
}: {
  symbol: string;
  selected: boolean;
  now: number;
  onSelect: (symbol: string) => void;
}) {
  const assetId = useMemo(() => assetIdOf(symbol), [symbol]);
  const assetRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "assets",
    args: [assetId],
    query: { refetchInterval: 15_000 },
  });

  const asset = assetRead.data as AssetTuple | undefined;
  const ready = !!asset?.[8] && !!asset?.[7];

  const canBetRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "canBetNow",
    args: [symbol],
    query: {
      enabled: ready,
      refetchInterval: 3_000,
      retry: false,
    },
  });

  const latestPriceRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getLatestPrice",
    args: [symbol],
    query: {
      enabled: ready,
      refetchInterval: 3_000,
      retry: false,
    },
  });

  const canBet = canBetRead.data as CanBetTuple | undefined;
  const latestPrice = latestPriceRead.data as LatestPriceTuple | undefined;
  const open = ready && !!canBet?.[0];

  const latestRoundRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "latestRoundOfAsset",
    args: [assetId],
    query: {
      enabled: ready,
      refetchInterval: 10_000,
    },
  });

  const latestRoundId = (latestRoundRead.data as bigint | undefined) ?? 0n;
  const hasRound = latestRoundId > 0n;

  const roundTimesRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getRoundTimes",
    args: hasRound ? [latestRoundId] : undefined,
    query: {
      enabled: hasRound,
      refetchInterval: 10_000,
    },
  });

  const roundCoreRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getRoundCore",
    args: hasRound ? [latestRoundId] : undefined,
    query: {
      enabled: hasRound,
      refetchInterval: 10_000,
    },
  });

  const roundTimes = roundTimesRead.data as RoundTimesTuple | undefined;
  const roundCore = roundCoreRead.data as RoundCoreTuple | undefined;
  const roundFinalized = !!roundCore?.[8] || !!roundCore?.[9];
  const activeRound = hasRound && !roundFinalized;
  const roundCloseTime = activeRound ? roundTimes?.[2] ?? canBet?.[5] : undefined;
  const roundClosed = !!roundCloseTime && now > 0 && Math.floor(now / 1000) >= Number(roundCloseTime);
  const nextWindowCountdown =
    ready &&
    !open &&
    !!canBet?.[5] &&
    now > 0 &&
    Math.floor(now / 1000) < Number(canBet[5])
      ? timeLeft(canBet[5], now)
      : "";

  const previewRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "previewSettlementOracleRound",
    args: hasRound ? [latestRoundId, 720n] : undefined,
    query: {
      enabled: hasRound && !roundFinalized && roundClosed,
      refetchInterval: 15_000,
      retry: false,
    },
  });

  const settleReady = !!previewRead.data;
  const entryDeadline = activeRound ? roundTimes?.[1] ?? canBet?.[4] : undefined;
  const cardLivePrice = latestPrice?.[1] ?? (!activeRound ? canBet?.[2] : undefined);
  const countdownLabel = !ready
    ? "Not ready"
    : open
      ? activeRound
        ? `Entry ${timeLeft(entryDeadline, now)}`
        : "Entry starts on first prediction"
      : activeRound && !roundClosed
        ? `Settle in ${timeLeft(roundCloseTime, now)}`
      : activeRound
          ? settleReady
            ? "Settle now"
            : "Waiting oracle"
          : nextWindowCountdown
            ? `Next entry ~ ${nextWindowCountdown}`
            : "Closed";

  return (
    <button
      type="button"
      onClick={() => onSelect(symbol)}
      aria-pressed={selected}
      className={`group min-h-[96px] min-w-0 border p-2.5 text-left transition duration-200 active:translate-y-px sm:p-3 ${
        selected
          ? "border-white bg-white text-black"
          : open
            ? "border-[var(--pixel-green)] bg-[rgba(0,255,138,0.08)] text-white hover:bg-[rgba(0,255,138,0.14)]"
            : "border-[var(--pixel-red)] bg-[rgba(255,52,93,0.06)] text-white hover:bg-[rgba(255,52,93,0.12)]"
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-bold">{symbol}</span>
        <span
          className={`h-2 w-2 shrink-0 ${open ? "bg-[var(--pixel-green)]" : "bg-[var(--pixel-red)]"}`}
          aria-hidden
        />
      </div>
      <div className={`mt-3 min-h-[2.5em] break-words text-[10px] leading-relaxed uppercase tracking-[0.12em] ${selected ? "text-black/70" : "text-white/60"}`}>
        {countdownLabel}
      </div>
      <div className={`mt-1 min-w-0 break-words text-xs tabular-nums ${selected ? "text-black" : open ? "text-[var(--pixel-green)]" : "text-[var(--pixel-red)]"}`}>
        Live ${formatPrice(cardLivePrice, 6)}
      </div>
    </button>
  );
}

export default function PredictionPage() {
  const isDocumentVisible = useDocumentVisibility();
  const toast = useToast();
  const publicClient = usePublicClient();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [selectedSymbol, setSelectedSymbol] = useState<string>(PREDICTION_ASSETS[0]);
  const [side, setSide] = useState<0 | 1>(0);
  const [amount, setAmount] = useState(DEFAULT_AMOUNT);
  const [busy, setBusy] = useState("");
  const [mounted, setMounted] = useState(false);
  const [now, setNow] = useState(0);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyNonce, setHistoryNonce] = useState(0);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isDocumentVisible) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isDocumentVisible]);

  const walletAddress = mounted ? address : undefined;
  const walletConnected = mounted && isConnected;

  const assetId = useMemo(() => assetIdOf(selectedSymbol), [selectedSymbol]);
  const amountWei = useMemo(() => {
    try {
      return amount.trim() ? parseUnits(amount, NUSD_DECIMALS) : 0n;
    } catch {
      return 0n;
    }
  }, [amount]);
  const amountInvalid = amount.trim() !== "" && amountWei <= 0n;

  const assetRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "assets",
    args: [assetId],
    query: { refetchInterval: 15_000 },
  });
  const canBetRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "canBetNow",
    args: [selectedSymbol],
    query: { refetchInterval: 2_000, retry: false },
  });
  const latestPriceRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getLatestPrice",
    args: [selectedSymbol],
    query: { refetchInterval: 2_000, retry: false },
  });
  const latestRoundRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "latestRoundOfAsset",
    args: [assetId],
    query: { refetchInterval: 2_000 },
  });
  const balanceRead = useReadContract({
    address: NUSD_ADDRESS,
    abi: NUSD_ABI,
    functionName: "balanceOf",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress, refetchInterval: 8_000 },
  });
  const allowanceRead = useReadContract({
    address: NUSD_ADDRESS,
    abi: NUSD_ABI,
    functionName: "allowance",
    args: walletAddress ? [walletAddress, PREDICTION_ADDRESS] : undefined,
    query: { enabled: !!walletAddress, refetchInterval: 8_000 },
  });
  const faucetClaimAmountRead = useReadContract({
    address: NUSD_FAUCET_ADDRESS,
    abi: NUSD_FAUCET_ABI,
    functionName: "claimAmount",
    query: { refetchInterval: 30_000 },
  });
  const faucetBalanceRead = useReadContract({
    address: NUSD_FAUCET_ADDRESS,
    abi: NUSD_FAUCET_ABI,
    functionName: "faucetBalance",
    query: { refetchInterval: 10_000 },
  });
  const faucetPausedRead = useReadContract({
    address: NUSD_FAUCET_ADDRESS,
    abi: NUSD_FAUCET_ABI,
    functionName: "paused",
    query: { refetchInterval: 10_000 },
  });
  const faucetCanClaimRead = useReadContract({
    address: NUSD_FAUCET_ADDRESS,
    abi: NUSD_FAUCET_ABI,
    functionName: "canClaim",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress, refetchInterval: 5_000 },
  });
  const faucetWaitRead = useReadContract({
    address: NUSD_FAUCET_ADDRESS,
    abi: NUSD_FAUCET_ABI,
    functionName: "timeUntilClaim",
    args: walletAddress ? [walletAddress] : undefined,
    query: { enabled: !!walletAddress, refetchInterval: 5_000 },
  });

  const latestRoundId = (latestRoundRead.data as bigint | undefined) ?? 0n;
  const hasRound = latestRoundId > 0n;

  const roundCoreRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getRoundCore",
    args: hasRound ? [latestRoundId] : undefined,
    query: { enabled: hasRound, refetchInterval: 2_000 },
  });
  const roundTimesRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getRoundTimes",
    args: hasRound ? [latestRoundId] : undefined,
    query: { enabled: hasRound, refetchInterval: 2_000 },
  });
  const roundPoolsRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getRoundPools",
    args: hasRound ? [latestRoundId] : undefined,
    query: { enabled: hasRound, refetchInterval: 2_000 },
  });
  const positionRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getPosition",
    args: hasRound && walletAddress ? [latestRoundId, walletAddress] : undefined,
    query: { enabled: hasRound && !!walletAddress, refetchInterval: 5_000 },
  });
  const previewRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "previewSettlementOracleRound",
    args: hasRound ? [latestRoundId, 720n] : undefined,
    query: { enabled: hasRound, refetchInterval: 15_000, retry: false },
  });

  const asset = assetRead.data as AssetTuple | undefined;
  const canBet = canBetRead.data as CanBetTuple | undefined;
  const latestPrice = latestPriceRead.data as LatestPriceTuple | undefined;
  const roundCore = roundCoreRead.data as RoundCoreTuple | undefined;
  const roundTimes = roundTimesRead.data as RoundTimesTuple | undefined;
  const roundPools = roundPoolsRead.data as RoundPoolsTuple | undefined;
  const position = positionRead.data as PositionTuple | undefined;
  const preview = previewRead.data as PreviewTuple | undefined;

  const balance = (balanceRead.data as bigint | undefined) ?? 0n;
  const allowance = (allowanceRead.data as bigint | undefined) ?? 0n;
  const faucetClaimAmount = (faucetClaimAmountRead.data as bigint | undefined) ?? 100n * 10n ** 18n;
  const faucetBalance = (faucetBalanceRead.data as bigint | undefined) ?? 0n;
  const faucetPaused = (faucetPausedRead.data as boolean | undefined) ?? false;
  const faucetCanClaim = (faucetCanClaimRead.data as boolean | undefined) ?? false;
  const faucetWait = faucetWaitRead.data as bigint | undefined;
  const faucetEmpty = faucetBalance < faucetClaimAmount;
  const faucetDisabled = !!busy || faucetPaused || faucetEmpty || (walletConnected && !faucetCanClaim);
  const faucetStatus = !walletConnected
    ? "Connect wallet"
    : faucetPaused
      ? "Paused"
      : faucetEmpty
        ? "Faucet empty"
        : faucetCanClaim
          ? "Ready"
          : `Next ${durationLeft(faucetWait)}`;
  const upPool = roundPools?.[0] ?? 0n;
  const downPool = roundPools?.[1] ?? 0n;
  const isAssetReady = !!asset?.[8] && !!asset?.[7];
  const betOpen = !!canBet?.[0] && isAssetReady;
  const needsApproval = amountWei > 0n && allowance < amountWei;
  const outcomeIndex = roundCore ? Number(roundCore[7]) : -1;
  const outcome = outcomeLabel(outcomeIndex);
  const isSettled = !!roundCore?.[8] || !!roundCore?.[9];
  const activeRound = hasRound && !isSettled;
  const betDeadline = activeRound ? roundTimes?.[1] ?? canBet?.[4] : undefined;
  const closeTime = activeRound ? roundTimes?.[2] ?? canBet?.[5] : undefined;
  const staleCancelTime = activeRound ? roundTimes?.[3] : undefined;
  const roundClosed = !!closeTime && Math.floor(now / 1000) >= Number(closeTime);
  const canCancelStale = !!staleCancelTime && Math.floor(now / 1000) > Number(staleCancelTime);
  const settleOracleReady = activeRound && roundClosed && !!preview;
  const selectedNextEntry =
    isAssetReady &&
    !betOpen &&
    !!canBet?.[5] &&
    now > 0 &&
    Math.floor(now / 1000) < Number(canBet[5])
      ? timeLeft(canBet[5], now)
      : "";
  const entryWindowLabel = betOpen
    ? activeRound
      ? timeLeft(betDeadline, now)
      : "Entry starts on first prediction"
    : selectedNextEntry
      ? `Next ~ ${selectedNextEntry}`
      : "Waiting oracle";
  const entryPrice = activeRound || isSettled ? roundCore?.[5] : undefined;
  const entryPriceTime = activeRound || isSettled ? roundTimes?.[0] : undefined;
  const livePrice = latestPrice?.[1] ?? (!activeRound ? canBet?.[2] : undefined);
  const livePriceTime = latestPrice?.[2] ?? (!activeRound ? canBet?.[3] : undefined);
  const settleCountdown = !hasRound
    ? "--"
    : isSettled
      ? "Finalized"
      : !roundClosed
        ? timeLeft(closeTime, now)
        : settleOracleReady
          ? "Ready"
          : "Waiting oracle";
  const positionUp = position?.[0] ?? 0n;
  const positionDown = position?.[1] ?? 0n;
  const displayUpPool = activeRound ? upPool : 0n;
  const displayDownPool = activeRound ? downPool : 0n;
  const displayTotalPool = displayUpPool + displayDownPool;
  const displayUpShare = percentOf(displayUpPool, displayTotalPool);
  const displayDownShare = percentOf(displayDownPool, displayTotalPool);
  const displayPositionUp = activeRound ? positionUp : 0n;
  const displayPositionDown = activeRound ? positionDown : 0n;
  const roundPoolLabel = activeRound
    ? `${selectedSymbol} #${latestRoundId.toString()}`
    : hasRound && isSettled
      ? `${selectedSymbol} next`
      : selectedSymbol;
  const actionDisabled =
    !!busy ||
    amountInvalid ||
    amountWei <= 0n ||
    !isAssetReady ||
    !betOpen ||
    balance < amountWei;

  useEffect(() => {
    if (!walletAddress) {
      setHistory([]);
      setHistoryError("");
      setHistoryLoading(false);
      return;
    }
    if (!isDocumentVisible) return;

    const controller = new AbortController();
    let loading = false;
    const userAddress = walletAddress;

    async function loadHistory(force = false) {
      if (controller.signal.aborted || loading) return;
      loading = true;
      try {
        setHistoryLoading(true);
        setHistoryError("");

        const params = new URLSearchParams({ address: userAddress });
        if (force) params.set("force", "1");

        const response = await fetch(`/api/prediction/history?${params.toString()}`, {
          cache: force ? "no-store" : "default",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as HistoryApiResponse | null;
        if (!response.ok) {
          throw new Error(payload?.error || `History request failed (${response.status})`);
        }
        if (!payload || !Array.isArray(payload.history)) {
          throw new Error("History response is invalid");
        }

        const rows = payload.history.map((item): HistoryItem => {
          const roundId = BigInt(item.roundId);
          const upAmount = BigInt(item.upAmount);
          const downAmount = BigInt(item.downAmount);
          const claimable = BigInt(item.claimable);
          const itemOutcome = Number(item.outcome);

          return {
            roundId,
            symbol: item.symbol,
            upAmount,
            downAmount,
            claimed: item.claimed,
            claimable,
            outcome: outcomeLabel(itemOutcome),
            result: historyResult(itemOutcome, upAmount, downAmount),
            txHash: item.txHash,
          };
        });

        if (!controller.signal.aborted) setHistory(rows);
      } catch (error) {
        if (!controller.signal.aborted) {
          setHistoryError(
            error instanceof Error ? error.message : "Could not load history"
          );
        }
      } finally {
        loading = false;
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    }

    void loadHistory(historyNonce > 0);
    const id = window.setInterval(() => void loadHistory(), 60_000);
    return () => {
      controller.abort();
      window.clearInterval(id);
    };
  }, [historyNonce, isDocumentVisible, walletAddress]);

  const refetchAll = async () => {
    await Promise.allSettled([
      assetRead.refetch(),
      canBetRead.refetch(),
      latestRoundRead.refetch(),
      roundCoreRead.refetch(),
      roundTimesRead.refetch(),
      roundPoolsRead.refetch(),
      positionRead.refetch(),
      previewRead.refetch(),
      balanceRead.refetch(),
      allowanceRead.refetch(),
      faucetClaimAmountRead.refetch(),
      faucetBalanceRead.refetch(),
      faucetPausedRead.refetch(),
      faucetCanClaimRead.refetch(),
      faucetWaitRead.refetch(),
    ]);
    setHistoryNonce((value) => value + 1);
  };

  async function ensureWallet() {
    let activeChainId = chainId;
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector found");
      const connection = await connectAsync({ connector });
      activeChainId = connection.chainId;
    }
    if (activeChainId !== litvm.id) {
      await switchChainAsync({ chainId: litvm.id });
    }
  }

  async function runTx(label: string, fn: () => Promise<`0x${string}`>) {
    if (!publicClient) throw new Error("RPC client is not ready");
    try {
      setBusy(label);
      await ensureWallet();
      const hash = await fn();
      toast.info(`${label} sent`, shortAddress(hash));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${label} transaction reverted`);
      toast.success(`${label} confirmed`);
      await refetchAll();
    } catch (error) {
      toast.handleError(error, `${label} failed`);
    } finally {
      setBusy("");
    }
  }

  return (
    <div
      className="prediction-page pixel-shell pixel-app-shell min-h-screen bg-black text-white"
      style={{ fontFamily: "var(--font-departure), var(--font-pixel), monospace" }}
    >
      <div className="pixel-grid-bg" />
      <div className="pixel-noise" />

      <header className="pixel-app-header sticky top-0 z-30 border-b border-white/10 bg-black/95 px-3 py-3 backdrop-blur sm:px-6 sm:py-4">
        <div className="mx-auto flex max-w-7xl min-w-0 items-center justify-between gap-2 sm:gap-3">
          <Link href="/" className="prediction-touch flex min-w-0 shrink items-center gap-2 sm:gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center border border-white/25 bg-black text-sm text-white">N</span>
            <span className="whitespace-nowrap text-xs font-bold tracking-wide text-white sm:text-sm">0xPrediction</span>
          </Link>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link href="/0xdex" className="prediction-touch pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm whitespace-nowrap">
              0xDex
            </Link>
            {!mounted ? (
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm whitespace-nowrap"
                disabled
              >
                Connect
              </button>
            ) : walletConnected ? (
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-sm whitespace-nowrap"
                onClick={() => disconnect()}
                title="Disconnect wallet"
              >
                {shortAddress(walletAddress)}
              </button>
            ) : (
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm whitespace-nowrap"
                disabled={isConnecting}
                onClick={() => void ensureWallet().catch((error) => toast.handleError(error, "Connect failed"))}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-3 py-4 sm:px-6 sm:py-8 lg:py-10">
        <section className="mb-4 grid gap-3 sm:mb-6 sm:gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="pixel-panel min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3 sm:gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/55">
                  Oracle market
                </p>
                <h1 className="mt-2 text-2xl font-bold leading-none text-white sm:text-4xl">
                  Choose a pair
                </h1>
              </div>
              <StatusBadge status={betOpen ? "green" : "red"}>
                {betOpen ? "Prediction open" : "Prediction closed"}
              </StatusBadge>
            </div>

            <div
              className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:gap-3 xl:grid-cols-3"
              role="group"
              aria-label="Prediction pairs"
            >
              {PREDICTION_ASSETS.map((symbol) => (
                <PairStatusButton
                  key={symbol}
                  symbol={symbol}
                  now={now}
                  selected={selectedSymbol === symbol}
                  onSelect={setSelectedSymbol}
                />
              ))}
            </div>
          </div>

          <div className="pixel-panel min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/55">
                  Selected pair
                </p>
                <h2 className="mt-2 text-2xl font-bold leading-none text-white sm:text-3xl">
                  {selectedSymbol}
                </h2>
              </div>
              <div className="grid w-full min-w-0 gap-2 text-left min-[360px]:grid-cols-2 sm:w-auto sm:min-w-[360px] sm:text-right">
                <div className="min-w-0 border border-white/10 bg-black px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                    Entry price
                  </p>
                  <p className="mt-2 min-w-0 break-words text-base tabular-nums text-[var(--pixel-yellow)] min-[360px]:text-lg sm:text-xl">
                    {entryPrice ? `$${formatPrice(entryPrice, 6)}` : "--"}
                  </p>
                  <p className="mt-1 text-[10px] text-white/40">
                    {entryPriceTime ? `Round ${formatClock(entryPriceTime)}` : "Starts on first prediction"}
                  </p>
                </div>
                <div className="min-w-0 border border-white/10 bg-black px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                    Live price
                  </p>
                  <p className="mt-2 min-w-0 break-words text-base tabular-nums text-[var(--pixel-green)] min-[360px]:text-lg sm:text-xl">
                    {livePrice ? `$${formatPrice(livePrice, 6)}` : "--"}
                  </p>
                  <p className="mt-1 text-[10px] text-white/40">
                    {livePriceTime ? `Oracle ${formatClock(livePriceTime)}` : "--"}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:mt-5 sm:gap-3">
              <div className="min-h-[84px] min-w-0 border border-white/10 bg-black p-3">
                <p className="text-white/50">Entry window</p>
                <p className={betOpen ? "mt-2 break-words text-[var(--pixel-green)]" : "mt-2 break-words text-[var(--pixel-yellow)]"}>
                  {entryWindowLabel}
                </p>
              </div>
              <div className="min-h-[84px] min-w-0 border border-white/10 bg-black p-3">
                <p className="text-white/50">Settle in</p>
                <p
                  className={`mt-2 ${
                    settleCountdown === "Ready"
                      ? "text-[var(--pixel-green)]"
                      : settleCountdown === "Waiting oracle"
                        ? "text-[var(--pixel-yellow)]"
                        : "text-white"
                  }`}
                >
                  {settleCountdown}
                </p>
                <p className="mt-1 text-[10px] text-white/45">
                  {settleCountdown === "Waiting oracle" && staleCancelTime
                    ? canCancelStale
                      ? "Refund ready"
                      : `Refund in ${timeLeft(staleCancelTime, now)}`
                    : formatClock(closeTime)}
                </p>
              </div>
              <div className="min-h-[84px] min-w-0 border border-white/10 bg-black p-3">
                <p className="text-white/50">Round</p>
                <p className="mt-2 break-words text-white tabular-nums">#{latestRoundId.toString()}</p>
              </div>
              <div className="min-h-[84px] min-w-0 border border-white/10 bg-black p-3">
                <p className="text-white/50">Outcome</p>
                <p
                  className={`mt-2 ${
                    outcome === "UP"
                      ? "text-[var(--pixel-green)]"
                      : outcome === "DOWN"
                        ? "text-[var(--pixel-red)]"
                        : "text-[var(--pixel-yellow)]"
                  }`}
                >
                  {outcome}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid items-start gap-3 sm:gap-4 lg:grid-cols-2 xl:grid-cols-[0.9fr_0.8fr_1fr]">
          <div className="pixel-panel min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-white sm:text-2xl">Predict</h2>
              <StatusBadge status={side === 0 ? "green" : "red"}>
                {side === 0 ? "UP" : "DOWN"}
              </StatusBadge>
            </div>

            <div
              className="mt-5 grid grid-cols-2 gap-2"
              role="group"
              aria-label="Prediction direction"
            >
              <button
                type="button"
                className={`prediction-touch pixel-btn-soft ${side === 0 ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"}`}
                onClick={() => setSide(0)}
                aria-pressed={side === 0}
              >
                UP
              </button>
              <button
                type="button"
                className={`prediction-touch pixel-btn-soft ${side === 1 ? "pixel-btn-soft-rose" : "pixel-btn-soft-secondary"}`}
                onClick={() => setSide(1)}
                aria-pressed={side === 1}
              >
                DOWN
              </button>
            </div>

            <label htmlFor="prediction-amount" className="mt-5 block text-[10px] uppercase tracking-[0.18em] text-white/60">
              Amount
            </label>
            <div className="mt-2 min-w-0 border border-white/15 bg-black p-3 focus-within:border-white/40">
              <input
                id="prediction-amount"
                name="prediction-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                aria-invalid={amountInvalid}
                placeholder="100"
                className="prediction-amount-input w-full min-w-0 bg-transparent text-3xl tabular-nums text-white outline-none placeholder:text-white/25"
              />
              <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-white/60">
                <span>NUSD</span>
                <span className="min-w-0 break-words text-right tabular-nums">Balance: {formatNusd(balance)}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {["50", "100", "250", "500"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="prediction-touch pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm min-w-0"
                  onClick={() => setAmount(value)}
                  aria-label={`Set amount to ${value} NUSD`}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="mt-5 min-w-0 border border-white/10 bg-black p-3">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                    NUSD faucet
                  </p>
                  <p className="mt-1 break-words text-base text-white sm:text-lg">
                    {formatNusd(faucetClaimAmount)} NUSD / day
                  </p>
                </div>
                <StatusBadge
                  status={
                    faucetCanClaim && walletConnected && !faucetPaused && !faucetEmpty
                      ? "green"
                      : faucetPaused || faucetEmpty
                        ? "red"
                        : "yellow"
                  }
                >
                  {faucetStatus}
                </StatusBadge>
              </div>
              {!walletConnected ? (
                <button
                  type="button"
                  className="prediction-touch pixel-btn-soft pixel-btn-soft-indigo mt-3 w-full"
                  disabled={!!busy || isConnecting}
                  onClick={() => void ensureWallet()}
                >
                  Connect wallet
                </button>
              ) : (
                <button
                  type="button"
                  className="prediction-touch pixel-btn-soft pixel-btn-soft-emerald mt-3 w-full"
                  disabled={faucetDisabled}
                  onClick={() =>
                    void runTx("Claim faucet", () =>
                      writeContractAsync({
                        address: NUSD_FAUCET_ADDRESS,
                        abi: NUSD_FAUCET_ABI,
                        functionName: "claim",
                      })
                    )
                  }
                >
                  {busy === "Claim faucet" ? "Claiming..." : `Claim ${formatNusd(faucetClaimAmount)} NUSD`}
                </button>
              )}
            </div>

            {!walletConnected ? (
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-indigo mt-5 w-full"
                disabled={!!busy || isConnecting}
                onClick={() => void ensureWallet()}
              >
                Connect wallet
              </button>
            ) : needsApproval ? (
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-amber mt-5 w-full"
                disabled={!!busy}
                onClick={() =>
                  void runTx("Approve NUSD", () =>
                    writeContractAsync({
                      address: NUSD_ADDRESS,
                      abi: NUSD_ABI,
                      functionName: "approve",
                      args: [PREDICTION_ADDRESS, maxUint256],
                    })
                  )
                }
              >
                {busy === "Approve NUSD" ? "Approving..." : "Approve NUSD"}
              </button>
            ) : (
              <button
                type="button"
                className={`prediction-touch pixel-btn-soft mt-5 w-full ${side === 0 ? "pixel-btn-soft-emerald" : "pixel-btn-soft-rose"}`}
                disabled={actionDisabled}
                onClick={() =>
                  void runTx(`Predict ${side === 0 ? "UP" : "DOWN"}`, () =>
                    writeContractAsync({
                      address: PREDICTION_ADDRESS,
                      abi: PREDICTION_ABI,
                      functionName: "predict",
                      args: [selectedSymbol, side, amountWei],
                    })
                  )
                }
              >
                {busy.startsWith("Predict")
                  ? "Predicting..."
                  : `Predict ${side === 0 ? "UP" : "DOWN"}`}
              </button>
            )}

            {!betOpen ? (
              <p className="mt-4 border border-[var(--pixel-red)]/40 bg-[rgba(255,52,93,0.08)] p-3 text-xs leading-relaxed text-[var(--pixel-red)]">
                This pair is not accepting predictions right now.
              </p>
            ) : null}
          </div>

          <div className="pixel-panel min-w-0 p-4 sm:p-5 lg:p-6">
            <div className="flex min-w-0 flex-wrap items-end justify-between gap-2">
              <h2 className="text-xl font-bold text-white sm:text-2xl">Round pool</h2>
              <p className="min-w-0 break-words text-right text-xs text-white/55">
                {roundPoolLabel}
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <div className="flex min-w-0 justify-between gap-3 text-xs">
                  <span className="min-w-0 break-words text-[var(--pixel-green)]">UP · {formatNusd(displayUpPool)} NUSD</span>
                  <span className="shrink-0 tabular-nums">{displayUpShare.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 border border-white/10 bg-black">
                  <div
                    className="h-full bg-[var(--pixel-green)]"
                    style={{ width: `${Math.min(100, displayUpShare)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex min-w-0 justify-between gap-3 text-xs">
                  <span className="min-w-0 break-words text-[var(--pixel-red)]">DOWN · {formatNusd(displayDownPool)} NUSD</span>
                  <span className="shrink-0 tabular-nums">{displayDownShare.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 border border-white/10 bg-black">
                  <div
                    className="h-full bg-[var(--pixel-red)]"
                    style={{ width: `${Math.min(100, displayDownShare)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-xs">
              <div className="flex min-w-0 justify-between gap-3 border-b border-white/10 pb-2">
                <span className="text-white/55">Your UP</span>
                <span className="min-w-0 break-words text-right tabular-nums text-[var(--pixel-green)]">{formatNusd(displayPositionUp)} NUSD</span>
              </div>
              <div className="flex min-w-0 justify-between gap-3 border-b border-white/10 pb-2">
                <span className="text-white/55">Your DOWN</span>
                <span className="min-w-0 break-words text-right tabular-nums text-[var(--pixel-red)]">{formatNusd(displayPositionDown)} NUSD</span>
              </div>
              <div className="flex min-w-0 justify-between gap-3">
                <span className="text-white/55">Settle price</span>
                <span className={`${settleOracleReady ? "text-white" : "text-[var(--pixel-yellow)]"} min-w-0 break-words text-right tabular-nums`}>
                  {!activeRound
                    ? "Next round"
                    : settleOracleReady
                      ? `$${formatPrice(preview?.[1], 6)}`
                      : "Waiting oracle"}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              {!isSettled && roundClosed ? (
                <button
                  type="button"
                  className="prediction-touch pixel-btn-soft pixel-btn-soft-secondary w-full"
                  disabled={!!busy || !latestRoundId || !settleOracleReady}
                  onClick={() =>
                    void runTx("Settle round", () =>
                      writeContractAsync({
                        address: PREDICTION_ADDRESS,
                        abi: PREDICTION_ABI,
                        functionName: "settleLatestRoundWithLookback",
                        args: [latestRoundId, 720n],
                      })
                    )
                  }
                >
                  {busy === "Settle round"
                    ? "Settling..."
                    : settleOracleReady
                      ? "Settle round"
                      : "Waiting oracle"}
                </button>
              ) : null}

              {!isSettled && canCancelStale ? (
                <button
                  type="button"
                  className="prediction-touch pixel-btn-soft pixel-btn-soft-rose w-full"
                  disabled={!!busy || !latestRoundId}
                  onClick={() =>
                    void runTx("Refund round", () =>
                      writeContractAsync({
                        address: PREDICTION_ADDRESS,
                        abi: PREDICTION_ABI,
                        functionName: "cancelStaleRound",
                        args: [latestRoundId],
                      })
                    )
                  }
                >
                  {busy === "Refund round" ? "Refunding..." : "Refund round"}
                </button>
              ) : null}
            </div>
          </div>

          <div className="pixel-panel min-w-0 p-4 sm:p-5 lg:col-span-2 lg:p-6 xl:col-span-1">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-white sm:text-2xl">Your history</h2>
              <button
                type="button"
                className="prediction-touch pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm whitespace-nowrap"
                disabled={!walletAddress || historyLoading}
                onClick={() => setHistoryNonce((value) => value + 1)}
              >
                {historyLoading ? "Loading" : "Refresh"}
              </button>
            </div>

            {!walletAddress ? (
              <div className="mt-5 border border-white/10 bg-black p-4 text-sm leading-relaxed text-white/65 sm:p-5">
                Connect wallet to see wins and losses.
              </div>
            ) : historyLoading && history.length === 0 ? (
              <div className="mt-5 border border-white/10 bg-black p-4 text-sm leading-relaxed text-white/65 sm:p-5">
                Loading prediction history...
              </div>
            ) : historyError && history.length === 0 ? (
              <div className="mt-5 border border-[var(--pixel-red)]/40 bg-[rgba(255,52,93,0.08)] p-4 text-xs leading-relaxed text-[var(--pixel-red)]">
                History failed to load. Try again in a few seconds.
              </div>
            ) : history.length === 0 ? (
              <div className="mt-5 border border-white/10 bg-black p-4 text-sm leading-relaxed text-white/65 sm:p-5">
                No predictions from this wallet yet.
              </div>
            ) : (
              <div className="prediction-history-scroll mt-5 max-h-none space-y-3 overflow-visible pr-0 xl:max-h-[520px] xl:overflow-y-auto xl:pr-1">
                {history.map((item) => {
                  const resultTone =
                    item.result === "Win"
                      ? "green"
                      : item.result === "Loss"
                        ? "red"
                        : item.result === "Pending"
                          ? "yellow"
                          : "white";
                  const claimHistoryLabel = `Claim #${item.roundId.toString()}`;
                  const canClaimHistory = item.claimable > 0n && !item.claimed;

                  return (
                    <article
                      key={item.roundId.toString()}
                      className="prediction-history-item min-w-0 border border-white/10 bg-black p-3 sm:p-4"
                    >
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-bold text-white">
                            #{item.roundId.toString()} · {item.symbol}
                          </p>
                          <p className="mt-1 break-words text-[11px] tabular-nums text-white/55">
                            UP {formatNusd(item.upAmount)} · DOWN {formatNusd(item.downAmount)}
                          </p>
                        </div>
                        <StatusBadge status={resultTone}>{item.result}</StatusBadge>
                      </div>
                      <div className="mt-3 flex min-w-0 flex-wrap items-start justify-between gap-2 text-[11px] text-white/60">
                        <span>Outcome: {item.outcome}</span>
                        <span className="min-w-0 break-words text-right tabular-nums text-[var(--pixel-yellow)]">
                          {item.claimed
                            ? "Claimed"
                            : item.claimable > 0n
                              ? `${formatNusd(item.claimable)} NUSD due`
                              : "No claim"}
                        </span>
                      </div>
                      {canClaimHistory ? (
                        <button
                          type="button"
                          className="prediction-touch pixel-btn-soft pixel-btn-soft-amber mt-3 w-full"
                          disabled={!!busy}
                          onClick={() =>
                            void runTx(claimHistoryLabel, () =>
                              writeContractAsync({
                                address: PREDICTION_ADDRESS,
                                abi: PREDICTION_ABI,
                                functionName: "claim",
                                args: [item.roundId],
                              })
                            )
                          }
                        >
                          {busy === claimHistoryLabel
                            ? "Claiming..."
                            : `Claim ${formatNusd(item.claimable)} NUSD`}
                        </button>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
