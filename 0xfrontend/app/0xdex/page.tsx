"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useQueryClient } from "@tanstack/react-query";

const loadChartWindow = () => import("@/app/components/ChartWindow");
const ChartWindow = dynamic(loadChartWindow, {
  ssr: false,
});

import { useAccount, useReadContract, useConnect, useDisconnect, useBlockNumber, useWriteContract, useSwitchChain, usePublicClient, useWatchContractEvent } from "wagmi";
import { erc20Abi, formatUnits, maxUint256, parseUnits, parseAbiItem } from "viem";
import { useDexStats, useAllPools, useDexRead, useRewardRead, useDexWrite, NATIVE_TOKEN, useTokenBalance, useTokenAllowance, Token } from "@/lib/use0xDex";
import { DEX_ABI, DEX_ADDRESS, NATIVE_ADDRESS } from "@/lib/0xDexAbi";
import { NUSD_ADDRESS, NUSD_ABI } from "@/lib/NUSDContract";
import { REWARD_MANAGER_ADDRESS } from "@/lib/rewardAbi";
import { useToast } from "@/components/Toast";
import { PageLoader } from "@/components/PageLoader";
import { useGSAP } from "@gsap/react";
import { gsapPixelStagger } from "@/lib/gsap-animations";
import { fetchCandlesRequest, getCandlesQueryKey } from "@/app/hooks/useCandleData";

// ============================================================
// Pixel Skeleton Component - Dark theme shimmer loader
// ============================================================
function PixelSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-white/5 border border-white/10 ${className}`}
      style={{
        backgroundImage: "none",
      }}
    />
  );
}

function PoolCardSkeleton() {
  return (
    <div className="p-4 xl:p-5 bg-[#13131F] border border-[#2D2D44]">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <PixelSkeleton className="w-8 h-4" />
          <PixelSkeleton className="w-7 h-7 rounded-full" />
          <PixelSkeleton className="w-20 h-5" />
          <PixelSkeleton className="w-16 h-4" />
        </div>
        <PixelSkeleton className="w-14 h-6" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3 mt-2">
        <div className="bg-[#1A1A2E]/50 p-2">
          <PixelSkeleton className="w-8 h-3 mb-1" />
          <PixelSkeleton className="w-16 h-4" />
        </div>
        <div className="bg-[#1A1A2E]/50 p-2">
          <PixelSkeleton className="w-12 h-3 mb-1" />
          <PixelSkeleton className="w-14 h-4" />
        </div>
        <div className="bg-[#1A1A2E]/50 p-2">
          <PixelSkeleton className="w-14 h-3 mb-1" />
          <PixelSkeleton className="w-12 h-4" />
        </div>
        <div className="bg-[#1A1A2E]/50 p-2">
          <PixelSkeleton className="w-16 h-3 mb-1" />
          <PixelSkeleton className="w-14 h-4" />
        </div>
      </div>
    </div>
  );
}

function StatSkeleton() {
  return (
    <div className="bg-gradient-to-br from-[#1A1A2E] to-[#13131F] border border-[#2D2D44] p-4">
      <div className="flex items-center gap-2 mb-2">
        <PixelSkeleton className="w-4 h-4" />
        <PixelSkeleton className="w-16 h-3" />
      </div>
      <PixelSkeleton className="w-24 h-6" />
    </div>
  );
}

// Type definitions
interface PoolData {
  token0: `0x${string}`;
  token1: `0x${string}`;
  reserve0: bigint;
  reserve1: bigint;
  totalLP: bigint;
  volume24h: bigint;
  totalVolume: bigint;
}

// Helper to cast pool data
function castPoolData(data: unknown): PoolData | null {
  if (!data || !Array.isArray(data) || data.length < 7) return null;
  return {
    token0: data[0] as `0x${string}`,
    token1: data[1] as `0x${string}`,
    reserve0: data[2] as bigint,
    reserve1: data[3] as bigint,
    totalLP: data[4] as bigint,
    volume24h: data[5] as bigint,
    totalVolume: data[6] as bigint,
  };
}

// ============================================================
// AMM helpers — must mirror ZeroDex.sol exactly so Swap UI
// estimate and on-chain execution agree to the wei.
// ============================================================

const BPS_DENOM = 10000n; // matches `swapFee / 10000` in 0xDex.sol
type ChartTf = 1 | 15 | 60 | 240 | 1440;
const DEFAULT_CHART_TF: ChartTf = 1;
const CHART_PRELOAD_TIMEFRAMES = [1, 15, 60, 240, 1440] as const satisfies readonly ChartTf[];
const CHART_WARM_POOL_LIMIT = 6;
const CHART_TIMEFRAMES = new Set<number>([1, 15, 60, 240, 1440]);
const SWAP_SLIPPAGE_BPS = 300n;
const SWAP_PRICE_REFRESH_MS = 2_000;

type ChartPreloadTarget = {
  pairId: string;
  chartAnchor: { price: number | null; tokenDecimals: number };
  chartLabel: string;
  chartToken0: string;
  chartToken1: string;
  chartToken1Decimals: number;
};

type PoolDataTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
  bigint,
];

function parseChartTimeframe(value: string | null): ChartTf {
  const parsed = Number(value);
  return CHART_TIMEFRAMES.has(parsed) ? parsed as ChartTf : DEFAULT_CHART_TF;
}

function quoteSwapFromPool(
  amountIn: bigint,
  pool: PoolDataTuple,
  tokenIn: `0x${string}`,
  swapFeeBps: bigint,
) {
  const isToken0In = tokenIn.toLowerCase() === pool[0].toLowerCase();
  const reserveIn = isToken0In ? pool[2] : pool[3];
  const reserveOut = isToken0In ? pool[3] : pool[2];

  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return { amountOut: 0n, reserveIn, reserveOut, fee: 0n, amountInAfterFee: 0n };
  }

  const fee = (amountIn * swapFeeBps) / BPS_DENOM;
  const amountInAfterFee = amountIn - fee;
  const amountOut = amountInAfterFee <= 0n
    ? 0n
    : (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

  return { amountOut, reserveIn, reserveOut, fee, amountInAfterFee };
}

function minOutWithSlippage(amountOut: bigint, slippageBps = SWAP_SLIPPAGE_BPS) {
  if (amountOut <= 0n || slippageBps >= BPS_DENOM) return 0n;
  return (amountOut * (BPS_DENOM - slippageBps)) / BPS_DENOM;
}

/**
 * Display helper: "1 TokenIn = X TokenOut" with proper decimal scaling.
 * Uses human-readable numbers (NOT 1e18) so it's the same number you'd see on the chart.
 */
function humanRate(
  tokenIn: `0x${string}`,
  pool: PoolData,
  tokenInDecimals: number,
  tokenOutDecimals: number
): number {
  if (pool.reserve0 === 0n || pool.reserve1 === 0n) return 0;
  const reserveIn =
    tokenIn.toLowerCase() === pool.token0.toLowerCase() ? pool.reserve0 : pool.reserve1;
  const reserveOut =
    tokenIn.toLowerCase() === pool.token0.toLowerCase() ? pool.reserve1 : pool.reserve0;
  const adj = 10 ** (tokenOutDecimals - tokenInDecimals);
  return (Number(reserveIn) / Number(reserveOut)) * adj;
}

const KNOWN_TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: NUSD_ADDRESS,
    symbol: "$NUSD",
    decimals: 18,
    name: "NUSD Stablecoin",
  },
];

function formatUSD(value: bigint, decimals = 18) {
  const num = Number(formatUnits(value, decimals));
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

function formatUSDFloat(num: number) {
  if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`;
  if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `$${(num / 1e3).toFixed(2)}K`;
  return `$${num.toFixed(2)}`;
}

