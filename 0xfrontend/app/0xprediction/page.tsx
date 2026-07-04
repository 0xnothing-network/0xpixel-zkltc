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
  parseAbiItem,
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
import { useToast } from "@/components/Toast";

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

const BET_PLACED_EVENT = parseAbiItem(
  "event BetPlaced(uint256 indexed roundId, address indexed user, uint8 indexed side, uint256 amount, uint256 upPool, uint256 downPool)"
);

const DEFAULT_AMOUNT = "100";
const PRICE_DECIMALS = 18;
const NUSD_DECIMALS = 18;
const OUTCOME_LABELS = ["Pending", "UP", "DOWN", "DRAW", "Cancelled"] as const;

function assetIdOf(symbol: string): `0x${string}` {
  return keccak256(toBytes(symbol));
}

function startBlock() {
  const raw =
    process.env.NEXT_PUBLIC_PREDICTION_START_BLOCK ||
    process.env.NEXT_PUBLIC_DEX_START_BLOCK ||
    "0";
  try {
    return BigInt(raw);
  } catch {
    return 0n;
  }
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
    <span className={`inline-flex items-center border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${tone}`}>
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

  const canBet = canBetRead.data as CanBetTuple | undefined;
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
          : activeRound && nextWindowCountdown
            ? `Next entry ~ ${nextWindowCountdown}`
            : "Closed";

  return (
    <button
      type="button"
      onClick={() => onSelect(symbol)}
      className={`group border p-3 text-left transition duration-200 active:translate-y-px ${
        selected
          ? "border-white bg-white text-black"
          : open
            ? "border-[var(--pixel-green)] bg-[rgba(0,255,138,0.08)] text-white hover:bg-[rgba(0,255,138,0.14)]"
            : "border-[var(--pixel-red)] bg-[rgba(255,52,93,0.06)] text-white hover:bg-[rgba(255,52,93,0.12)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-bold">{symbol}</span>
        <span
          className={`h-2 w-2 ${open ? "bg-[var(--pixel-green)]" : "bg-[var(--pixel-red)]"}`}
          aria-hidden
        />
      </div>
      <div className={`mt-3 text-[10px] uppercase tracking-[0.16em] ${selected ? "text-black/70" : "text-white/60"}`}>
        {countdownLabel}
      </div>
      <div className={`mt-1 text-xs ${selected ? "text-black" : open ? "text-[var(--pixel-green)]" : "text-[var(--pixel-red)]"}`}>
        ${formatPrice(canBet?.[2], 6)}
      </div>
    </button>
  );
}

export default function PredictionPage() {
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
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

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
  const claimableRead = useReadContract({
    address: PREDICTION_ADDRESS,
    abi: PREDICTION_ABI,
    functionName: "getClaimable",
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
  const roundCore = roundCoreRead.data as RoundCoreTuple | undefined;
  const roundTimes = roundTimesRead.data as RoundTimesTuple | undefined;
  const roundPools = roundPoolsRead.data as RoundPoolsTuple | undefined;
  const position = positionRead.data as PositionTuple | undefined;
  const preview = previewRead.data as PreviewTuple | undefined;

  const balance = (balanceRead.data as bigint | undefined) ?? 0n;
  const allowance = (allowanceRead.data as bigint | undefined) ?? 0n;
  const claimable = (claimableRead.data as bigint | undefined) ?? 0n;
  const upPool = roundPools?.[0] ?? 0n;
  const downPool = roundPools?.[1] ?? 0n;
  const totalPool = upPool + downPool;
  const upShare = percentOf(upPool, totalPool);
  const downShare = percentOf(downPool, totalPool);
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
  const selectedPriceLabel = activeRound ? "Start price" : "Live oracle";
  const selectedPriceTime = canBet?.[3];
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
  const actionDisabled =
    !!busy ||
    amountInvalid ||
    amountWei <= 0n ||
    !isAssetReady ||
    !betOpen ||
    balance < amountWei;

  useEffect(() => {
    if (!publicClient || !walletAddress) {
      setHistory([]);
      setHistoryError("");
      return;
    }

    let cancelled = false;
    const userAddress = walletAddress;

    async function loadHistory() {
      try {
        setHistoryLoading(true);
        setHistoryError("");

        const byRound = new Map<
          bigint,
          { roundId: bigint; txHash?: `0x${string}` }
        >();

        try {
          const logs = await publicClient.getLogs({
            address: PREDICTION_ADDRESS,
            event: BET_PLACED_EVENT,
            args: { user: userAddress },
            fromBlock: startBlock(),
            toBlock: "latest",
          });

          for (const log of logs) {
            const roundId = log.args.roundId;
            if (roundId === undefined) continue;
            byRound.set(roundId, {
              roundId,
              txHash: log.transactionHash,
            });
          }
        } catch {
          // Some RPC nodes are flaky with indexed event filters. Fall back to scanning recent rounds.
        }

        let recentRounds = Array.from(byRound.values())
          .sort((a, b) => Number(b.roundId - a.roundId))
          .slice(0, 16);

        if (recentRounds.length === 0) {
          const totalRounds = (await publicClient.readContract({
            address: PREDICTION_ADDRESS,
            abi: PREDICTION_ABI,
            functionName: "roundCount",
          })) as bigint;

          const minRound = totalRounds > 80n ? totalRounds - 79n : 1n;
          const fallbackRounds: { roundId: bigint; txHash?: `0x${string}` }[] = [];

          if (totalRounds > 0n) {
            for (let roundId = totalRounds; roundId >= minRound; roundId -= 1n) {
              fallbackRounds.push({ roundId });
              if (roundId === minRound) break;
            }
          }

          recentRounds = fallbackRounds;
        }

        const rows = (
          await Promise.all(
            recentRounds.map(async ({ roundId, txHash }) => {
            const [core, pos, due] = await Promise.all([
              publicClient.readContract({
                address: PREDICTION_ADDRESS,
                abi: PREDICTION_ABI,
                functionName: "getRoundCore",
                args: [roundId],
              }) as Promise<RoundCoreTuple>,
              publicClient.readContract({
                address: PREDICTION_ADDRESS,
                abi: PREDICTION_ABI,
                functionName: "getPosition",
                args: [roundId, userAddress],
              }) as Promise<PositionTuple>,
              publicClient.readContract({
                address: PREDICTION_ADDRESS,
                abi: PREDICTION_ABI,
                functionName: "getClaimable",
                args: [roundId, userAddress],
              }) as Promise<bigint>,
            ]);

            const itemOutcome = Number(core[7]);
            return {
              roundId,
              symbol: core[1],
              upAmount: pos[0],
              downAmount: pos[1],
              claimed: pos[2],
              claimable: due,
              outcome: outcomeLabel(itemOutcome),
              result: historyResult(itemOutcome, pos[0], pos[1]),
              txHash,
            } satisfies HistoryItem;
            })
          )
        ).filter((item) => item.upAmount > 0n || item.downAmount > 0n);

        if (!cancelled) setHistory(rows);
      } catch (error) {
        if (!cancelled) {
          setHistoryError(
            error instanceof Error ? error.message : "Could not load history"
          );
        }
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    }

    void loadHistory();
    const id = window.setInterval(loadHistory, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [historyNonce, publicClient, walletAddress]);

  const refetchAll = async () => {
    await Promise.allSettled([
      assetRead.refetch(),
      canBetRead.refetch(),
      latestRoundRead.refetch(),
      roundCoreRead.refetch(),
      roundTimesRead.refetch(),
      roundPoolsRead.refetch(),
      positionRead.refetch(),
      claimableRead.refetch(),
      previewRead.refetch(),
      balanceRead.refetch(),
      allowanceRead.refetch(),
    ]);
    setHistoryNonce((value) => value + 1);
  };

  async function ensureWallet() {
    if (!isConnected) {
      const connector = connectors[0];
      if (!connector) throw new Error("No wallet connector found");
      await connectAsync({ connector });
    }
    if (chainId && chainId !== litvm.id) {
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
      await publicClient.waitForTransactionReceipt({ hash });
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
      className="pixel-shell pixel-app-shell min-h-screen bg-black text-white"
      style={{ fontFamily: "var(--font-departure), var(--font-pixel), monospace" }}
    >
      <div className="pixel-grid-bg" />
      <div className="pixel-noise" />

      <header className="pixel-app-header sticky top-0 z-30 border-b border-white/10 bg-black/95 px-4 py-4 backdrop-blur sm:px-6">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center border border-white/25 bg-black text-sm text-white">N</span>
            <span className="text-sm font-bold tracking-wide text-white">0xPrediction</span>
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/0xdex" className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm">
              0xDex
            </Link>
            {!mounted ? (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                disabled
              >
                Connect
              </button>
            ) : walletConnected ? (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-sm"
                onClick={() => disconnect()}
              >
                {shortAddress(walletAddress)}
              </button>
            ) : (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                disabled={isConnecting}
                onClick={() => void ensureWallet()}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
        <section className="mb-6 grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="pixel-panel p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/55">
                  Oracle market
                </p>
                <h1 className="mt-2 text-3xl font-bold leading-none text-white sm:text-4xl">
                  Choose a pair
                </h1>
              </div>
              <StatusBadge status={betOpen ? "green" : "red"}>
                {betOpen ? "Prediction open" : "Prediction closed"}
              </StatusBadge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

          <div className="pixel-panel p-5 sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-white/55">
                  Selected pair
                </p>
                <h2 className="mt-2 text-3xl font-bold leading-none text-white">
                  {selectedSymbol}
                </h2>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-[0.18em] text-white/55">
                  {selectedPriceLabel}
                </p>
                <p className="mt-2 text-2xl text-[var(--pixel-yellow)]">
                  ${formatPrice(canBet?.[2], 6)}
                </p>
                <p className="mt-1 text-[10px] text-white/40">
                  {selectedPriceTime
                    ? `${activeRound ? "Round start" : "Oracle update"} ${formatClock(selectedPriceTime)}`
                    : "--"}
                </p>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div className="border border-white/10 bg-black p-3">
                <p className="text-white/50">Entry window</p>
                <p className={betOpen ? "mt-2 text-[var(--pixel-green)]" : "mt-2 text-[var(--pixel-yellow)]"}>
                  {entryWindowLabel}
                </p>
              </div>
              <div className="border border-white/10 bg-black p-3">
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
              <div className="border border-white/10 bg-black p-3">
                <p className="text-white/50">Round</p>
                <p className="mt-2 text-white">#{latestRoundId.toString()}</p>
              </div>
              <div className="border border-white/10 bg-black p-3">
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

        <section className="grid gap-4 lg:grid-cols-[0.9fr_0.8fr_1fr]">
          <div className="pixel-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-white">Predict</h2>
              <StatusBadge status={side === 0 ? "green" : "red"}>
                {side === 0 ? "UP" : "DOWN"}
              </StatusBadge>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                className={`pixel-btn-soft ${side === 0 ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"}`}
                onClick={() => setSide(0)}
              >
                UP
              </button>
              <button
                type="button"
                className={`pixel-btn-soft ${side === 1 ? "pixel-btn-soft-rose" : "pixel-btn-soft-secondary"}`}
                onClick={() => setSide(1)}
              >
                DOWN
              </button>
            </div>

            <label className="mt-5 block text-[10px] uppercase tracking-[0.18em] text-white/60">
              Amount
            </label>
            <div className="mt-2 border border-white/15 bg-black p-3">
              <input
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                inputMode="decimal"
                placeholder="100"
                className="w-full bg-transparent text-3xl text-white outline-none placeholder:text-white/25"
              />
              <div className="mt-2 flex items-center justify-between gap-2 text-xs text-white/60">
                <span>NUSD</span>
                <span>Balance: {formatNusd(balance)}</span>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {["50", "100", "250", "500"].map((value) => (
                <button
                  key={value}
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                  onClick={() => setAmount(value)}
                >
                  {value}
                </button>
              ))}
            </div>

            {!walletConnected ? (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-indigo mt-5 w-full"
                disabled={!!busy || isConnecting}
                onClick={() => void ensureWallet()}
              >
                Connect wallet
              </button>
            ) : needsApproval ? (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-amber mt-5 w-full"
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
                className={`pixel-btn-soft mt-5 w-full ${side === 0 ? "pixel-btn-soft-emerald" : "pixel-btn-soft-rose"}`}
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
              <p className="mt-4 border border-[var(--pixel-red)]/40 bg-[rgba(255,52,93,0.08)] p-3 text-xs text-[var(--pixel-red)]">
                This pair is not accepting predictions right now.
              </p>
            ) : null}
          </div>

          <div className="pixel-panel p-5 sm:p-6">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-2xl font-bold text-white">Round pool</h2>
              <p className="text-xs text-white/55">
                {selectedSymbol} {hasRound ? `#${latestRoundId.toString()}` : ""}
              </p>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--pixel-green)]">UP · {formatNusd(upPool)} NUSD</span>
                  <span>{upShare.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 border border-white/10 bg-black">
                  <div
                    className="h-full bg-[var(--pixel-green)]"
                    style={{ width: `${Math.min(100, upShare)}%` }}
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs">
                  <span className="text-[var(--pixel-red)]">DOWN · {formatNusd(downPool)} NUSD</span>
                  <span>{downShare.toFixed(1)}%</span>
                </div>
                <div className="mt-2 h-2 border border-white/10 bg-black">
                  <div
                    className="h-full bg-[var(--pixel-red)]"
                    style={{ width: `${Math.min(100, downShare)}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-3 text-xs">
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-white/55">Your UP</span>
                <span className="text-[var(--pixel-green)]">{formatNusd(positionUp)} NUSD</span>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-white/55">Your DOWN</span>
                <span className="text-[var(--pixel-red)]">{formatNusd(positionDown)} NUSD</span>
              </div>
              <div className="flex justify-between border-b border-white/10 pb-2">
                <span className="text-white/55">Claimable</span>
                <span className="text-[var(--pixel-yellow)]">{formatNusd(claimable)} NUSD</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/55">Settle price</span>
                <span className={settleOracleReady ? "text-white" : "text-[var(--pixel-yellow)]"}>
                  {settleOracleReady ? `$${formatPrice(preview?.[1], 6)}` : "Waiting oracle"}
                </span>
              </div>
            </div>

            <div className="mt-5 grid gap-2">
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-amber w-full"
                disabled={!claimable || claimable <= 0n || !!busy}
                onClick={() =>
                  void runTx("Claim", () =>
                    writeContractAsync({
                      address: PREDICTION_ADDRESS,
                      abi: PREDICTION_ABI,
                      functionName: "claim",
                      args: [latestRoundId],
                    })
                  )
                }
              >
                {busy === "Claim" ? "Claiming..." : "Claim"}
              </button>

              {!isSettled && roundClosed ? (
                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-secondary w-full"
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
                  className="pixel-btn-soft pixel-btn-soft-rose w-full"
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

          <div className="pixel-panel p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-bold text-white">Your history</h2>
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                disabled={!walletAddress || historyLoading}
                onClick={() => setHistoryNonce((value) => value + 1)}
              >
                {historyLoading ? "Loading" : "Refresh"}
              </button>
            </div>

            {!walletAddress ? (
              <div className="mt-5 border border-white/10 bg-black p-5 text-sm text-white/65">
                Connect wallet to see wins and losses.
              </div>
            ) : historyLoading && history.length === 0 ? (
              <div className="mt-5 border border-white/10 bg-black p-5 text-sm text-white/65">
                Loading prediction history...
              </div>
            ) : historyError ? (
              <div className="mt-5 border border-[var(--pixel-red)]/40 bg-[rgba(255,52,93,0.08)] p-4 text-xs text-[var(--pixel-red)]">
                History failed to load. Try again in a few seconds.
              </div>
            ) : history.length === 0 ? (
              <div className="mt-5 border border-white/10 bg-black p-5 text-sm text-white/65">
                No predictions from this wallet yet.
              </div>
            ) : (
              <div className="mt-5 max-h-[520px] space-y-3 overflow-y-auto pr-1">
                {history.map((item) => {
                  const resultTone =
                    item.result === "Win"
                      ? "green"
                      : item.result === "Loss"
                        ? "red"
                        : item.result === "Pending"
                          ? "yellow"
                          : "white";

                  return (
                    <article
                      key={item.roundId.toString()}
                      className="border border-white/10 bg-black p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-white">
                            #{item.roundId.toString()} · {item.symbol}
                          </p>
                          <p className="mt-1 text-[11px] text-white/55">
                            UP {formatNusd(item.upAmount)} · DOWN {formatNusd(item.downAmount)}
                          </p>
                        </div>
                        <StatusBadge status={resultTone}>{item.result}</StatusBadge>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-white/60">
                        <span>Outcome: {item.outcome}</span>
                        <span className="text-[var(--pixel-yellow)]">
                          {item.claimed
                            ? "Claimed"
                            : item.claimable > 0n
                              ? `${formatNusd(item.claimable)} NUSD due`
                              : "No claim"}
                        </span>
                      </div>
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