function formatNum(value: bigint, decimals = 18) {
  const num = Number(formatUnits(value, decimals));
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

const SWAPPED_EVENT = parseAbiItem(
  "event Swapped(address indexed user, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, uint256 fee)"
);
const SWAP_HISTORY_LOOKBACK_BLOCKS = 12_000n;
const SWAP_HISTORY_COUNT_CHUNK_BLOCKS = 20_000n;
const SWAP_HISTORY_PAGE_SIZE = 1000;
const SWAP_HISTORY_DISPLAY_LIMIT = 80;
const SWAP_HISTORY_MAX_COUNT_PAGES = 100;
const DEFAULT_DEX_START_BLOCK = 24_937_136n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const SWAP_HISTORY_QUERY = `
  query GetSwapHistory($limit: Int!, $skip: Int!) {
    swaps(first: $limit, skip: $skip, orderBy: timestamp, orderDirection: desc) {
      id
      user
      tokenIn
      tokenOut
      amountIn
      amountOut
      fee
      timestamp
    }
  }
`;

const SWAP_HISTORY_RAW_QUERY = `
  query GetSwapHistoryRaw($limit: Int!, $skip: Int!) {
    swaps: swappeds(first: $limit, skip: $skip, orderBy: timestamp_, orderDirection: desc) {
      id
      user
      tokenIn
      tokenOut
      amountIn
      amountOut
      fee
      timestamp: timestamp_
    }
  }
`;

function configuredDexStartBlock(latestBlock: bigint) {
  const value = process.env.NEXT_PUBLIC_DEX_START_BLOCK;
  if (value && /^\d+$/.test(value)) {
    const block = BigInt(value);
    return block <= latestBlock ? block : latestBlock;
  }
  return DEFAULT_DEX_START_BLOCK <= latestBlock ? DEFAULT_DEX_START_BLOCK : 0n;
}

type TokenMeta = {
  symbol: string;
  decimals: number;
};

type SwapHistoryItem = {
  id: string;
  txHash?: `0x${string}`;
  blockNumber: bigint;
  logIndex: number;
  user: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  timestamp: number;
  live: boolean;
};

type SwappedLogArgs = {
  user: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
};

type SwapLogLike = {
  args?: SwappedLogArgs;
  transactionHash?: `0x${string}`;
  blockHash?: `0x${string}`;
  blockNumber?: bigint;
  logIndex?: number;
};

type SubgraphSwap = {
  id: string;
  user?: string;
  tokenIn?: string;
  tokenOut?: string;
  amountIn?: string;
  amountOut?: string;
  fee?: string;
  timestamp?: string | number | { seconds?: string | number };
};

function hasSwapArgs(log: SwapLogLike): log is SwapLogLike & { args: SwappedLogArgs } {
  return !!log.args;
}

function shortAddress(value?: string) {
  if (!value) return "--";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function tokenKey(value: string) {
  return value.toLowerCase();
}

function normalizeSwapHistoryId(value: string) {
  return value.toLowerCase();
}

function makeSwapHistoryId(log: SwapLogLike) {
  return normalizeSwapHistoryId(`${log.transactionHash ?? log.blockHash ?? log.blockNumber}-${Number(log.logIndex ?? 0)}`);
}

function asAddress(value: unknown): `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value)
    ? (value as `0x${string}`)
    : ZERO_ADDRESS;
}

function asTxHash(value: unknown): `0x${string}` | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.match(/0x[a-fA-F0-9]{64}/);
  return match ? (match[0] as `0x${string}`) : undefined;
}

function parseSubgraphTimestamp(value: unknown): number {
  if (typeof value === "string" || typeof value === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "seconds" in value) {
    const parsed = Number((value as { seconds?: string | number }).seconds);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function getTokenMeta(map: Map<string, TokenMeta>, address: `0x${string}`): TokenMeta {
  return map.get(tokenKey(address)) ?? {
    symbol: shortAddress(address),
    decimals: 18,
  };
}

function formatTokenAmount(value: bigint, decimals: number) {
  const num = Number(formatUnits(value, decimals));
  if (!Number.isFinite(num)) return "0";
  if (num === 0) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  if (num >= 1) return num.toFixed(num >= 100 ? 2 : 4).replace(/\.?0+$/, "");
  return num.toFixed(8).replace(/\.?0+$/, "");
}

function formatSwapTime(timestamp: number) {
  if (!timestamp) return "syncing";
  return new Date(timestamp * 1000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSwapSide(item: SwapHistoryItem) {
  const tokenInIsNusd = item.tokenIn.toLowerCase() === NUSD_ADDRESS.toLowerCase();
  const tokenOutIsNusd = item.tokenOut.toLowerCase() === NUSD_ADDRESS.toLowerCase();
  if (tokenInIsNusd) return "BUY";
  if (tokenOutIsNusd) return "SELL";
  return "SWAP";
}

function parseSubgraphSwap(item: SubgraphSwap, index: number): SwapHistoryItem | null {
  if (!item.id || !item.tokenIn || !item.tokenOut || !item.amountIn || !item.amountOut) return null;
  const timestamp = parseSubgraphTimestamp(item.timestamp);
  const id = normalizeSwapHistoryId(item.id);
  const logIndexFromId = Number(item.id.split("-").pop() || index);

  try {
    return {
      id,
      txHash: asTxHash(item.id),
      blockNumber: BigInt(timestamp || 0),
      logIndex: Number.isFinite(logIndexFromId) ? logIndexFromId : index,
      user: asAddress(item.user),
      tokenIn: asAddress(item.tokenIn),
      tokenOut: asAddress(item.tokenOut),
      amountIn: BigInt(item.amountIn),
      amountOut: BigInt(item.amountOut),
      fee: BigInt(item.fee || "0"),
      timestamp,
      live: false,
    };
  } catch {
    return null;
  }
}

function normalizeDecimalInput(value: string) {
  return value.replace(/,/g, ".").replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
}

function isDecimalInput(value: string) {
  return /^(?:\d+|\d*\.\d+)$/.test(value);
}

function safeParseUnits(value: string, decimals: number): bigint | null {
  const trimmed = value.trim();
  if (!isDecimalInput(trimmed)) return null;
  try {
    return parseUnits(trimmed, decimals);
  } catch {
    return null;
  }
}

function isPositiveDecimal(value: string) {
  const parsed = safeParseUnits(value, 18);
  return parsed !== null && parsed > 0n;
}

function formatDecimalForInput(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "";
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumFractionDigits: 18,
  });
}

function StatCard({ label, value, icon, color }: { label: string; value: string; icon: string; color?: string }) {
  const tone =
    color ||
    (label.toLowerCase().includes("volume")
      ? "violet"
      : label.toLowerCase().includes("pool")
        ? "amber"
        : label.toLowerCase().includes("reward")
          ? "green"
          : "cyan");

  return (
    <div data-stat-tone={tone} className="pixel-stat-card relative overflow-hidden border border-[#2D2D44] bg-[#13131F] p-4">
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="pixel-stat-icon text-sm opacity-80">{icon}</span>
          <span className="text-[10px] md:text-xs uppercase tracking-wider text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>
            {label}
          </span>
        </div>
        <div className="pixel-stat-value text-lg md:text-xl xl:text-2xl font-bold text-white whitespace-nowrap" style={{ fontFamily: "var(--font-departure)" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function PoolCard({
  token0,
  token1,
  reserve0,
  reserve1,
  volume24h,
  totalVolume,
  lpTotal,
  rank,
  pairId,
  swapHref,
  chartHref,
  onSelect,
  onViewChart,
  tokenSymbol,
  tokenDecimals = 18,
}: {
  token0: `0x${string}`; token1: `0x${string}`; reserve0: bigint; reserve1: bigint; volume24h: bigint; totalVolume: bigint; lpTotal: bigint; rank: number;
  pairId: `0x${string}`;
  swapHref: string;
  chartHref: string;
  onSelect?: (data: { token: `0x${string}`, nusd: `0x${string}`, reserve0: bigint, reserve1: bigint }) => void;
  onViewChart?: (data: { price: number | null; tokenDecimals: number }) => void;
  tokenSymbol?: string;
  tokenDecimals?: number;
}) {
  const NUSD_ADDRESS_LOCAL = NUSD_ADDRESS;
  const NATIVE = NATIVE_ADDRESS;
  const isToken0NUSD = token0.toLowerCase() === NUSD_ADDRESS_LOCAL.toLowerCase();
  const isToken1NUSD = token1.toLowerCase() === NUSD_ADDRESS_LOCAL.toLowerCase();
  const isToken0Native = token0.toLowerCase() === NATIVE.toLowerCase();
  const otherToken = isToken0NUSD ? token1 : (isToken1NUSD ? token0 : token0);
  const nusdAddr = isToken0NUSD ? token0 : (isToken1NUSD ? token1 : null);
  const isOtherNative = isToken0NUSD ? isToken1NUSD : isToken0Native;
  const reserveOther = isToken0NUSD ? reserve1 : (isToken1NUSD ? reserve0 : reserve1);
  const reserveNUSD = isToken0NUSD ? reserve0 : (isToken1NUSD ? reserve1 : reserve0);
  const displaySymbol = tokenSymbol || (isOtherNative ? "zkLTC" : otherToken.slice(0, 8) + "...");

  // Calculate price: NUSD per Token
  // Since pool has equal value on both sides: reserveNUSD * price = reserveOther
  // So: price (NUSD per Token) = reserveNUSD / reserveOther
  const pricePerToken = reserveNUSD > 0n && reserveOther > 0n
    ? Number(formatUnits(reserveNUSD, 18)) / Number(formatUnits(reserveOther, tokenDecimals))
    : 0;

  const handleClick = () => {
    if (!nusdAddr) return;
    onSelect?.({ token: otherToken, nusd: nusdAddr, reserve0: reserveOther, reserve1: reserveNUSD });
  };

  // TVL = reserveToken (in USD) + reserveNUSD = 2 * reserveNUSD (since they're equal value)
  const tvlUSD = reserveNUSD > 0n ? Number(formatUnits(reserveNUSD, 18)) * 2 : 0;

  return (
    <div
      data-pair-id={pairId}
      className="pool-card-item p-4 xl:p-5 rounded-xl bg-[#13131F] border border-[#2D2D44] hover:border-[#8888ff]/50 transition-all cursor-pointer"
      onClick={handleClick}
    >
      {/* Top Row: Rank, Symbol, Price */}
        <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#64748B] bg-[#2D2D44] px-2 py-0.5 rounded">#{rank}</span>
          <div className="w-7 h-7 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] text-xs font-bold">L$</div>
          <span className="font-bold text-white text-sm" style={{ fontFamily: "var(--font-departure)" }}>
            {displaySymbol}/$NUSD
          </span>
          <span className="pixel-live-price text-xs text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
            ${pricePerToken > 0 ? pricePerToken.toFixed(6) : "0"}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Link
            href={swapHref}
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
            className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
            title={`Swap ${displaySymbol}/NUSD`}
          >
            SWAP
          </Link>
          {onViewChart && (
            <Link
              href={chartHref}
              onClick={(e) => {
                e.stopPropagation();
                onViewChart({ price: pricePerToken > 0 ? pricePerToken : null, tokenDecimals });
              }}
              className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
              title={`Chart ${displaySymbol}/NUSD`}
            >
              CHART
            </Link>
          )}
        </div>
      </div>
      
      {/* Stats Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 lg:gap-3 mt-2">
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">TVL</div>
          <div className="pixel-metric-value pixel-metric-tvl text-xs font-bold text-white truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSDFloat(tvlUSD)}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">LP Shares</div>
          <div className="pixel-metric-value pixel-metric-lp text-xs font-bold text-amber-400 truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatNum(lpTotal)}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">24h Volume</div>
          <div className="pixel-metric-value pixel-metric-volume text-xs font-bold text-[#8888ff] truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSD(volume24h)}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">Total Volume</div>
          <div className="pixel-metric-value pixel-metric-total text-xs font-bold text-[#8888ff] truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSD(totalVolume)}
          </div>
        </div>
      </div>
    </div>
  );
}

function SwapHistoryPanel({
  swaps,
  loading,
  totalCount,
  tokenMetaByAddress,
}: {
  swaps: SwapHistoryItem[];
  loading: boolean;
  totalCount: number | null;
  tokenMetaByAddress: Map<string, TokenMeta>;
}) {
  const txCountLabel = totalCount === null
    ? swaps.length.toLocaleString()
    : totalCount.toLocaleString();

  return (
    <section className="dex-swap-history pixel-panel">
      <div className="dex-history-head">
        <div>
          <p className="dex-eyebrow">ONCHAIN</p>
          <h2>Swap History</h2>
        </div>
        <div className="dex-history-meta">
          <div className="dex-tx-count">TX {txCountLabel}</div>
          <div className="dex-live-badge">
            <span className="dex-live-dot" />
            {loading ? "SYNCING" : "LIVE"}
          </div>
        </div>
      </div>

      <div className="dex-history-table">
        <div className="dex-history-row dex-history-row-head">
          <span>Pair</span>
          <span>Trade</span>
          <span>Wallet</span>
          <span>Time</span>
        </div>

        {swaps.length === 0 ? (
          <div className="dex-history-empty">
            {loading ? "Loading onchain swaps..." : "No swaps found yet"}
          </div>
        ) : (
          swaps.slice(0, 80).map((item) => {
            const tokenInMeta = getTokenMeta(tokenMetaByAddress, item.tokenIn);
            const tokenOutMeta = getTokenMeta(tokenMetaByAddress, item.tokenOut);
            const side = getSwapSide(item);
            const otherSymbol =
              side === "BUY"
                ? tokenOutMeta.symbol
                : side === "SELL"
                  ? tokenInMeta.symbol
                  : tokenInMeta.symbol;
            const pairLabel =
              side === "SWAP"
                ? `${tokenInMeta.symbol}/${tokenOutMeta.symbol}`
                : `${otherSymbol}/NUSD`;

            return (
              <div key={item.id} className="dex-history-row">
                <div className="dex-history-pair">
                  <span className={`dex-side dex-side-${side.toLowerCase()}`}>{side}</span>
                  <span>{pairLabel}</span>
                  {item.live && <span className="dex-new-chip">NEW</span>}
                </div>
                <div className="dex-history-flow">
                  <span>{formatTokenAmount(item.amountIn, tokenInMeta.decimals)} {tokenInMeta.symbol}</span>
                  <span className="dex-history-arrow">-&gt;</span>
                  <span>{formatTokenAmount(item.amountOut, tokenOutMeta.decimals)} {tokenOutMeta.symbol}</span>
                </div>
                <div className="dex-history-wallet">
                  <span>{shortAddress(item.user)}</span>
                  <span className="dex-history-block">
                    {item.txHash ? shortAddress(item.txHash) : `#${item.blockNumber.toString()}`}
                  </span>
                </div>
                <div className="dex-history-time">{formatSwapTime(item.timestamp)}</div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

// ============================================================
// Shimmer Animation Style
// ============================================================
const shimmerStyle = `
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
`;

export default function DexAllInOne() {
  const queryClient = useQueryClient();
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { writeContract, writeContractAsync } = useWriteContract();
  const toast = useToast();
  const { addLiquidity, removeLiquidity, claimReward } = useDexWrite();
  const LITVM_CHAIN_ID = 4441;
  const poolListRef = useRef<HTMLDivElement>(null);
  const publicClient = usePublicClient();
  const [swapHistory, setSwapHistory] = useState<SwapHistoryItem[]>([]);
  const [swapHistoryLoading, setSwapHistoryLoading] = useState(false);
  const [swapHistoryTotalCount, setSwapHistoryTotalCount] = useState<number | null>(null);
  const lastSwapHistoryBlockRef = useRef<bigint>(0n);
  const swapHistoryPollingRef = useRef(false);
  const swapHistorySeenIdsRef = useRef<Set<string>>(new Set());

  // Pixel-style stagger entry for pool cards
  useGSAP(
    () => {
      if (!poolListRef.current) return;
      const cards = poolListRef.current.querySelectorAll(".pool-card-item");
      if (cards.length === 0) return;
      gsapPixelStagger(cards, { stagger: 0.05, delay: 0.1 });
    },
    { scope: poolListRef }
  );

  // State
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"swap" | "pools" | "create">("swap");

  // Farm state - Add Liquidity = Farm (no separate stake needed)
  const [selectedFarmPool, setSelectedFarmPool] = useState(0);
  const [farmNUSDAmount, setFarmNUSDAmount] = useState("");
  const [farmLpAmount, setFarmLpAmount] = useState("");
  const [farmUserLP, setFarmUserLP] = useState<bigint | undefined>();
  const [farmPending, setFarmPending] = useState<bigint | undefined>();

  // Auto-switch to LitVM when connected to wrong chain
  useEffect(() => {
    if (isConnected && chainId && chainId !== LITVM_CHAIN_ID) {
      toast.info("Wrong Network", "Switching to LitVM...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
    }
  }, [isConnected, chainId, switchChain, toast]);

  // Swap state
  const [swapTokenIn, setSwapTokenIn] = useState<Token>(KNOWN_TOKENS[1]); // NUSD
  const [swapTokenOut, setSwapTokenOut] = useState<Token | null>(NATIVE_TOKEN); // zkLTC
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapAmountOut, setSwapAmountOut] = useState("");
  const [isSwapSubmitting, setIsSwapSubmitting] = useState(false);

  // Pool state
  const [poolToken, setPoolToken] = useState<Token>(NATIVE_TOKEN);
  const [poolAmountToken, setPoolAmountToken] = useState("");
  const [poolAmountNUSD, setPoolAmountNUSD] = useState("");
  const [pairFilter, setPairFilter] = useState<"tvl" | "vol24h" | "volAll" | "new">("tvl");

  // Admin state
  const [createTokenA, setCreateTokenA] = useState("");
  const [createAmountA, setCreateAmountA] = useState("");
  const [createAmountB, setCreateAmountB] = useState("");

  // Fetch token info when address changes
  const { data: tokenName } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "name",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: tokenSymbol } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: tokenDecimals } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: createTokenBalance } = useTokenBalance(address, createTokenA ? { address: createTokenA as `0x${string}`, symbol: tokenSymbol as string || "TOKEN", decimals: tokenDecimals as number || 18, name: tokenName as string || "Token" } : null);
  
  // Chart state - select a pair to view chart
  const [selectedChartPair, setSelectedChartPair] = useState<string | null>(null);
  const [selectedChartAnchor, setSelectedChartAnchor] = useState<{
    price: number | null;
    tokenDecimals: number;
  } | null>(null);
  const [selectedChartTimeframe, setSelectedChartTimeframe] = useState<ChartTf>(DEFAULT_CHART_TF);
  const [showChart, setShowChart] = useState(false);
  const [chartPreloadLabel, setChartPreloadLabel] = useState<string | null>(null);
  const [chartPreloadProgress, setChartPreloadProgress] = useState(0);
  const routePairAppliedRef = useRef(false);
  const chartPreloadSeqRef = useRef(0);
  const chartWarmCacheRef = useRef(new Set<string>());

  useEffect(() => {
    if (typeof window === "undefined") return;

    const warmChart = () => {
      void loadChartWindow();
    };
    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(warmChart, { timeout: 2500 });
      return () => win.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(warmChart, 1200);
    return () => window.clearTimeout(handle);
  }, []);

  // Data
  const stats = useDexStats();
  const { data: allPools } = useAllPools();
  const { data: nusdAddress } = useDexRead<`0x${string}`>("NUSD");
  const { data: rewardPoolNusdBalance } = useReadContract({
    address: NUSD_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [REWARD_MANAGER_ADDRESS],
    query: { refetchInterval: 6_000 },
  });

  // Check allowance for create pool token
  const { data: createTokenAllowance, refetch: refetchAllowance } = useTokenAllowance(
    createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? { address: createTokenA as `0x${string}`, symbol: tokenSymbol || "TOKEN", decimals: tokenDecimals || 18, name: tokenName || "Token" } : null,
    DEX_ADDRESS as `0x${string}`
  );
  const createAmountAParsed = useMemo(
    () => safeParseUnits(createAmountA, Number(tokenDecimals ?? 18)),
    [createAmountA, tokenDecimals],
  );
  const createAmountBParsed = useMemo(
    () => safeParseUnits(createAmountB, 18),
    [createAmountB],
  );
  const needsCreateApproval =
    !!createTokenA &&
    !!createAmountAParsed &&
    createAmountAParsed > 0n &&
    createTokenA.toLowerCase() !== NATIVE_ADDRESS.toLowerCase() &&
    (!createTokenAllowance || (createTokenAllowance as bigint) < createAmountAParsed);

  // Pool options - dedupe by pairId
  const poolOptions = useMemo(() => {
    if (!allPools || !nusdAddress) return [];
    const seen = new Set<string>();
    return allPools
      .map(({ pairId, token0, token1 }) => {
        const token = token0.toLowerCase() === nusdAddress.toLowerCase() ? token1 : token0;
        const nusd = nusdAddress;
        // Skip duplicates
        const pairKey = pairId.toLowerCase();
        if (seen.has(pairKey)) return null;
        seen.add(pairKey);
        return {
          token,
          nusd,
          pairId,
          label: `${token.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? "zkLTC" : token.slice(0, 8) + "..."}/NUSD`,
        };
      })
      .filter(Boolean) as { token: `0x${string}`; nusd: `0x${string}`; pairId: `0x${string}`; label: string }[];
  }, [allPools, nusdAddress]);

  // Get pool data for each option (max 8)
  const pool0PairId = poolOptions[0]?.pairId;
  const pool1PairId = poolOptions[1]?.pairId;
  const pool2PairId = poolOptions[2]?.pairId;
  const pool3PairId = poolOptions[3]?.pairId;
  const pool4PairId = poolOptions[4]?.pairId;
  const pool5PairId = poolOptions[5]?.pairId;
  const pool6PairId = poolOptions[6]?.pairId;
  const pool7PairId = poolOptions[7]?.pairId;

  const { data: pool0Data, refetch: refetchPool0 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool0PairId ? [pool0PairId] : undefined);
  const { data: pool1Data, refetch: refetchPool1 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool1PairId ? [pool1PairId] : undefined);
  const { data: pool2Data, refetch: refetchPool2 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool2PairId ? [pool2PairId] : undefined);
  const { data: pool3Data, refetch: refetchPool3 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool3PairId ? [pool3PairId] : undefined);
  const { data: pool4Data, refetch: refetchPool4 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool4PairId ? [pool4PairId] : undefined);
  const { data: pool5Data, refetch: refetchPool5 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool5PairId ? [pool5PairId] : undefined);
  const { data: pool6Data, refetch: refetchPool6 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool6PairId ? [pool6PairId] : undefined);
  const { data: pool7Data, refetch: refetchPool7 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint] >("pools", pool7PairId ? [pool7PairId] : undefined);
  const { refetch: refetchAllPools } = useAllPools();

  // Calculate total volume from all pools
  const totalVolume = useMemo(() => {
    const volumes = [pool0Data?.[6], pool1Data?.[6], pool2Data?.[6], pool3Data?.[6], pool4Data?.[6], pool5Data?.[6], pool6Data?.[6], pool7Data?.[6]];
    return volumes.reduce((sum: bigint, v) => sum + (v ?? 0n), 0n);
  }, [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data]);

  // Fetch token symbols for each pool
  const { data: token0Symbol } = useReadContract({
    address: poolOptions[0]?.token !== NATIVE_ADDRESS ? poolOptions[0]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[0]?.token && poolOptions[0]?.token !== NATIVE_ADDRESS }
  });
  const { data: token1Symbol } = useReadContract({
    address: poolOptions[1]?.token !== NATIVE_ADDRESS ? poolOptions[1]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[1]?.token && poolOptions[1]?.token !== NATIVE_ADDRESS }
  });
  const { data: token2Symbol } = useReadContract({
    address: poolOptions[2]?.token !== NATIVE_ADDRESS ? poolOptions[2]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[2]?.token && poolOptions[2]?.token !== NATIVE_ADDRESS }
  });
  const { data: token3Symbol } = useReadContract({
    address: poolOptions[3]?.token !== NATIVE_ADDRESS ? poolOptions[3]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[3]?.token && poolOptions[3]?.token !== NATIVE_ADDRESS }
  });
  const { data: token4Symbol } = useReadContract({
    address: poolOptions[4]?.token !== NATIVE_ADDRESS ? poolOptions[4]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[4]?.token && poolOptions[4]?.token !== NATIVE_ADDRESS }
  });
  const { data: token5Symbol } = useReadContract({
    address: poolOptions[5]?.token !== NATIVE_ADDRESS ? poolOptions[5]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[5]?.token && poolOptions[5]?.token !== NATIVE_ADDRESS }
  });
  const { data: token6Symbol } = useReadContract({
    address: poolOptions[6]?.token !== NATIVE_ADDRESS ? poolOptions[6]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[6]?.token && poolOptions[6]?.token !== NATIVE_ADDRESS }
  });
  const { data: token7Symbol } = useReadContract({
    address: poolOptions[7]?.token !== NATIVE_ADDRESS ? poolOptions[7]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[7]?.token && poolOptions[7]?.token !== NATIVE_ADDRESS }
  });

  const { data: token0Decimals } = useReadContract({
    address: poolOptions[0]?.token !== NATIVE_ADDRESS ? poolOptions[0]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[0]?.token && poolOptions[0]?.token !== NATIVE_ADDRESS }
  });
  const { data: token1Decimals } = useReadContract({
    address: poolOptions[1]?.token !== NATIVE_ADDRESS ? poolOptions[1]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[1]?.token && poolOptions[1]?.token !== NATIVE_ADDRESS }
  });
  const { data: token2Decimals } = useReadContract({
    address: poolOptions[2]?.token !== NATIVE_ADDRESS ? poolOptions[2]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[2]?.token && poolOptions[2]?.token !== NATIVE_ADDRESS }
  });
  const { data: token3Decimals } = useReadContract({
    address: poolOptions[3]?.token !== NATIVE_ADDRESS ? poolOptions[3]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[3]?.token && poolOptions[3]?.token !== NATIVE_ADDRESS }
  });
  const { data: token4Decimals } = useReadContract({
    address: poolOptions[4]?.token !== NATIVE_ADDRESS ? poolOptions[4]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[4]?.token && poolOptions[4]?.token !== NATIVE_ADDRESS }
  });
  const { data: token5Decimals } = useReadContract({
    address: poolOptions[5]?.token !== NATIVE_ADDRESS ? poolOptions[5]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[5]?.token && poolOptions[5]?.token !== NATIVE_ADDRESS }
  });
  const { data: token6Decimals } = useReadContract({
    address: poolOptions[6]?.token !== NATIVE_ADDRESS ? poolOptions[6]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[6]?.token && poolOptions[6]?.token !== NATIVE_ADDRESS }
  });
  const { data: token7Decimals } = useReadContract({
    address: poolOptions[7]?.token !== NATIVE_ADDRESS ? poolOptions[7]?.token : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!poolOptions[7]?.token && poolOptions[7]?.token !== NATIVE_ADDRESS }
  });

  const tokenSymbols = useMemo(
    () => [token0Symbol, token1Symbol, token2Symbol, token3Symbol, token4Symbol, token5Symbol, token6Symbol, token7Symbol],
    [token0Symbol, token1Symbol, token2Symbol, token3Symbol, token4Symbol, token5Symbol, token6Symbol, token7Symbol]
  );
  const tokenDecimalsList = useMemo(
    () => [token0Decimals, token1Decimals, token2Decimals, token3Decimals, token4Decimals, token5Decimals, token6Decimals, token7Decimals],
    [token0Decimals, token1Decimals, token2Decimals, token3Decimals, token4Decimals, token5Decimals, token6Decimals, token7Decimals]
  );

  const tokenMetaByAddress = useMemo(() => {
    const map = new Map<string, TokenMeta>();
    for (const token of KNOWN_TOKENS) {
      map.set(tokenKey(token.address), {
        symbol: token.symbol.replace(/^\$/, ""),
        decimals: token.decimals,
      });
    }
    poolOptions.forEach((pool, index) => {
      const symbol = pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
        ? "zkLTC"
        : (tokenSymbols[index] as string) || shortAddress(pool.token);
      map.set(tokenKey(pool.token), {
        symbol: symbol.replace(/^\$/, ""),
        decimals: pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
          ? 18
          : Number(tokenDecimalsList[index] ?? 18),
      });
    });
    return map;
  }, [poolOptions, tokenDecimalsList, tokenSymbols]);

  const addSwapHistoryItems = useCallback((items: SwapHistoryItem[]) => {
    if (!items.length) return 0;

    let newItemCount = 0;
    for (const item of items) {
      if (swapHistorySeenIdsRef.current.has(item.id)) continue;
      swapHistorySeenIdsRef.current.add(item.id);
      newItemCount += 1;
    }

    setSwapHistory((current) => {
      const byId = new Map<string, SwapHistoryItem>();
      for (const item of current) byId.set(item.id, item);
      for (const item of items) byId.set(item.id, item);
      return Array.from(byId.values())
        .sort((a, b) => {
          if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
          if (a.blockNumber === b.blockNumber) return b.logIndex - a.logIndex;
          return a.blockNumber > b.blockNumber ? -1 : 1;
        })
        .slice(0, SWAP_HISTORY_DISPLAY_LIMIT);
    });

    return newItemCount;
  }, []);

  const fetchSubgraphSwapPage = useCallback(async (skip: number, rawSchema: boolean) => {
    const response = await fetch("/api/subgraph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: rawSchema ? SWAP_HISTORY_RAW_QUERY : SWAP_HISTORY_QUERY,
        variables: {
          limit: SWAP_HISTORY_PAGE_SIZE,
          skip,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Subgraph request failed: ${response.status}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message || "Subgraph returned errors");
    }

    const swaps = json.data?.swaps;
    return Array.isArray(swaps) ? swaps as SubgraphSwap[] : [];
  }, []);

  const loadSwapHistoryFromSubgraph = useCallback(async () => {
    let rawSchema = false;
    let firstPage: SubgraphSwap[];

    try {
      firstPage = await fetchSubgraphSwapPage(0, false);
    } catch {
      rawSchema = true;
      firstPage = await fetchSubgraphSwapPage(0, true);
    }

    if (firstPage.length === 0) return false;

    const firstItems = firstPage
      .map((swap, index) => parseSubgraphSwap(swap, index))
      .filter((item): item is SwapHistoryItem => !!item);
    addSwapHistoryItems(firstItems);

    let totalCount = firstPage.length;
    setSwapHistoryTotalCount(totalCount);

    for (let page = 1; page < SWAP_HISTORY_MAX_COUNT_PAGES && firstPage.length === SWAP_HISTORY_PAGE_SIZE; page += 1) {
      const nextPage = await fetchSubgraphSwapPage(page * SWAP_HISTORY_PAGE_SIZE, rawSchema);
      totalCount += nextPage.length;
      setSwapHistoryTotalCount(totalCount);
      if (nextPage.length < SWAP_HISTORY_PAGE_SIZE) break;
      firstPage = nextPage;
    }

    return true;
  }, [addSwapHistoryItems, fetchSubgraphSwapPage]);

  const fetchSwapHistoryRange = useCallback(async (fromBlock: bigint, toBlock: bigint, live: boolean) => {
    if (!publicClient || toBlock < fromBlock) return 0;

    const logs = await publicClient.getLogs({
      address: DEX_ADDRESS as `0x${string}`,
      event: SWAPPED_EVENT,
      fromBlock,
      toBlock,
    }) as SwapLogLike[];

    const recentLogs = logs
      .filter(hasSwapArgs)
      .filter((log) => log.blockNumber !== undefined)
      .sort((a, b) => {
        if (a.blockNumber === b.blockNumber) return Number(b.logIndex ?? 0) - Number(a.logIndex ?? 0);
        return (a.blockNumber ?? 0n) > (b.blockNumber ?? 0n) ? -1 : 1;
      })
      .slice(0, 80);

    const now = Math.floor(Date.now() / 1000);
    const blockTimes = new Map<string, number>();
    if (!live) {
      const blockNumbers = Array.from(new Set(recentLogs.map((log) => log.blockNumber?.toString()).filter(Boolean))) as string[];
      await Promise.all(
        blockNumbers.map(async (blockNumberValue) => {
          try {
            const block = await publicClient.getBlock({ blockNumber: BigInt(blockNumberValue) });
            blockTimes.set(blockNumberValue, Number(block.timestamp));
          } catch {
            blockTimes.set(blockNumberValue, now);
          }
        })
      );
    }

    const historyItems = recentLogs.map((log) => ({
      id: makeSwapHistoryId(log),
      txHash: log.transactionHash,
      blockNumber: log.blockNumber ?? 0n,
      logIndex: Number(log.logIndex ?? 0),
      user: log.args.user,
      tokenIn: log.args.tokenIn,
      tokenOut: log.args.tokenOut,
      amountIn: log.args.amountIn,
      amountOut: log.args.amountOut,
      fee: log.args.fee,
      timestamp: live ? now : blockTimes.get((log.blockNumber ?? 0n).toString()) ?? now,
      live,
    }));
    const newItemCount = addSwapHistoryItems(historyItems);

    if (live && newItemCount > 0) {
      setSwapHistoryTotalCount((current) => current === null ? newItemCount : current + newItemCount);
    }

    if (toBlock > lastSwapHistoryBlockRef.current) {
      lastSwapHistoryBlockRef.current = toBlock;
    }

    return logs.length;
  }, [addSwapHistoryItems, publicClient]);

  const countSwapHistoryRange = useCallback(async (fromBlock: bigint, toBlock: bigint) => {
    if (!publicClient || toBlock < fromBlock) return 0;

    let total = 0;
    let cursor = fromBlock;
    let chunkSize = SWAP_HISTORY_COUNT_CHUNK_BLOCKS;

    while (cursor <= toBlock) {
      const chunkTo = cursor + chunkSize > toBlock ? toBlock : cursor + chunkSize;
      try {
        const logs = await publicClient.getLogs({
          address: DEX_ADDRESS as `0x${string}`,
          event: SWAPPED_EVENT,
          fromBlock: cursor,
          toBlock: chunkTo,
        });
        total += logs.length;
        cursor = chunkTo + 1n;
        if (chunkSize < SWAP_HISTORY_COUNT_CHUNK_BLOCKS) {
          chunkSize = chunkSize * 2n > SWAP_HISTORY_COUNT_CHUNK_BLOCKS
            ? SWAP_HISTORY_COUNT_CHUNK_BLOCKS
            : chunkSize * 2n;
        }
      } catch (error) {
        if (chunkSize <= 500n) throw error;
        chunkSize = chunkSize / 2n;
      }
    }

    return total;
  }, [publicClient]);

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function loadSwapHistory() {
      setSwapHistoryLoading(true);
      try {
        const loadedFromSubgraph = await loadSwapHistoryFromSubgraph();
        if (cancelled) return;

        const latestBlock = await publicClient.getBlockNumber();
        const countFromBlock = configuredDexStartBlock(latestBlock);
        const recentFromBlock = latestBlock > SWAP_HISTORY_LOOKBACK_BLOCKS
          ? latestBlock - SWAP_HISTORY_LOOKBACK_BLOCKS
          : countFromBlock;

        if (!loadedFromSubgraph) {
          await fetchSwapHistoryRange(recentFromBlock, latestBlock, false);
          if (cancelled) return;
        }

        if (countFromBlock <= latestBlock) {
          const totalCount = await countSwapHistoryRange(countFromBlock, latestBlock);
          if (!cancelled) {
            setSwapHistoryTotalCount(totalCount);
          }
        }
      } catch (error) {
        console.warn("Failed to load swap history", error);
      } finally {
        if (!cancelled) setSwapHistoryLoading(false);
      }
    }

    loadSwapHistory();
    return () => {
      cancelled = true;
    };
  }, [countSwapHistoryRange, fetchSwapHistoryRange, loadSwapHistoryFromSubgraph, publicClient]);

  useWatchContractEvent({
    address: DEX_ADDRESS as `0x${string}`,
    abi: DEX_ABI,
    eventName: "Swapped",
    onLogs(logs) {
      const now = Math.floor(Date.now() / 1000);
      const newItemCount = addSwapHistoryItems((logs as SwapLogLike[])
        .filter(hasSwapArgs)
        .map((log) => ({
          id: makeSwapHistoryId(log),
          txHash: log.transactionHash,
          blockNumber: log.blockNumber ?? 0n,
          logIndex: Number(log.logIndex ?? 0),
          user: log.args.user,
          tokenIn: log.args.tokenIn,
          tokenOut: log.args.tokenOut,
          amountIn: log.args.amountIn,
          amountOut: log.args.amountOut,
          fee: log.args.fee,
          timestamp: now,
          live: true,
        })));
      if (newItemCount > 0) {
        setSwapHistoryTotalCount((current) => current === null ? newItemCount : current + newItemCount);
      }
      const hasSelectedPairSwap = (logs as SwapLogLike[]).some((log) => {
        if (!hasSwapArgs(log) || !swapTokenOut) return false;
        const tokenIn = log.args.tokenIn.toLowerCase();
        const tokenOut = log.args.tokenOut.toLowerCase();
        const selectedIn = swapTokenIn.address.toLowerCase();
        const selectedOut = swapTokenOut.address.toLowerCase();
        return (
          (tokenIn === selectedIn && tokenOut === selectedOut) ||
          (tokenIn === selectedOut && tokenOut === selectedIn)
        );
      });
      if (hasSelectedPairSwap) {
        void refetchPool?.();
      }
      for (const log of logs as SwapLogLike[]) {
        if (log.blockNumber && log.blockNumber > lastSwapHistoryBlockRef.current) {
          lastSwapHistoryBlockRef.current = log.blockNumber;
        }
      }
    },
  });

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;

    async function pollNewSwapLogs() {
      if (cancelled || swapHistoryPollingRef.current) return;
      swapHistoryPollingRef.current = true;
      try {
        const latestBlock = await publicClient.getBlockNumber();
        const lastSeen = lastSwapHistoryBlockRef.current;
        const fromBlock = lastSeen > 0n
          ? lastSeen + 1n
          : latestBlock > 80n
            ? latestBlock - 80n
            : 0n;
        if (latestBlock >= fromBlock) {
          await fetchSwapHistoryRange(fromBlock, latestBlock, true);
        } else if (latestBlock > lastSwapHistoryBlockRef.current) {
          lastSwapHistoryBlockRef.current = latestBlock;
        }
      } catch (error) {
        console.warn("Failed to poll swap history", error);
      } finally {
        swapHistoryPollingRef.current = false;
      }
    }

    const intervalId = window.setInterval(pollNewSwapLogs, 6_000);
    pollNewSwapLogs();
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [fetchSwapHistoryRange, publicClient]);

  // Collect all pool data
  const allPoolData = useMemo<(PoolDataTuple | undefined)[]>(() => {
    return [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data] as (PoolDataTuple | undefined)[];
  }, [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data]);

  const getPoolTokenDecimals = useCallback((poolIndex: number) => {
    const pool = poolOptions[poolIndex];
    if (!pool) return 18;
    return pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
      ? 18
      : Number(tokenDecimalsList[poolIndex] ?? 18);
  }, [poolOptions, tokenDecimalsList]);

  const getPoolTokenSymbol = useCallback((poolIndex: number) => {
    const pool = poolOptions[poolIndex];
    if (!pool) return "TOKEN";
    return pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()
      ? "zkLTC"
      : (tokenSymbols[poolIndex] as string) || "TOKEN";
  }, [poolOptions, tokenSymbols]);

  const clearDexPairUrl = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.location.pathname === "/0xdex" && window.location.search) {
      window.history.replaceState(null, "", "/0xdex");
    }
  }, []);

  const selectPoolForSwap = useCallback((poolIndex: number, updateUrl = true) => {
    const pool = poolOptions[poolIndex];
    if (!pool) return;

    setActiveTab("swap");
    setSwapTokenIn(KNOWN_TOKENS[1]);
    if (pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
      setSwapTokenOut(NATIVE_TOKEN);
    } else {
      setSwapTokenOut({
        address: pool.token,
        symbol: getPoolTokenSymbol(poolIndex),
        decimals: getPoolTokenDecimals(poolIndex),
        name: "Token",
      });
    }
    if (updateUrl) clearDexPairUrl();
  }, [clearDexPairUrl, getPoolTokenDecimals, getPoolTokenSymbol, poolOptions]);

  const getChartAnchorForPool = useCallback((poolIndex: number) => {
    const pool = poolOptions[poolIndex];
    const pd = allPoolData[poolIndex];
    const tokenDecimalsForPool = getPoolTokenDecimals(poolIndex);
    if (!pool || !pd) return { price: null, tokenDecimals: tokenDecimalsForPool };

    const isToken0NUSD = pd[0].toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const isToken1NUSD = pd[1].toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const reserveOther = isToken0NUSD ? pd[3] : (isToken1NUSD ? pd[2] : pd[3]);
    const reserveNUSD = isToken0NUSD ? pd[2] : (isToken1NUSD ? pd[3] : pd[2]);
    const price = reserveNUSD > 0n && reserveOther > 0n
      ? Number(formatUnits(reserveNUSD, 18)) / Number(formatUnits(reserveOther, tokenDecimalsForPool))
      : 0;

    return { price: price > 0 ? price : null, tokenDecimals: tokenDecimalsForPool };
  }, [allPoolData, getPoolTokenDecimals, poolOptions]);

  const getChartPreloadTarget = useCallback((
    poolIndex: number,
    anchor?: { price: number | null; tokenDecimals: number },
  ): ChartPreloadTarget | null => {
    const pool = poolOptions[poolIndex];
    if (!pool) return null;

    const chartAnchor = anchor ?? getChartAnchorForPool(poolIndex);
    const poolData = allPoolData[poolIndex];
    const chartToken0 = (nusdAddress || NUSD_ADDRESS).toLowerCase();
    const chartToken1 = (
      poolData
        ? poolData[0].toLowerCase() === chartToken0
          ? poolData[1]
          : poolData[0]
        : pool.token
    ).toLowerCase();

    return {
      pairId: pool.pairId,
      chartAnchor,
      chartLabel: `${getPoolTokenSymbol(poolIndex)} / NUSD`,
      chartToken0,
      chartToken1,
      chartToken1Decimals: chartAnchor.tokenDecimals || getPoolTokenDecimals(poolIndex),
    };
  }, [
    allPoolData,
    getChartAnchorForPool,
    getPoolTokenDecimals,
    getPoolTokenSymbol,
    nusdAddress,
    poolOptions,
  ]);

  const preloadChartCandles = useCallback(async (
    target: ChartPreloadTarget,
    options: { force?: boolean; onTimeframeDone?: () => void } = {},
  ) => {
    await Promise.allSettled(
      CHART_PRELOAD_TIMEFRAMES.map(async (tf) => {
        try {
          const queryOptions = {
            queryKey: getCandlesQueryKey(
              target.pairId,
              target.chartToken0,
              target.chartToken1,
              tf,
              18,
              target.chartToken1Decimals,
            ),
            queryFn: () => fetchCandlesRequest({
              token0: target.chartToken0,
              token1: target.chartToken1,
              intervalMinutes: tf,
              subgraphUrl: "/api/candles",
              token0Decimals: 18,
              token1Decimals: target.chartToken1Decimals,
            }),
            staleTime: tf <= 1 ? 2_500 : tf <= 15 ? 10_000 : tf <= 60 ? 20_000 : 45_000,
          };

          if (options.force) {
            await queryClient.fetchQuery(queryOptions);
          } else {
            await queryClient.prefetchQuery(queryOptions);
          }
        } finally {
          options.onTimeframeDone?.();
        }
      }),
    );
  }, [queryClient]);

  const openChartForPool = useCallback(async (
    poolIndex: number,
    anchor?: { price: number | null; tokenDecimals: number },
    timeframe: ChartTf = selectedChartTimeframe,
    updateUrl = true,
  ) => {
    const pool = poolOptions[poolIndex];
    if (!pool) return;

    const preloadSeq = chartPreloadSeqRef.current + 1;
    chartPreloadSeqRef.current = preloadSeq;
    const target = getChartPreloadTarget(poolIndex, anchor);
    if (!target) return;

    setShowChart(false);
    setChartPreloadLabel(target.chartLabel);
    setChartPreloadProgress(0);

    let completed = 0;
    const markDone = () => {
      completed += 1;
      if (chartPreloadSeqRef.current === preloadSeq) {
        setChartPreloadProgress(completed);
      }
    };

    await Promise.allSettled([
      loadChartWindow(),
      preloadChartCandles(target, { force: true, onTimeframeDone: markDone }),
    ]);

    if (chartPreloadSeqRef.current !== preloadSeq) return;

    setSelectedChartPair(pool.pairId);
    setSelectedChartAnchor(target.chartAnchor);
    setSelectedChartTimeframe(timeframe);
    setShowChart(true);
    setChartPreloadLabel(null);
    if (updateUrl) clearDexPairUrl();
  }, [
    clearDexPairUrl,
    getChartPreloadTarget,
    poolOptions,
    preloadChartCandles,
    selectedChartTimeframe,
  ]);

  useEffect(() => {
    if (routePairAppliedRef.current || !poolOptions.length || typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const pairParam = params.get("pair")?.toLowerCase();
    if (!pairParam) return;

    const poolIndex = poolOptions.findIndex(pool => pool.pairId.toLowerCase() === pairParam);
    if (poolIndex < 0) return;

    routePairAppliedRef.current = true;
    const view = params.get("view");
    const timeframe = parseChartTimeframe(params.get("tf"));
    selectPoolForSwap(poolIndex, false);
    if (view === "chart") {
      openChartForPool(poolIndex, undefined, timeframe, false);
    }
  }, [openChartForPool, poolOptions, selectPoolForSwap]);

  // Sort pools based on filter
  const sortedPoolIndices = useMemo(() => {
    const indices = poolOptions.map((_, i) => i);
    return indices.sort((a, b) => {
      const dataA = allPoolData[a];
      const dataB = allPoolData[b];
      if (!dataA) return 1;
      if (!dataB) return -1;
      
      switch (pairFilter) {
        case "tvl":
          // Use NUSD reserve as TVL proxy (all pools are paired with NUSD)
          return Number(dataB[3]) - Number(dataA[3]);
        case "vol24h":
          return Number(dataB[5]) - Number(dataA[5]); // volume24h (index 5)
        case "volAll":
          return Number(dataB[6]) - Number(dataA[6]); // totalVolume (index 6)
        case "new":
          return b - a; // newest first by index
        default:
          return 0;
      }
    });
  }, [poolOptions, allPoolData, pairFilter]);

  useEffect(() => {
    if (typeof window === "undefined" || !poolOptions.length || !allPoolData.length) return;

    let cancelled = false;
    const warmVisibleCharts = async () => {
      await loadChartWindow();

      const targets = sortedPoolIndices
        .slice(0, CHART_WARM_POOL_LIMIT)
        .map((poolIndex) => ({ poolIndex, target: getChartPreloadTarget(poolIndex) }))
        .filter((item): item is { poolIndex: number; target: ChartPreloadTarget } => !!item.target);

      for (const { target } of targets) {
        if (cancelled) return;
        const warmKey = `${target.pairId}:${target.chartToken0}:${target.chartToken1}:${target.chartToken1Decimals}`;
        if (chartWarmCacheRef.current.has(warmKey)) continue;

        chartWarmCacheRef.current.add(warmKey);
        await preloadChartCandles(target);
      }
    };

    const win = window as typeof window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };

    if (win.requestIdleCallback) {
      const handle = win.requestIdleCallback(() => {
        void warmVisibleCharts();
      }, { timeout: 3500 });
      return () => {
        cancelled = true;
        win.cancelIdleCallback?.(handle);
      };
    }

    const handle = window.setTimeout(() => {
      void warmVisibleCharts();
    }, 1800);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [
    allPoolData,
    getChartPreloadTarget,
    poolOptions.length,
    preloadChartCandles,
    sortedPoolIndices,
  ]);

  // Check if selected pool is Base Pool (contains NUSD) - only Base Pools can farm
  const isSelectedBasePool = useMemo(() => {
    if (poolOptions.length <= selectedFarmPool) return true;
    const pd = allPoolData[selectedFarmPool];
    if (!pd) return true;
    const token0 = pd[0];
    return token0 === nusdAddress || pd[1] === nusdAddress;
  }, [poolOptions, selectedFarmPool, allPoolData, nusdAddress]);

  // Get pool data
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    swapTokenIn && swapTokenOut ? [swapTokenIn.address, swapTokenOut.address] : undefined
  );
  const { data: poolData } = useDexRead("pools", pairId ? [pairId] : undefined);

  // Farm LP queries - use selectedFarmPool index
  const farmPairId = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.pairId : undefined;
  const farmPoolToken = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.token : undefined;
  const { data: farmLPData, refetch: refetchFarmLP } = useDexRead<bigint>("userLP",
    farmPairId && address ? [farmPairId, address as `0x${string}`] : undefined
  );
  const { data: farmPendingReward, refetch: refetchPendingReward } = useRewardRead<bigint>("getUserPendingReward",
    address ? [address as `0x${string}`] : undefined
  );
  
  // Farm token allowance
  const { data: farmTokenAllowance, refetch: refetchFarmAllowance } = useReadContract({
    address: farmPoolToken && farmPoolToken !== NATIVE_ADDRESS ? farmPoolToken : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: farmPoolToken && farmPoolToken !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: { enabled: !!address && !!farmPoolToken && farmPoolToken !== NATIVE_ADDRESS }
  });

  // Update farm state when data changes
  useEffect(() => { setFarmUserLP(farmLPData as bigint | undefined); }, [farmLPData]);
  useEffect(() => { setFarmPending(farmPendingReward as bigint | undefined); }, [farmPendingReward]);

  // Balances
  const { data: balanceIn } = useTokenBalance(address, swapTokenIn);
  const { data: balanceOut } = useTokenBalance(address, swapTokenOut);
  const { data: balancePoolToken } = useTokenBalance(address, poolToken);
  const { data: balanceNUSD } = useTokenBalance(address, KNOWN_TOKENS[1]);

  // Real-time block updates for auto-refresh
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { refetch: refetchPool } = useDexRead("pools", pairId ? [pairId] : undefined);

  // Allowances - use useReadContract directly for better reliability
  const { data: allowanceIn, refetch: refetchAllowanceIn, isError: allowanceInError } = useReadContract({
    address: swapTokenIn?.address !== NATIVE_ADDRESS ? swapTokenIn?.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: swapTokenIn?.address !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: {
      enabled: !!address && !!swapTokenIn && swapTokenIn.address !== NATIVE_ADDRESS,
    },
  });
  const { data: allowancePoolToken, refetch: refetchAllowancePool, isError: allowancePoolError } = useReadContract({
    address: poolToken?.address !== NATIVE_ADDRESS ? poolToken?.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: poolToken?.address !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: {
      enabled: !!address && !!poolToken && poolToken.address !== NATIVE_ADDRESS,
    },
  });

  // Live swap fee from contract — defaults to 10 (0.1%) until first read returns.
  const { data: swapFeeBps } = useDexRead<bigint>("swapFee");

  // Calculate swap output from the latest pool cache; the submit path refreshes once more.
  useEffect(() => {
    const amountIn = safeParseUnits(swapAmountIn, swapTokenIn.decimals);
    if (!poolData || !amountIn || amountIn === 0n) {
      setSwapAmountOut("");
      return;
    }
    const pd = poolData as PoolDataTuple;
    const { amountOut } = quoteSwapFromPool(amountIn, pd, swapTokenIn.address, swapFeeBps ?? 10n);
    setSwapAmountOut(Number(formatUnits(amountOut, swapTokenOut?.decimals || 18)).toFixed(6));
  }, [swapAmountIn, poolData, swapTokenIn, swapTokenOut, swapFeeBps]);

  useEffect(() => {
    if (!swapAmountIn || !pairId || !refetchPool) return;
    const intervalId = window.setInterval(() => {
      void refetchPool();
    }, SWAP_PRICE_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [pairId, refetchPool, swapAmountIn]);

  // Auto-refetch when new block arrives
  useEffect(() => {
    if (blockNumber) {
      refetchAllowanceIn?.();
      refetchAllowancePool?.();
      refetchPool?.();
      refetchPool0?.();
      refetchPool1?.();
      refetchPool2?.();
      refetchPool3?.();
      refetchPool4?.();
      refetchPool5?.();
      refetchPool6?.();
      refetchPool7?.();
      refetchAllPools?.();
      refetchFarmLP?.();
      refetchPendingReward?.();
      refetchFarmAllowance?.();
      refetchAllowance?.();
    }
  }, [
    blockNumber,
    refetchAllowanceIn,
    refetchAllowancePool,
    refetchPool,
    refetchPool0,
    refetchPool1,
    refetchPool2,
    refetchPool3,
    refetchPool4,
    refetchPool5,
    refetchPool6,
    refetchPool7,
    refetchAllPools,
    refetchFarmLP,
    refetchPendingReward,
    refetchFarmAllowance,
    refetchAllowance,
  ]);

  useEffect(() => { setMounted(true); }, []);

  const handleSwapApprove = () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!ensureCorrectChain()) return;
    if (!swapTokenIn) return;

    const isNUSD = swapTokenIn.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;
    const tokenAddr = swapTokenIn.address as `0x${string}`;

    toast.info("Approving", `Please approve ${swapTokenIn.symbol}...`);

    try {
      writeContract({
        address: tokenAddr,
        abi,
        functionName: "approve",
        args: [DEX_ADDRESS as `0x${string}`, maxUint256],
      });
    } catch (err) {
      console.error("Approve error:", err);
      toast.error("Error", "Failed to send approval transaction");
    }
  };

  const handleFixedSwap = async () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!swapAmountIn || !poolData || !swapTokenOut || !pairId || !address || !publicClient) return;
    if (isSwapSubmitting) return;
    if (swapTokenIn.address !== NATIVE_ADDRESS && needsSwapApproval) {
      toast.error("Approval required", `Please approve ${swapTokenIn.symbol} first`);
      return;
    }
    const amountIn = safeParseUnits(swapAmountIn, swapTokenIn.decimals);
    if (!amountIn) {
      toast.error("Invalid amount", "Enter a normal decimal number, for example 0.1 or 10000");
      return;
    }
    setIsSwapSubmitting(true);
    try {
      toast.info("Refreshing price", "Checking the latest pool reserves...");
      const freshPool = await publicClient.readContract({
        address: DEX_ADDRESS as `0x${string}`,
        abi: DEX_ABI,
        functionName: "pools",
        args: [pairId],
      }) as PoolDataTuple;

      const quote = quoteSwapFromPool(amountIn, freshPool, swapTokenIn.address, swapFeeBps ?? 10n);
      if (quote.amountOut <= 0n) {
        toast.error("No output", "Pool liquidity changed. Please try again.");
        return;
      }

      const minOut = minOutWithSlippage(quote.amountOut);
      setSwapAmountOut(Number(formatUnits(quote.amountOut, swapTokenOut.decimals)).toFixed(6));

      await publicClient.simulateContract({
        account: address,
        address: DEX_ADDRESS as `0x${string}`,
        abi: DEX_ABI,
        functionName: "swap",
        args: [swapTokenIn.address, swapTokenOut.address, amountIn, minOut],
        value: swapTokenIn.address === NATIVE_ADDRESS ? amountIn : undefined,
      });

      await writeContractAsync({
        address: DEX_ADDRESS as `0x${string}`,
        abi: DEX_ABI,
        functionName: "swap",
        args: [swapTokenIn.address, swapTokenOut.address, amountIn, minOut],
        value: swapTokenIn.address === NATIVE_ADDRESS ? amountIn : undefined,
      });

      toast.info(
        "Swapping",
        `Live quote refreshed. Min out: ${formatTokenAmount(minOut, swapTokenOut.decimals)} ${swapTokenOut.symbol}`,
      );
      void refetchPool?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Swap failed";
      toast.error("Swap blocked", message.includes("Slippage")
        ? "Price moved too fast. Try again with the refreshed quote."
        : "Transaction could not be simulated with the current pool price.");
    } finally {
      setIsSwapSubmitting(false);
    }
  };

  const handleAddLiquidity = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!poolToken || !poolAmountToken || !poolAmountNUSD) return;
    const amountToken = safeParseUnits(poolAmountToken, poolToken.decimals);
    const amountNUSD = safeParseUnits(poolAmountNUSD, 18);
    if (!amountToken || !amountNUSD) {
      toast.error("Invalid amount", "Enter a normal decimal number, for example 0.1 or 10000");
      return;
    }
    if (poolToken.address !== NATIVE_ADDRESS && (!allowancePoolToken || allowancePoolToken < amountToken)) {
      toast.error("Approval required", `Please approve ${poolToken.symbol} first`);
      return;
    }
    addLiquidity(poolToken.address, nusdAddress!, amountToken, amountNUSD);
    toast.info("Adding liquidity", "Please confirm transaction...");
  };

  // Farm handlers - Add Liquidity to farm
  const handleFarmAdd = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!farmNUSDAmount || !farmPairId) return;
    if (!farmPoolToken) return;
    
    const amountNUSD = safeParseUnits(farmNUSDAmount, 18);
    if (!amountNUSD) {
      toast.error("Invalid amount", "Enter a normal decimal number, for example 10000");
      return;
    }
    const pd = allPoolData[selectedFarmPool];
    
    if (!pd) return;
    
    // Calculate token amount based on pool ratio
    const reserve0 = pd[2];
    const reserve1 = pd[3];
    const totalLP = pd[4];
    
    // Calculate how much token needed for the NUSD amount
    let tokenAmount: bigint;
    if (totalLP === 0n) {
      // New pool - use 1:1 ratio
      tokenAmount = amountNUSD;
    } else {
      // Existing pool - use ratio from reserves
      if (nusdAddress === pd[0]) {
        // NUSD is token0
        tokenAmount = reserve1 > 0 ? (amountNUSD * reserve1) / reserve0 : amountNUSD;
      } else {
        // NUSD is token1
        tokenAmount = reserve0 > 0 ? (amountNUSD * reserve0) / reserve1 : amountNUSD;
      }
    }
    
    // Check approval for non-native tokens
    if (farmPoolToken !== NATIVE_ADDRESS) {
      if (!farmTokenAllowance || (farmTokenAllowance as bigint) < tokenAmount) {
        toast.error("Approval required", `Please click "Approve ${(tokenSymbols[selectedFarmPool] as string) || "Token"}\" first`);
        return;
      }
    }
    
    addLiquidity(farmPoolToken, nusdAddress!, tokenAmount, amountNUSD);
    toast.info("Adding Liquidity", "Please confirm transaction to farm...");
  };

  const handleFarmRemove = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!farmLpAmount || !farmPairId || !farmUserLP) return;
    const amount = safeParseUnits(farmLpAmount, 18);
    if (!amount) {
      toast.error("Invalid amount", "Enter a valid LP amount");
      return;
    }
    if (amount <= 0n) {
      toast.error("Invalid amount", "LP amount must be greater than 0");
      return;
    }
    if (amount > farmUserLP) {
      toast.error("Insufficient LP", `You only have ${formatNum(farmUserLP)} LP`);
      return;
    }
    removeLiquidity(farmPairId, amount);
    toast.info("Removing Liquidity", "Please confirm transaction...");
  };

  const handleClaim = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    claimReward();
    toast.info("Claiming reward", "Please confirm transaction...");
  };

  // Auto-switch to LitVM helper
  const ensureCorrectChain = () => {
    if (isConnected && chainId && chainId !== LITVM_CHAIN_ID) {
      toast.info("Wrong Network", "Switching to LitVM...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
      return false;
    }
    return true;
  };

  const handleApprove = (token: Token) => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!ensureCorrectChain()) return;

    const isNUSD = token.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${token.symbol || "Token"}...`);
    writeContract({
      address: token.address as `0x${string}`,
      abi,
      functionName: "approve",
      args: [DEX_ADDRESS as `0x${string}`, maxUint256],
    });
  };

  const handleApproveCustomToken = () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!createTokenA) return;

    const isNUSD = createTokenA.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${tokenSymbol || "Token"}...`);
    writeContract({
      address: createTokenA as `0x${string}`,
      abi,
      functionName: "approve",
      args: [DEX_ADDRESS as `0x${string}`, maxUint256],
    }, {
      onSuccess: () => {
        setTimeout(() => {
          refetchAllowance?.();
          refetchAllowanceIn?.();
          refetchAllowancePool?.();
          refetchFarmAllowance?.();
        }, 2000);
      }
    });
  };

  // Anyone can create a pool by adding initial liquidity to a new pair
  const handleCreatePool = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!createTokenA || !createAmountA || !createAmountB) return;

    const tokenA = createTokenA.trim() as `0x${string}`;
    const tokenB = nusdAddress!;
    const amountA = createAmountAParsed;
    const amountB = createAmountBParsed;
    if (!amountA || !amountB) {
      toast.error("Invalid amount", "Enter normal decimals like 0.1 and 10000, not 1e+35");
      return;
    }
    
    // Check approval for tokenA
    if (tokenA !== NATIVE_ADDRESS && needsCreateApproval) {
      toast.error("Approval required", `Please approve ${tokenSymbol || "token"} first`);
      return;
    }
    
    // Use addLiquidity to create pool (creates pool + adds liquidity in one tx)
    addLiquidity(tokenA, tokenB, amountA, amountB);
    toast.info("Creating Pool", "Please confirm transaction...");
  };

  const needsSwapApproval = swapTokenIn && swapTokenIn.address !== NATIVE_ADDRESS && !allowanceInError && allowanceIn !== undefined && allowanceIn === 0n;
  const needsPoolApproval = poolToken && poolToken.address !== NATIVE_ADDRESS && !allowancePoolError && allowancePoolToken !== undefined && allowancePoolToken === 0n;

  if (!mounted) return <PageLoader />;

  return (
    <>
      <style>{shimmerStyle}</style>
      <div className="dex-page min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="w-full mx-auto px-4 sm:px-6 xl:px-8 py-2 sm:py-3 max-w-[100rem] flex items-center justify-between gap-2">
          <Link href="/" className="flex items-center">
            <span className="text-white font-bold" style={{ fontFamily: "var(--font-departure)" }}>0xDex</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs text-[#64748B] hidden sm:block">LitVM LiteForge</div>
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
              >
                {address.slice(0, 6)}...{address.slice(-4)}
              </button>
            ) : (
              <button
                onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
              >
                CONNECT
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="w-full mx-auto px-4 sm:px-6 xl:px-8 py-6 max-w-[100rem]">
        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-2 2xl:grid-cols-4 gap-3 md:gap-4 mb-4 md:mb-6">
          {stats.loading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <StatCard label="TVL" value={formatUSD(stats.totalNUSDLocked)} icon="◫" />
              <StatCard label="Total Volume" value={formatUSD(totalVolume)} icon="◈" />
              <StatCard label="Pools" value={String(allPools?.length || 0)} icon="◫" />
              <StatCard label="Total Reward Pool" value={rewardPoolNusdBalance ? formatUSD(rewardPoolNusdBalance as bigint) : "$0.00"} icon="✦" color="amber" />
            </>
          )}
        </div>

        {/* Tabs */}
        <div className="grid grid-cols-3 gap-2 mb-4 md:mb-6">
          <button
            onClick={() => setActiveTab("swap")}
            className={`py-2 sm:py-3 font-bold text-xs sm:text-sm transition-all pixel-btn-soft ${
              activeTab === "swap" ? "pixel-btn-soft-indigo" : "pixel-btn-soft-secondary"
            }`}
          >
            SWAP
          </button>
          <button
            onClick={() => setActiveTab("create")}
            className={`py-2 sm:py-3 font-bold text-xs sm:text-sm transition-all pixel-btn-soft ${
              activeTab === "create" ? "pixel-btn-soft-rose" : "pixel-btn-soft-secondary"
            }`}
          >
            CREATE POOL
          </button>
          <Link
            href="/0xfactory"
            className="py-2 sm:py-3 font-bold text-xs sm:text-sm transition-all pixel-btn-soft pixel-btn-soft-secondary text-center"
          >
            CREATE TOKEN
          </Link>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6">
          {/* Left Panel - Swap */}
          <div className="bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5 xl:p-6">
            {activeTab === "swap" && (
              <>
                <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>Swap</h2>

                {/* From */}
                <div className="mb-2">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">From</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceIn ? Number(formatUnits(balanceIn as bigint, swapTokenIn.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="bg-[#13131F] rounded-xl border border-[#2D2D44] p-4">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={swapAmountIn}
                      onChange={(e) => setSwapAmountIn(normalizeDecimalInput(e.target.value))}
                      placeholder="0.0"
                      className="w-full bg-transparent text-xl sm:text-2xl xl:text-3xl font-bold text-white outline-none"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <div className="mt-2 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {swapTokenIn.logo && (
                          <Image src={swapTokenIn.logo} alt={swapTokenIn.symbol} width={20} height={20} className="rounded-full" />
                        )}
                        <span className="font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
                          {swapTokenIn.symbol}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Swap Button */}
                <div className="flex justify-center -my-2 relative z-10">
                  <button
                    onClick={() => {
                      const temp = swapTokenIn;
                      if (swapTokenOut) {
                        setSwapTokenIn(swapTokenOut);
                        setSwapTokenOut(temp);
                        setSwapAmountIn(swapAmountOut || "");
                        setSwapAmountOut("");
                      }
                    }}
                    style={{
                      width: 36,
                      height: 36,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      color: '#050505',
                      background: '#f2f2f2',
                      border: '1px solid rgba(255,255,255,0.72)',
                      cursor: 'pointer',
                      clipPath: 'polygon(0 3px, 3px 3px, 3px 0, calc(100% - 3px) 0, calc(100% - 3px) 3px, 100% 3px, 100% calc(100% - 3px), calc(100% - 3px) calc(100% - 3px), calc(100% - 3px) 100%, 3px 100%, 3px calc(100% - 3px), 0 calc(100% - 3px))',
                      boxShadow: '3px 3px 0 0 #000',
                      transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                      fontFamily: 'var(--font-departure)',
                    }}
                    onMouseEnter={e => {
                      (e.target as HTMLElement).style.background = '#ffffff';
                      (e.target as HTMLElement).style.boxShadow = '4px 4px 0 0 #000';
                    }}
                    onMouseLeave={e => {
                      (e.target as HTMLElement).style.background = '#f2f2f2';
                      (e.target as HTMLElement).style.boxShadow = '3px 3px 0 0 #000';
                    }}
                  >
                    ⇅
                  </button>
                </div>

                {/* To */}
                <div className="mb-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">To</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceOut && swapTokenOut ? Number(formatUnits(balanceOut as bigint, swapTokenOut.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="bg-[#13131F] rounded-xl border border-[#2D2D44] p-4">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={swapAmountOut}
                      readOnly
                      placeholder="0.0"
                      className="w-full bg-transparent text-xl sm:text-2xl xl:text-3xl font-bold text-white outline-none"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <div className="mt-2 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {swapTokenOut && swapTokenOut.logo && (
                          <Image src={swapTokenOut.logo} alt={swapTokenOut.symbol} width={20} height={20} className="rounded-full" />
                        )}
                        <span className="font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
                          {swapTokenOut?.symbol}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pool & Slippage Info */}
                {poolData && swapAmountOut && swapTokenOut && (
                  <div className="mb-4 p-3 rounded-xl bg-[#13131F]/80 border border-[#2D2D44] text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Pool</span>
                      <span className="text-[#8888ff] font-bold">{swapTokenIn.symbol} → {swapTokenOut.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Rate</span>
                      {(() => {
                        const pd = poolData as PoolDataTuple;
                        const pool = castPoolData(pd);
                        if (!pool) return <span className="text-white">-</span>;
                        const rate = humanRate(
                          swapTokenIn.address,
                          pool,
                          swapTokenIn.decimals,
                          swapTokenOut.decimals
                        );
                        return (
                          <span className="text-white">
                            1 {swapTokenIn.symbol} ≈ {rate.toFixed(6)} {swapTokenOut.symbol}
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Price Impact</span>
                      {(() => {
                        const amountInWei = safeParseUnits(swapAmountIn || "0", swapTokenIn.decimals);
                        if (!amountInWei) return <span className="text-white">-</span>;
                        const pd = poolData as PoolDataTuple;
                        const t0 = pd[0];
                        const r0 = pd[2];
                        const r1 = pd[3];
                        const reserveIn = swapTokenIn.address === t0 ? r0 : r1;
                        const priceImpact = reserveIn > 0n ? (Number(amountInWei) / Number(reserveIn) * 100) : 0;
                        return (
                          <span className={priceImpact > 5 ? "text-red-400" : "text-emerald-400"}>
                            {priceImpact.toFixed(2)}%
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Slippage</span>
                      <span className="text-white">{Number(SWAP_SLIPPAGE_BPS) / 100}% live quote</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Fee</span>
                      <span className="text-white">
                        {swapFeeBps !== undefined ? `${Number(swapFeeBps) / 100}%` : "0.1%"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Approval */}
                {needsSwapApproval && (
                  <button onClick={handleSwapApprove} className="w-full mb-3 pixel-btn-soft pixel-btn-soft-amber">
                    APPROVE {swapTokenIn.symbol}
                  </button>
                )}

                {/* Button */}
                <button
                  onClick={handleFixedSwap}
                  disabled={isSwapSubmitting || !swapAmountIn || !poolData || !swapTokenIn || needsSwapApproval}
                  className={`w-full py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                    needsSwapApproval ? "pixel-btn-soft-secondary" : "pixel-btn-soft-indigo"
                  }`}
                >
                  {!isConnected ? "CONNECT WALLET" : isSwapSubmitting ? "REFRESHING PRICE..." : !swapAmountIn ? "ENTER AMOUNT" : !poolData ? "NO POOL FOUND" : needsSwapApproval ? `APPROVE ${swapTokenIn.symbol}` : "SWAP"}
                </button>
              </>
            )}

            {activeTab === "pools" && (
              <>
                <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>Add Liquidity</h2>

                {/* Pool Price */}
                {poolData && (
                  <div className="mb-4 p-3 rounded-lg bg-[#13131F]/50 border border-[#2D2D44] text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">1 NUSD =</span>
                      <span className="text-emerald-400 font-bold">
                        ${poolData ? (Number(formatUnits((poolData as PoolDataTuple)[2], 18)) / Number(formatUnits((poolData as PoolDataTuple)[3], poolToken.decimals))).toFixed(6) : "0"} {poolToken.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[#64748B]">1 {poolToken.symbol} =</span>
                      <span className="text-[#8888ff] font-bold">
                        ${poolData ? (Number(formatUnits((poolData as PoolDataTuple)[3], poolToken.decimals)) / Number(formatUnits((poolData as PoolDataTuple)[2], 18))).toFixed(6) : "0"} NUSD
                      </span>
                    </div>
                  </div>
                )}

                {/* Pool Token */}
                <div className="mb-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Token / NUSD</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balancePoolToken ? Number(formatUnits(balancePoolToken as bigint, poolToken.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={poolAmountToken}
                      onChange={(e) => setPoolAmountToken(normalizeDecimalInput(e.target.value))}
                      placeholder="0.0"
                      className="flex-1 bg-[#13131F] p-3 rounded-lg text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-emerald-500"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <select
                      value={poolToken.address}
                      onChange={(e) => setPoolToken(KNOWN_TOKENS.find(t => t.address === e.target.value)!)}
                      className="bg-[#13131F] p-3 rounded-lg text-white border border-[#2D2D44] outline-none"
                    >
                      {KNOWN_TOKENS.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                    </select>
                  </div>
                </div>

                {/* NUSD */}
                <div className="mb-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">NUSD</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceNUSD ? Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={poolAmountNUSD}
                    onChange={(e) => setPoolAmountNUSD(normalizeDecimalInput(e.target.value))}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] p-3 rounded-lg text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-emerald-500"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                </div>

                {/* Approval */}
                {needsPoolApproval && (
                  <button onClick={() => handleApprove(poolToken)} className="w-full mb-3 pixel-btn-soft pixel-btn-soft-amber">
                    APPROVE {poolToken.symbol}
                  </button>
                )}

                {/* Button */}
                <button
                  onClick={handleAddLiquidity}
                  disabled={!poolAmountToken || !poolAmountNUSD || needsPoolApproval}
                  className={`w-full py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                    needsPoolApproval ? "pixel-btn-soft-secondary" : "pixel-btn-soft-emerald"
                  }`}
                >
                  {!isConnected ? "CONNECT WALLET" : !poolAmountToken || !poolAmountNUSD ? "ENTER AMOUNTS" : "ADD LIQUIDITY"}
                </button>
              </>
            )}

            {activeTab === "create" && (
              <>
                <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "var(--font-departure)" }}>Create New Pool</h2>

                {/* Pool Token Address */}
                <div className="mb-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Token Address</span>
                    {createTokenBalance !== undefined && (
                      <span className="text-xs text-[#64748B]">
                        Balance: {tokenDecimals && createTokenBalance ? Number(formatUnits(createTokenBalance as bigint, tokenDecimals)).toFixed(4) : Number(createTokenBalance || 0n).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={createTokenA}
                    onChange={(e) => setCreateTokenA(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-[#13131F] p-3 rounded-lg text-sm font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {tokenName && (
                    <div className="mt-1 text-xs text-emerald-400">
                      {tokenName as string} ({tokenSymbol as string})
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5 px-1">
                    <span className="text-xs text-[#64748B]">Token Amount</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={createAmountA}
                    onChange={(e) => setCreateAmountA(normalizeDecimalInput(e.target.value))}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] px-4 py-3 rounded-lg text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {createTokenBalance !== undefined && (
                    <div className="flex gap-1 mt-1.5">
                      {[25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            const bal = tokenDecimals && createTokenBalance ? Number(formatUnits(createTokenBalance as bigint, tokenDecimals)) : 0;
                            setCreateAmountA(formatDecimalForInput(bal * pct / 100));
                          }}
                          className="flex-1 py-1 text-[10px] bg-[#2D2D44] hover:bg-rose-500/30 rounded text-[#64748B] hover:text-white transition-colors font-bold"
                          style={{ fontFamily: "var(--font-departure)" }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fixed NUSD */}
                <div className="mb-3 mt-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Pair With</span>
                    {balanceNUSD !== undefined && (
                      <span className="text-xs text-[#64748B]">
                        Balance: {Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4)}
                      </span>
                    )}
                  </div>
                  <div className="bg-[#13131F] p-3 rounded-lg text-sm font-bold text-white border border-[#2D2D44]">
                    $NUSD
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5 px-1">
                    <span className="text-xs text-[#64748B]">$NUSD Amount</span>
                  </div>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={createAmountB}
                    onChange={(e) => setCreateAmountB(normalizeDecimalInput(e.target.value))}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] px-4 py-3 rounded-lg text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {balanceNUSD !== undefined && (
                    <div className="flex gap-1 mt-1.5">
                      {[25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            const bal = Number(formatUnits(balanceNUSD as bigint, 18));
                            setCreateAmountB(formatDecimalForInput(bal * pct / 100));
                          }}
                          className="flex-1 py-1 text-[10px] bg-[#2D2D44] hover:bg-rose-500/30 rounded text-[#64748B] hover:text-white transition-colors font-bold"
                          style={{ fontFamily: "var(--font-departure)" }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Price Info */}
                {createAmountAParsed && createAmountBParsed && createAmountAParsed > 0n && createAmountBParsed > 0n && (
                  (() => {
                    const price = Number(formatUnits(createAmountBParsed, 18)) /
                      Number(formatUnits(createAmountAParsed, Number(tokenDecimals ?? 18)));
                    return (
                      <div className="mt-4 px-1 text-xs flex justify-between">
                        <span className="text-[#64748B]">Initial Price</span>
                        <span className="text-emerald-400 font-bold">
                          1 {(tokenSymbol as string) || "Token"} = {Number.isFinite(price) ? price.toFixed(6) : "-"} $NUSD
                        </span>
                      </div>
                    );
                  })()
                )}

                {/* Create Pool Button */}
                <button
                  onClick={needsCreateApproval ? handleApproveCustomToken : handleCreatePool}
                  disabled={!createTokenA || !createAmountA || !createAmountB}
                  className={`w-full mt-4 py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                    needsCreateApproval ? "pixel-btn-soft-amber" : "pixel-btn-soft-rose"
                  }`}
                >
                  {!isConnected ? "CONNECT WALLET" : !createTokenA ? "ENTER TOKEN ADDRESS" : !createAmountA || !createAmountB ? "ENTER AMOUNTS" : needsCreateApproval ? `APPROVE & CREATE POOL` : "CREATE POOL"}
                </button>
              </>
            )}
          </div>

          {/* Middle Panel - Top Pairs */}
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
              <h2 className="text-base sm:text-lg font-bold text-white shrink-0" style={{ fontFamily: "var(--font-departure)" }}>
                Top Pairs ({poolOptions.length})
              </h2>
              <div className="flex gap-1 bg-[#13131F] p-1 rounded-lg ml-auto">
                {(["tvl", "vol24h", "volAll", "new"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setPairFilter(filter)}
                    className={`px-2 py-1 text-xs font-bold transition-all pixel-btn-soft ${
                      pairFilter === filter
                        ? "pixel-btn-soft-indigo pixel-btn-soft-sm"
                        : "pixel-btn-soft-secondary pixel-btn-soft-sm"
                    }`}
                  >
                    {filter === "tvl" ? "TVL" : filter === "vol24h" ? "VOL 24H" : filter === "volAll" ? "VOL ALL" : "NEW"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3" ref={poolListRef}>
              {poolOptions.length > 0 ? (
                sortedPoolIndices.slice(0, 8).map((poolIndex) => {
                  const pool = poolOptions[poolIndex];
                  const pData = allPoolData[poolIndex];
                  const token0 = pData?.[0] as `0x${string}` | undefined;
                  const token1 = pData?.[1] as `0x${string}` | undefined;

                  if (!pData) return (
                    <PoolCardSkeleton key={poolIndex} />
                  );

                  return (
                    <PoolCard
                      key={poolIndex}
                      rank={sortedPoolIndices.indexOf(poolIndex) + 1}
                      token0={token0 || pool.token}
                      token1={token1 || pool.nusd}
                      reserve0={(pData[2] as bigint) || 0n}
                      reserve1={(pData[3] as bigint) || 0n}
                      volume24h={(pData[5] as bigint) || 0n}
                      totalVolume={(pData[6] as bigint) || 0n}
                      lpTotal={(pData[4] as bigint) || 0n}
                      pairId={pool.pairId}
                      swapHref="/0xdex"
                      chartHref="/0xdex"
                      tokenSymbol={getPoolTokenSymbol(poolIndex)}
                      tokenDecimals={getPoolTokenDecimals(poolIndex)}
                      onSelect={() => {
                        selectPoolForSwap(poolIndex);
                      }}
                      onViewChart={(chartAnchor) => {
                        openChartForPool(poolIndex, chartAnchor);
                      }}
                    />
                  );
                })
              ) : (
                <div className="p-8 text-center text-[#64748B]">
                  No pools available
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Farm */}
          <div>
            {/* Farm Panel */}
            <div className="bg-[#1A1A2E]/90 border border-amber-500/30 rounded-2xl p-5 xl:p-6">
              <h2 className="text-lg font-bold text-amber-400 mb-1" style={{ fontFamily: "var(--font-departure)" }}>
                Liquidity Mining
              </h2>
              <p className="text-xs text-[#64748B] mb-4">Add liquidity to Base Pools (with NUSD) to earn rewards</p>

              {isSelectedBasePool && (
                <div className="mb-4 p-3 bg-emerald-500/10 text-emerald-400 rounded-xl text-xs text-center" style={{ fontFamily: "var(--font-departure)" }}>
                  Supports Liquidity Mining rewards
                </div>
              )}

              {/* Warnings */}
              {!isSelectedBasePool && (
                <div className="mb-4 p-3 bg-blue-500/10 text-blue-400 rounded-xl text-xs" style={{ fontFamily: "var(--font-departure)" }}>
                  This pool is not a Base Pool - Cannot earn Liquidity Mining rewards
                </div>
              )}

              {/* Pool Selector */}
              <div className="mb-4">
                <span className="text-xs text-[#64748B] block mb-2" style={{ fontFamily: "var(--font-departure)" }}>Select Base Pool</span>
                <select
                  value={selectedFarmPool}
                  onChange={(e) => setSelectedFarmPool(parseInt(e.target.value))}
                  className="w-full bg-[#13131F] p-3 rounded-xl text-white border border-[#2D2D44] outline-none"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  {poolOptions.map((p, i) => (
                    <option key={i} value={i}>
                      {p.token === NATIVE_ADDRESS ? "zkLTC" : (tokenSymbols[i] as string) || `Pool ${i + 1}`}/NUSD
                    </option>
                  ))}
                </select>
              </div>

              {/* Farm Stats */}
              {allPoolData[selectedFarmPool] && (
                <div className="mb-4 p-3 rounded-xl bg-[#13131F]/50 border border-[#2D2D44] text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Your LP Shares</span>
                    <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>{farmUserLP ? formatNum(farmUserLP) : "0"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Total LP</span>
                    <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>{formatNum((allPoolData[selectedFarmPool]?.[4] as bigint) || 0n)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Pending Reward</span>
                    <span className="text-emerald-400 font-bold" style={{ fontFamily: "var(--font-departure)" }}>{farmPending ? formatUSD(farmPending) : "$0"}</span>
                  </div>
                </div>
              )}

              {/* NUSD Amount Input */}
              <div className="mb-3">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>NUSD Amount</span>
                  <button
                    onClick={() => balanceNUSD && setFarmNUSDAmount(Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4))}
                    className="text-xs text-amber-400"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    Balance: {balanceNUSD ? Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4) : "0"}
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={farmNUSDAmount}
                  onChange={(e) => setFarmNUSDAmount(normalizeDecimalInput(e.target.value))}
                  placeholder="0.0"
                  className="w-full bg-[#13131F] p-3 rounded-xl text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-amber-500"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
              </div>

              {/* Token Amount (auto-calculated) */}
              <div className="mb-4 p-3 rounded-xl bg-[#13131F]/50 border border-[#2D2D44] text-xs">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">{farmPoolToken === NATIVE_ADDRESS ? "zkLTC" : (tokenSymbols[selectedFarmPool] as string) || "Token"} Amount</span>
                  <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>
                    {farmNUSDAmount && allPoolData[selectedFarmPool] ? (
                      (() => {
                        const pd = allPoolData[selectedFarmPool];
                        const reserve0 = pd[2] as bigint;
                        const reserve1 = pd[3] as bigint;
                        const totalLP = pd[4] as bigint;
                        const amountNUSD = safeParseUnits(farmNUSDAmount, 18);
                        if (!amountNUSD) return "0.0000";
                        let tokenAmt: bigint;
                        if (totalLP === 0n) {
                          tokenAmt = amountNUSD;
                        } else {
                          if (nusdAddress === pd[0]) {
                            tokenAmt = reserve1 > 0n ? (amountNUSD * reserve1) / reserve0 : amountNUSD;
                          } else {
                            tokenAmt = reserve0 > 0n ? (amountNUSD * reserve0) / reserve1 : amountNUSD;
                          }
                        }
                        return `${Number(formatUnits(tokenAmt, 18)).toFixed(4)}`;
                      })()
                    ) : "0.0000"}
                  </span>
                </div>
              </div>

              {/* Check if approval needed for farm */}
              {farmPoolToken && farmPoolToken !== NATIVE_ADDRESS && (
                <div className="mb-4">
                  {(!farmTokenAllowance || (farmTokenAllowance as bigint) === 0n) ? (
                    <button
                      onClick={() => handleApprove({
                        address: farmPoolToken as `0x${string}`,
                        symbol: (tokenSymbols[selectedFarmPool] as string) || "TOKEN",
                        decimals: 18,
                        name: "Token"
                      })}
                      className="w-full py-3 pixel-btn-soft pixel-btn-soft-amber"
                    >
                      APPROVE {(tokenSymbols[selectedFarmPool] as string) || "TOKEN"}
                    </button>
                  ) : (
                    <div className="text-xs text-emerald-400 text-center p-2 rounded-xl bg-emerald-500/10" style={{ fontFamily: "var(--font-departure)" }}>
                      Token Approved ✓
                    </div>
                  )}
                </div>
              )}

              {/* Add/Remove Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleFarmAdd}
                  disabled={!isPositiveDecimal(farmNUSDAmount)}
                  className="flex-1 py-3 pixel-btn-soft pixel-btn-soft-emerald"
                >
                  ADD LIQUIDITY
                </button>
                <button
                  onClick={handleFarmRemove}
                  disabled={!farmUserLP || !isPositiveDecimal(farmLpAmount)}
                  className="flex-1 py-3 pixel-btn-soft pixel-btn-soft-amber"
                >
                  REMOVE LP
                </button>
              </div>
              
              {/* LP Amount for removal */}
              <div className="mt-3 mb-3">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>LP to Remove</span>
                  <button
                    onClick={() => farmUserLP && setFarmLpAmount(Number(formatUnits(farmUserLP, 18)).toFixed(4))}
                    className="text-xs text-amber-400"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    Max: {farmUserLP ? formatNum(farmUserLP) : "0"}
                  </button>
                </div>
                <input
                  type="text"
                  inputMode="decimal"
                  value={farmLpAmount}
                  onChange={(e) => setFarmLpAmount(normalizeDecimalInput(e.target.value))}
                  placeholder="0.0"
                  className="w-full bg-[#13131F] p-3 rounded-xl text-base md:text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-amber-500"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
              </div>

              {/* Claim Button - Compact */}
              <button
                onClick={handleClaim}
                disabled={!farmPending || farmPending === 0n}
                className="w-full py-3 pixel-btn-soft pixel-btn-soft-amber"
              >
                CLAIM REWARD
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 md:mt-6">
          <SwapHistoryPanel
            swaps={swapHistory}
            loading={swapHistoryLoading}
            totalCount={swapHistoryTotalCount}
            tokenMetaByAddress={tokenMetaByAddress}
          />
        </div>

      </main>

      {chartPreloadLabel && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 backdrop-blur-sm">
          <div className="border border-white/25 bg-black px-6 py-5 text-center shadow-[6px_6px_0_#000]" style={{ fontFamily: "var(--font-departure)" }}>
            <div className="mb-3 text-sm text-white">LOADING CHART</div>
            <div className="mb-4 text-[10px] text-white/65">{chartPreloadLabel}</div>
            <div className="mx-auto mb-3 flex w-52 gap-1">
              {CHART_PRELOAD_TIMEFRAMES.map((tf, index) => (
                <div
                  key={tf}
                  className={`h-3 flex-1 border border-white/20 ${index < chartPreloadProgress ? "bg-white" : "bg-white/10"}`}
                />
              ))}
            </div>
            <div className="text-[9px] text-white/55">
              {chartPreloadProgress}/{CHART_PRELOAD_TIMEFRAMES.length} TIMEFRAMES
            </div>
          </div>
        </div>
      )}

      {/* ── Chart Window ── */}
      {showChart && selectedChartPair && (() => {
        const poolIdx = poolOptions.findIndex(p => p.pairId === selectedChartPair);
        const sel = poolOptions[poolIdx];
        const label = sel?.token === NATIVE_ADDRESS ? 'zkLTC' : (tokenSymbols[poolIdx] as string) || '--';
        const selectedTokenDecimals = selectedChartAnchor?.tokenDecimals
          ?? (sel?.token === NATIVE_ADDRESS ? 18 : Number(tokenDecimalsList[poolIdx] ?? 18));
        const selectedPoolData = allPoolData[poolIdx];
        const selectedToken0 = selectedPoolData?.[0]?.toLowerCase();
        const selectedToken1 = selectedPoolData?.[1]?.toLowerCase();
        const chartToken1 =
          selectedPoolData && nusdAddress
            ? selectedToken0 === nusdAddress.toLowerCase()
              ? selectedPoolData[1]
              : selectedPoolData[0]
            : sel?.token || "";
        const selectedReserve0 = selectedPoolData?.[2] ?? 0n;
        const selectedReserve1 = selectedPoolData?.[3] ?? 0n;
        const currentPoolChartPrice =
          sel && nusdAddress && selectedToken0 && selectedToken1 && selectedReserve0 > 0n && selectedReserve1 > 0n
            ? selectedToken0 === nusdAddress.toLowerCase()
              ? Number(formatUnits(selectedReserve0, 18)) / Number(formatUnits(selectedReserve1, selectedTokenDecimals))
              : Number(formatUnits(selectedReserve1, 18)) / Number(formatUnits(selectedReserve0, selectedTokenDecimals))
            : null;
        const initialChartPrice = currentPoolChartPrice ?? selectedChartAnchor?.price ?? null;
        return (
          <ChartWindow
            key={selectedChartPair}
            pairId={selectedChartPair}
            token0={nusdAddress || ""}
            token1={chartToken1}
            pairLabel={`${label} / NUSD`}
            subgraphUrl="/api/subgraph"
            initialPrice={initialChartPrice}
            token0Decimals={18}
            token1Decimals={selectedTokenDecimals}
            initialTimeframe={selectedChartTimeframe}
            onTimeframeChange={(timeframe) => {
              setSelectedChartTimeframe(timeframe);
            }}
            onClose={() => {
              setShowChart(false);
              setSelectedChartPair(null);
              setSelectedChartAnchor(null);
              clearDexPairUrl();
            }}
          />
        );
      })()}
      </div>
    </>
  );
}
