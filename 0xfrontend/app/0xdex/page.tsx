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

import { useAccount, useReadContract, useReadContracts, useConnect, useDisconnect, useBlockNumber, useWriteContract, useSwitchChain, usePublicClient, useWatchContractEvent } from "wagmi";
import { erc20Abi, formatUnits, maxUint256, parseUnits } from "viem";
import { useDexStats, useAllPools, useDexRead, useRewardRead, useDexWrite, NATIVE_TOKEN, useTokenBalance, useTokenAllowance, Token, type PoolDataTuple } from "@/lib/use0xDex";
import { DEX_ABI, DEX_ADDRESS, NATIVE_ADDRESS } from "@/lib/0xDexAbi";
import { NUSD_ADDRESS, NUSD_ABI } from "@/lib/NUSDContract";
import { REWARD_MANAGER_ADDRESS } from "@/lib/rewardAbi";
import { useToast } from "@/components/Toast";
import { PageLoader } from "@/components/PageLoader";
import { useGSAP } from "@gsap/react";
import { gsapPixelStagger } from "@/lib/gsap-animations";
import { fetchCandlesRequest, getCandlesQueryKey } from "@/app/hooks/useCandleData";
import {
  getAddressExplorerUrl,
  getTokenExplorerUrl,
  getTransactionExplorerUrl,
} from "@/lib/explorer";

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
    <div className="pool-card-skeleton bg-[#13131F] border border-[#2D2D44]">
      <div className="pool-card-head">
        <div className="pool-card-head-main">
          <PixelSkeleton className="w-8 h-4" />
          <PixelSkeleton className="w-7 h-7 rounded-full" />
          <PixelSkeleton className="w-20 h-5" />
          <PixelSkeleton className="w-16 h-4" />
        </div>
        <PixelSkeleton className="w-14 h-6" />
      </div>
      <div className="pool-card-stats">
        <div className="pool-card-stat bg-[#1A1A2E]/50">
          <PixelSkeleton className="w-8 h-3 mb-1" />
          <PixelSkeleton className="w-16 h-4" />
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50">
          <PixelSkeleton className="w-12 h-3 mb-1" />
          <PixelSkeleton className="w-14 h-4" />
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50">
          <PixelSkeleton className="w-14 h-3 mb-1" />
          <PixelSkeleton className="w-12 h-4" />
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50">
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
type ChartTf = 15 | 60 | 240 | 1440;
const DEFAULT_CHART_TF: ChartTf = 15;
const CHART_PRELOAD_TIMEFRAMES = [15, 60, 240, 1440] as const satisfies readonly ChartTf[];
const CHART_WARM_POOL_LIMIT = 2;
const CHART_TIMEFRAMES = new Set<number>([15, 60, 240, 1440]);
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

function farmTokenAmountForNusd(
  amountNUSD: bigint,
  pool: PoolDataTuple,
  nusdAddress: `0x${string}`,
) {
  const nusdIsToken0 = pool[0].toLowerCase() === nusdAddress.toLowerCase();
  const nusdReserve = nusdIsToken0 ? pool[2] : pool[3];
  const tokenReserve = nusdIsToken0 ? pool[3] : pool[2];
  if (pool[4] === 0n || nusdReserve <= 0n || tokenReserve <= 0n) return amountNUSD;
  return (amountNUSD * tokenReserve) / nusdReserve;
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
  const humanIn = Number(formatUnits(reserveIn, tokenInDecimals));
  const humanOut = Number(formatUnits(reserveOut, tokenOutDecimals));
  return Number.isFinite(humanIn) && Number.isFinite(humanOut) && humanIn > 0
    ? humanOut / humanIn
    : 0;
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

function formatIntegerCount(value: string | number) {
  try {
    return BigInt(value).toLocaleString("en-US");
  } catch {
    return String(value);
  }
}

function countAtLeast(value: string | null, minimum: number) {
  if (value === null) return null;
  try {
    return BigInt(value) >= BigInt(minimum) ? value : String(minimum);
  } catch {
    return String(minimum);
  }
}

const SWAP_HISTORY_PAGE_SIZE = 100;
const SWAP_HISTORY_REFRESH_MS = 10_000;
const SWAP_HISTORY_COUNTS_REFRESH_MS = 15_000;
const SWAP_HISTORY_MAX_TIMESTAMP = "9999999999";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const SWAP_HISTORY_QUERY = `
  query GetSwapHistory($limit: Int!, $skip: Int!, $anchor: BigInt!) {
    swaps(
      first: $limit
      skip: $skip
      where: { timestamp_lte: $anchor }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      user
      tokenIn
      tokenOut
      amountIn
      amountOut
      fee
      timestamp
      blockNumber
    }
  }
`;

const SWAP_HISTORY_PAIR_QUERY = `
  query GetSwapHistory($limit: Int!, $skip: Int!, $anchor: BigInt!, $pairId: Bytes!) {
    swaps(
      first: $limit
      skip: $skip
      where: { timestamp_lte: $anchor, pairId: $pairId }
      orderBy: timestamp
      orderDirection: desc
    ) {
      id
      user
      tokenIn
      tokenOut
      amountIn
      amountOut
      fee
      timestamp
      blockNumber
    }
  }
`;

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

type SwapHistoryCountsResponse = {
  total?: string;
  pairs?: Record<string, string>;
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
  blockNumber?: string | number;
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
      blockNumber: BigInt(item.blockNumber ?? 0),
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

function mergeSwapHistory(
  current: SwapHistoryItem[],
  incoming: SwapHistoryItem[],
) {
  const byId = new Map<string, SwapHistoryItem>();
  for (const item of current) byId.set(item.id, item);
  for (const item of incoming) byId.set(item.id, item);

  return [...byId.values()].sort((left, right) => {
    if (left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
    if (left.blockNumber !== right.blockNumber) {
      return left.blockNumber > right.blockNumber ? -1 : 1;
    }
    return right.logIndex - left.logIndex;
  });
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
  chartHref,
  onSelect,
  onViewChart,
  onWarmChart,
  swapSelected = false,
  historyFiltered = false,
  onFilterHistory,
  tokenSymbol,
  tokenDecimals = 18,
}: {
  token0: `0x${string}`; token1: `0x${string}`; reserve0: bigint; reserve1: bigint; volume24h: bigint; totalVolume: bigint; lpTotal: bigint; rank: number;
  pairId: `0x${string}`;
  chartHref: string;
  onSelect?: (data: { token: `0x${string}`, nusd: `0x${string}`, reserve0: bigint, reserve1: bigint }) => void;
  onViewChart?: (data: { price: number | null; tokenDecimals: number }) => void;
  onWarmChart?: (data: { price: number | null; tokenDecimals: number }) => void;
  swapSelected?: boolean;
  historyFiltered?: boolean;
  onFilterHistory?: () => void;
  tokenSymbol?: string;
  tokenDecimals?: number;
}) {
  const NUSD_ADDRESS_LOCAL = NUSD_ADDRESS;
  const NATIVE = NATIVE_ADDRESS;
  const isToken0NUSD = token0.toLowerCase() === NUSD_ADDRESS_LOCAL.toLowerCase();
  const isToken1NUSD = token1.toLowerCase() === NUSD_ADDRESS_LOCAL.toLowerCase();
  const otherToken = isToken0NUSD ? token1 : (isToken1NUSD ? token0 : token0);
  const nusdAddr = isToken0NUSD ? token0 : (isToken1NUSD ? token1 : null);
  const isOtherNative = otherToken.toLowerCase() === NATIVE.toLowerCase();
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
  const handleWarmChart = () => {
    onWarmChart?.({ price: pricePerToken > 0 ? pricePerToken : null, tokenDecimals });
  };

  // TVL = reserveToken (in USD) + reserveNUSD = 2 * reserveNUSD (since they're equal value)
  const tvlUSD = reserveNUSD > 0n ? Number(formatUnits(reserveNUSD, 18)) * 2 : 0;
  const explorerUrl = isOtherNative
    ? getAddressExplorerUrl(DEX_ADDRESS)
    : getTokenExplorerUrl(otherToken);
  const explorerLabel = isOtherNative
    ? `${displaySymbol}/NUSD pool contract`
    : `${displaySymbol} token`;

  return (
    <div
      data-pair-id={pairId}
      data-swap-selected={swapSelected ? "true" : undefined}
      className={`pool-card-item rounded-xl bg-[#13131F] border border-[#2D2D44] hover:border-[#8888ff]/50 transition-all cursor-pointer ${
        swapSelected ? "pool-card-swap-selected" : ""
      } ${
        historyFiltered ? "pool-card-history-filtered" : ""
      }`}
      onClick={handleClick}
    >
      {/* Top Row: Rank, Symbol, Price */}
      <div className="pool-card-head">
        <div className="pool-card-head-main">
          <span className="text-xs text-[#64748B] bg-[#2D2D44] px-2 py-0.5 rounded">#{rank}</span>
          <div className="w-7 h-7 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] text-xs font-bold">L$</div>
          <span className="font-bold text-white text-sm" style={{ fontFamily: "var(--font-departure)" }}>
            {displaySymbol}/$NUSD
          </span>
          <span className="pixel-live-price text-xs text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
            ${pricePerToken > 0 ? pricePerToken.toFixed(6) : "0"}
          </span>
        </div>
        <div className="pool-card-actions">
          {onFilterHistory && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onFilterHistory();
              }}
              className={`pool-card-tx-filter ${historyFiltered ? "is-active" : ""}`}
              aria-pressed={historyFiltered}
              title={historyFiltered
                ? "Show all swap transactions"
                : `Filter swap history for ${displaySymbol}/NUSD`}
              aria-label={historyFiltered
                ? `Clear ${displaySymbol}/NUSD transaction filter`
                : `Filter transactions for ${displaySymbol}/NUSD`}
            >
              TX
            </button>
          )}
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(event) => event.stopPropagation()}
            className="pool-card-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#2D2D44] bg-[#1A1A2E] text-[#94A3B8] transition-colors hover:border-[#8888ff]/50 hover:text-white"
            title={`View ${explorerLabel} on explorer`}
            aria-label={`View ${explorerLabel} on explorer`}
          >
            <ExternalLinkIcon />
          </a>
          {onViewChart && (
            <Link
              href={chartHref}
              onFocus={handleWarmChart}
              onMouseEnter={handleWarmChart}
              onTouchStart={handleWarmChart}
              onClick={(e) => {
                e.stopPropagation();
                onViewChart({ price: pricePerToken > 0 ? pricePerToken : null, tokenDecimals });
              }}
              className="pool-card-action inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[#2D2D44] bg-[#1A1A2E] text-[#94A3B8] transition-colors hover:border-[#8888ff]/50 hover:text-white"
              title={`Chart ${displaySymbol}/NUSD`}
              aria-label={`Open ${displaySymbol}/NUSD chart`}
            >
              <ChartIcon />
            </Link>
          )}
        </div>
      </div>
      
      {/* Stats Row */}
      <div className="pool-card-stats">
        <div className="pool-card-stat bg-[#1A1A2E]/50 rounded-lg">
          <div className="text-[10px] text-[#64748B] uppercase">TVL</div>
          <div className="pixel-metric-value pixel-metric-tvl text-xs font-bold text-white truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSDFloat(tvlUSD)}
          </div>
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50 rounded-lg">
          <div className="text-[10px] text-[#64748B] uppercase">LP Shares</div>
          <div className="pixel-metric-value pixel-metric-lp text-xs font-bold text-amber-400 truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatNum(lpTotal)}
          </div>
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50 rounded-lg">
          <div className="text-[10px] text-[#64748B] uppercase">24h Volume</div>
          <div className="pixel-metric-value pixel-metric-volume text-xs font-bold text-[#8888ff] truncate" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSD(volume24h)}
          </div>
        </div>
        <div className="pool-card-stat bg-[#1A1A2E]/50 rounded-lg">
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
  hasMore,
  loadingMore,
  onLoadMore,
  tokenMetaByAddress,
}: {
  swaps: SwapHistoryItem[];
  loading: boolean;
  totalCount: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  tokenMetaByAddress: Map<string, TokenMeta>;
}) {
  const loadedCountLabel = swaps.length.toLocaleString();
  const resolvedTotalCount = countAtLeast(totalCount, swaps.length);
  const txCountLabel = resolvedTotalCount === null
    ? loadedCountLabel
    : formatIntegerCount(resolvedTotalCount);

  return (
    <section className="dex-swap-history pixel-panel">
      <div className="dex-history-head">
        <div>
          <p className="dex-eyebrow">ONCHAIN</p>
          <h2>Swap History</h2>
        </div>
        <div className="dex-history-meta">
          <div
            className="dex-tx-count"
            title={resolvedTotalCount === null
              ? `${loadedCountLabel} indexed swaps loaded`
              : `${loadedCountLabel} of ${txCountLabel} indexed swaps loaded`}
          >
            TX {txCountLabel}{resolvedTotalCount === null && hasMore ? "+" : ""}
          </div>
          <div className="dex-live-badge">
            <span className="dex-live-dot" />
            {loading ? "SYNCING" : "LIVE"}
          </div>
        </div>
      </div>

      <div
        className="dex-history-table"
        role="region"
        aria-label="Indexed swap history"
        tabIndex={0}
        onScroll={(event) => {
          const viewport = event.currentTarget;
          const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
          if (hasMore && !loadingMore && remaining < 240) onLoadMore();
        }}
      >
        <div className="dex-history-row dex-history-row-head">
          <span>Pair</span>
          <span>Trade</span>
          <span>Wallet</span>
          <span>Time</span>
        </div>

        {swaps.length === 0 ? (
          <div className="dex-history-empty">
            {loading ? "Loading indexed swaps..." : "No swaps found yet"}
          </div>
        ) : (
          swaps.map((item) => {
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
                  <a
                    href={getAddressExplorerUrl(item.user)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`View wallet ${item.user} on explorer`}
                    aria-label={`View wallet ${item.user} on explorer`}
                  >
                    {shortAddress(item.user)}
                  </a>
                  {item.txHash ? (
                    <a
                      href={getTransactionExplorerUrl(item.txHash)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="dex-history-block"
                      title={`View transaction ${item.txHash} on explorer`}
                      aria-label={`View transaction ${item.txHash} on explorer`}
                    >
                      {shortAddress(item.txHash)}
                    </a>
                  ) : (
                    <span className="dex-history-block">#{item.blockNumber.toString()}</span>
                  )}
                </div>
                <div className="dex-history-time">{formatSwapTime(item.timestamp)}</div>
              </div>
            );
          })
        )}
      </div>

      {hasMore ? (
        <div className="dex-history-footer">
          <button
            type="button"
            className="dex-history-load-more pixel-btn-soft pixel-btn-soft-secondary"
            disabled={loadingMore}
            onClick={onLoadMore}
          >
            {loadingMore ? "LOADING..." : "LOAD OLDER SWAPS"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg
      aria-hidden="true"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 4-4 3 3 5-7" />
    </svg>
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
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const { addLiquidity, removeLiquidity, claimReward } = useDexWrite();
  const LITVM_CHAIN_ID = 4441;
  const poolListRef = useRef<HTMLDivElement>(null);
  const publicClient = usePublicClient();
  const [swapHistory, setSwapHistory] = useState<SwapHistoryItem[]>([]);
  const [swapHistoryLoading, setSwapHistoryLoading] = useState(false);
  const [swapHistoryPairId, setSwapHistoryPairId] = useState("");
  const [swapHistoryCounts, setSwapHistoryCounts] = useState<SwapHistoryCountsResponse | null>(null);
  const [swapHistoryHasMore, setSwapHistoryHasMore] = useState(false);
  const [swapHistoryLoadingMore, setSwapHistoryLoadingMore] = useState(false);
  const swapHistoryPairIdRef = useRef("");
  const swapHistoryAnchorRef = useRef(SWAP_HISTORY_MAX_TIMESTAMP);
  const swapHistorySkipRef = useRef(0);
  const swapHistoryLoadMoreInFlightRef = useRef(false);

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
  const [chartPreloadTotal, setChartPreloadTotal] = useState<number>(CHART_PRELOAD_TIMEFRAMES.length);
  const routePairAppliedRef = useRef(false);
  const chartPreloadSeqRef = useRef(0);
  const chartWarmCacheRef = useRef(new Set<string>());
  const dexBlockRefetchAtRef = useRef(0);
  const dexBlockRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const { data: allPools, refetch: refetchAllPools } = useAllPools();
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
  const needsCreateTokenApproval =
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
      .map(({ pairId, token0, token1, poolData }) => {
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
          poolData,
          label: `${token.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? "zkLTC" : token.slice(0, 8) + "..."}/NUSD`,
        };
      })
      .filter(Boolean) as {
        token: `0x${string}`;
        nusd: `0x${string}`;
        pairId: `0x${string}`;
        poolData: PoolDataTuple;
        label: string;
      }[];
  }, [allPools, nusdAddress]);

  const allPoolData = useMemo<PoolDataTuple[]>(
    () => poolOptions.map((pool) => pool.poolData),
    [poolOptions]
  );

  // Calculate total volume from all pools
  const totalVolume = useMemo(
    () => allPoolData.reduce((sum, pool) => sum + pool[6], 0n),
    [allPoolData]
  );

  // Fetch token symbols for each pool
  const tokenReadDescriptors = useMemo(
    () => poolOptions.flatMap((pool, poolIndex) => {
      if (pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) return [];
      return [
        {
          poolIndex,
          kind: "symbol" as const,
          contract: {
            address: pool.token,
            abi: erc20Abi,
            functionName: "symbol" as const,
          },
        },
        {
          poolIndex,
          kind: "decimals" as const,
          contract: {
            address: pool.token,
            abi: erc20Abi,
            functionName: "decimals" as const,
          },
        },
      ];
    }),
    [poolOptions]
  );
  const { data: tokenReadResults } = useReadContracts({
    contracts: tokenReadDescriptors.map((descriptor) => descriptor.contract),
    allowFailure: true,
    query: { enabled: tokenReadDescriptors.length > 0 },
  });
  const { tokenSymbols, tokenDecimalsList } = useMemo(() => {
    const symbols: Array<string | undefined> = poolOptions.map((pool) =>
      pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? "zkLTC" : undefined
    );
    const decimals: Array<number | undefined> = poolOptions.map((pool) =>
      pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase() ? 18 : undefined
    );
    tokenReadDescriptors.forEach((descriptor, index) => {
      const result = tokenReadResults?.[index];
      if (result?.status !== "success") return;
      if (descriptor.kind === "symbol") {
        symbols[descriptor.poolIndex] = String(result.result);
      } else {
        decimals[descriptor.poolIndex] = Number(result.result);
      }
    });
    return { tokenSymbols: symbols, tokenDecimalsList: decimals };
  }, [poolOptions, tokenReadDescriptors, tokenReadResults]);

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

  const fetchSwapHistoryFromSubgraph = useCallback(async ({
    anchor = SWAP_HISTORY_MAX_TIMESTAMP,
    skip = 0,
    pairId,
    signal,
  }: {
    anchor?: string;
    skip?: number;
    pairId?: string;
    signal?: AbortSignal;
  } = {}) => {
    const response = await fetch("/api/subgraph", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: pairId ? SWAP_HISTORY_PAIR_QUERY : SWAP_HISTORY_QUERY,
        variables: {
          limit: SWAP_HISTORY_PAGE_SIZE,
          skip,
          anchor,
          ...(pairId ? { pairId } : {}),
        },
      }),
      cache: "no-store",
      signal,
    });

    if (!response.ok) {
      throw new Error(`Subgraph request failed: ${response.status}`);
    }

    const json = await response.json();
    if (json.errors?.length) {
      throw new Error(json.errors[0]?.message || "Subgraph returned errors");
    }

    const swaps = json.data?.swaps;
    const rawRows = Array.isArray(swaps) ? swaps as SubgraphSwap[] : [];
    const rows = rawRows
      .map((swap, index) => parseSubgraphSwap(swap, index))
      .filter((item): item is SwapHistoryItem => !!item);
    return {
      rows,
      rawCount: rawRows.length,
      newestTimestamp: parseSubgraphTimestamp(rawRows[0]?.timestamp),
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function loadSwapHistoryCounts() {
      try {
        const response = await fetch("/api/dex/swap-counts", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Swap count request failed: ${response.status}`);
        }
        const payload = await response.json() as SwapHistoryCountsResponse;
        if (!cancelled && typeof payload.total === "string" && payload.pairs) {
          setSwapHistoryCounts(payload);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Failed to load exact swap counts", error);
        }
      }
    }

    void loadSwapHistoryCounts();
    const refreshId = window.setInterval(() => {
      void loadSwapHistoryCounts();
    }, SWAP_HISTORY_COUNTS_REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let requestInFlight = false;
    const controller = new AbortController();
    const activePairId = swapHistoryPairId;

    swapHistoryPairIdRef.current = activePairId;
    swapHistoryAnchorRef.current = SWAP_HISTORY_MAX_TIMESTAMP;
    swapHistorySkipRef.current = 0;
    setSwapHistory([]);
    setSwapHistoryHasMore(false);

    async function loadSwapHistory(initialLoad = false) {
      if (requestInFlight) return;
      requestInFlight = true;
      if (initialLoad) setSwapHistoryLoading(true);
      try {
        const page = await fetchSwapHistoryFromSubgraph({
          pairId: activePairId || undefined,
          signal: controller.signal,
        });
        if (!cancelled) {
          if (initialLoad || swapHistorySkipRef.current === 0) {
            swapHistoryAnchorRef.current = page.newestTimestamp > 0
              ? page.newestTimestamp.toString()
              : SWAP_HISTORY_MAX_TIMESTAMP;
            swapHistorySkipRef.current = page.rawCount;
            setSwapHistory(page.rows);
            setSwapHistoryHasMore(page.rawCount === SWAP_HISTORY_PAGE_SIZE);
          } else {
            setSwapHistory((current) => mergeSwapHistory(current, page.rows));
          }
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.warn("Failed to load swap history", error);
        }
      } finally {
        requestInFlight = false;
        if (initialLoad && !cancelled) setSwapHistoryLoading(false);
      }
    }

    void loadSwapHistory(true);
    const refreshId = window.setInterval(() => {
      void loadSwapHistory();
    }, SWAP_HISTORY_REFRESH_MS);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(refreshId);
    };
  }, [fetchSwapHistoryFromSubgraph, swapHistoryPairId]);

  const loadOlderSwapHistory = useCallback(async () => {
    if (
      swapHistoryLoadMoreInFlightRef.current ||
      swapHistoryLoadingMore ||
      !swapHistoryHasMore
    ) {
      return;
    }

    swapHistoryLoadMoreInFlightRef.current = true;
    setSwapHistoryLoadingMore(true);
    try {
      const requestedPairId = swapHistoryPairId;
      const page = await fetchSwapHistoryFromSubgraph({
        anchor: swapHistoryAnchorRef.current,
        skip: swapHistorySkipRef.current,
        pairId: requestedPairId || undefined,
      });
      if (swapHistoryPairIdRef.current !== requestedPairId) return;
      swapHistorySkipRef.current += page.rawCount;
      setSwapHistory((current) => mergeSwapHistory(current, page.rows));
      setSwapHistoryHasMore(page.rawCount === SWAP_HISTORY_PAGE_SIZE);
    } catch (error) {
      toast.handleError(error, "Swap history failed");
    } finally {
      swapHistoryLoadMoreInFlightRef.current = false;
      setSwapHistoryLoadingMore(false);
    }
  }, [fetchSwapHistoryFromSubgraph, swapHistoryHasMore, swapHistoryLoadingMore, swapHistoryPairId, toast]);

  const handleSwapHistoryPairChange = useCallback((pairId: string) => {
    swapHistoryPairIdRef.current = pairId;
    swapHistoryAnchorRef.current = SWAP_HISTORY_MAX_TIMESTAMP;
    swapHistorySkipRef.current = 0;
    setSwapHistory([]);
    setSwapHistoryHasMore(false);
    setSwapHistoryPairId(pairId);
  }, []);

  useWatchContractEvent({
    address: DEX_ADDRESS as `0x${string}`,
    abi: DEX_ABI,
    eventName: "Swapped",
    onLogs(logs) {
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
    },
  });

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

  const swapHistoryExactTotal = useMemo(() => {
    if (!swapHistoryCounts?.total) return null;
    if (!swapHistoryPairId) return swapHistoryCounts.total;
    return swapHistoryCounts.pairs?.[swapHistoryPairId.toLowerCase()] ?? "0";
  }, [swapHistoryCounts, swapHistoryPairId]);

  const activeSwapPairId = useMemo(() => {
    if (!swapTokenOut) return "";

    const tokenInAddress = swapTokenIn.address.toLowerCase();
    const tokenOutAddress = swapTokenOut.address.toLowerCase();
    const poolIndex = allPoolData.findIndex((poolData) => {
      if (!poolData) return false;
      const token0Address = poolData[0].toLowerCase();
      const token1Address = poolData[1].toLowerCase();
      return (
        (token0Address === tokenInAddress && token1Address === tokenOutAddress) ||
        (token0Address === tokenOutAddress && token1Address === tokenInAddress)
      );
    });

    return poolIndex >= 0 ? poolOptions[poolIndex]?.pairId.toLowerCase() ?? "" : "";
  }, [allPoolData, poolOptions, swapTokenIn.address, swapTokenOut]);

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
    options: { force?: boolean; onTimeframeDone?: () => void; timeframes?: readonly ChartTf[] } = {},
  ) => {
    const timeframes = options.timeframes?.length ? options.timeframes : CHART_PRELOAD_TIMEFRAMES;
    // Keep Goldsky requests sequential. Warming every timeframe in parallel for
    // several pools was enough to trip the public endpoint rate limit.
    for (const tf of timeframes) {
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
          queryFn: ({ signal }: { signal?: AbortSignal }) => fetchCandlesRequest({
            token0: target.chartToken0,
            token1: target.chartToken1,
            intervalMinutes: tf,
            subgraphUrl: "/api/candles",
            token0Decimals: 18,
            token1Decimals: target.chartToken1Decimals,
            requestSignal: signal,
          }),
          staleTime: tf <= 15 ? 10_000 : tf <= 60 ? 20_000 : 45_000,
        };

        if (options.force) {
          await queryClient.fetchQuery(queryOptions);
        } else {
          await queryClient.prefetchQuery(queryOptions);
        }
      } catch {
        // A background warm-up must never block opening the DEX.
      } finally {
        options.onTimeframeDone?.();
      }
    }
  }, [queryClient]);

  const warmChartForPool = useCallback((
    poolIndex: number,
    anchor?: { price: number | null; tokenDecimals: number },
    timeframes: readonly ChartTf[] = [DEFAULT_CHART_TF],
  ) => {
    const target = getChartPreloadTarget(poolIndex, anchor);
    if (!target) return;

    const warmKey = `${target.pairId}:${target.chartToken0}:${target.chartToken1}:${target.chartToken1Decimals}:${timeframes.join(",")}`;
    if (chartWarmCacheRef.current.has(warmKey)) return;
    chartWarmCacheRef.current.add(warmKey);

    void loadChartWindow();
    void preloadChartCandles(target, { timeframes });
  }, [getChartPreloadTarget, preloadChartCandles]);

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
    setChartPreloadTotal(1);

    let completed = 0;
    const markDone = () => {
      completed += 1;
      if (chartPreloadSeqRef.current === preloadSeq) {
        setChartPreloadProgress(completed);
      }
    };

    await Promise.allSettled([
      loadChartWindow(),
      preloadChartCandles(target, { force: true, onTimeframeDone: markDone, timeframes: [timeframe] }),
    ]);

    if (chartPreloadSeqRef.current !== preloadSeq) return;

    setSelectedChartPair(pool.pairId);
    setSelectedChartAnchor(target.chartAnchor);
    setSelectedChartTimeframe(timeframe);
    setShowChart(true);
    setChartPreloadLabel(null);
    if (updateUrl) clearDexPairUrl();

    const backgroundTimeframes = CHART_PRELOAD_TIMEFRAMES.filter((tf) => tf !== timeframe);
    void preloadChartCandles(target, { timeframes: backgroundTimeframes });
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
          return dataA[3] === dataB[3] ? 0 : dataA[3] > dataB[3] ? -1 : 1;
        case "vol24h":
          return dataA[5] === dataB[5] ? 0 : dataA[5] > dataB[5] ? -1 : 1; // volume24h (index 5)
        case "volAll":
          return dataA[6] === dataB[6] ? 0 : dataA[6] > dataB[6] ? -1 : 1; // totalVolume (index 6)
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

      for (const { poolIndex, target } of targets) {
        if (cancelled) return;
        warmChartForPool(poolIndex, target.chartAnchor);
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
    sortedPoolIndices,
    warmChartForPool,
  ]);

  // Check if selected pool is Base Pool (contains NUSD) - only Base Pools can farm
  const isSelectedBasePool = useMemo(() => {
    if (poolOptions.length <= selectedFarmPool) return true;
    const pd = allPoolData[selectedFarmPool];
    if (!pd) return true;
    if (!nusdAddress) return false;
    const normalizedNusd = nusdAddress.toLowerCase();
    return pd[0].toLowerCase() === normalizedNusd || pd[1].toLowerCase() === normalizedNusd;
  }, [poolOptions, selectedFarmPool, allPoolData, nusdAddress]);

  // Get pool data
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    swapTokenIn && swapTokenOut ? [swapTokenIn.address, swapTokenOut.address] : undefined,
    !!swapTokenIn && !!swapTokenOut
  );
  const { data: poolData } = useDexRead("pools", pairId ? [pairId] : undefined, !!pairId);

  // Farm LP queries - use selectedFarmPool index
  const farmPairId = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.pairId : undefined;
  const farmPoolToken = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.token : undefined;
  const { data: farmLPData, refetch: refetchFarmLP } = useDexRead<bigint>(
    "userLP",
    farmPairId && address ? [farmPairId, address] : undefined,
    !!farmPairId && !!address,
  );
  const { data: farmPendingReward, refetch: refetchPendingReward } = useRewardRead<bigint>("getUserPendingReward",
    address ? [address as `0x${string}`] : undefined,
    !!address
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
  const { refetch: refetchPool } = useDexRead("pools", pairId ? [pairId] : undefined, !!pairId);

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
  const { data: allowanceNUSDForLiquidity, refetch: refetchAllowanceNUSD } = useReadContract({
    address: NUSD_ADDRESS as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: { enabled: !!address },
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

  const refetchDexLiveReads = useCallback(() => {
    refetchAllowanceIn?.();
    refetchAllowancePool?.();
    refetchPool?.();
    refetchAllPools?.();
    refetchFarmLP?.();
    refetchPendingReward?.();
    refetchFarmAllowance?.();
    refetchAllowance?.();
    refetchAllowanceNUSD();
  }, [
    refetchAllowanceIn,
    refetchAllowancePool,
    refetchPool,
    refetchAllPools,
    refetchFarmLP,
    refetchPendingReward,
    refetchFarmAllowance,
    refetchAllowance,
    refetchAllowanceNUSD,
  ]);

  const scheduleDexLiveReads = useCallback(() => {
    const now = Date.now();
    const elapsed = now - dexBlockRefetchAtRef.current;
    if (elapsed >= 4_000) {
      dexBlockRefetchAtRef.current = now;
      refetchDexLiveReads();
      return;
    }

    if (dexBlockRefetchTimerRef.current) return;
    dexBlockRefetchTimerRef.current = setTimeout(() => {
      dexBlockRefetchTimerRef.current = null;
      dexBlockRefetchAtRef.current = Date.now();
      refetchDexLiveReads();
    }, 4_000 - elapsed);
  }, [refetchDexLiveReads]);

  // Auto-refetch on new blocks, throttled to avoid RPC/UI bursts.
  useEffect(() => {
    if (blockNumber) scheduleDexLiveReads();
  }, [blockNumber, scheduleDexLiveReads]);

  useEffect(() => () => {
    if (dexBlockRefetchTimerRef.current) {
      clearTimeout(dexBlockRefetchTimerRef.current);
      dexBlockRefetchTimerRef.current = null;
    }
  }, []);

  useEffect(() => { setMounted(true); }, []);

  const handleSwapApprove = async () => {
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
      const hash = await writeContractAsync({
        address: tokenAddr,
        abi,
        functionName: "approve",
        args: [DEX_ADDRESS as `0x${string}`, maxUint256],
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Approval transaction reverted");
      }
      await refetchAllowanceIn?.();
      toast.success("Approved", `${swapTokenIn.symbol} is ready`);
    } catch (err) {
      toast.handleError(err, "Failed to send approval transaction");
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

  const handleAddLiquidity = async () => {
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
    if (allowanceNUSDForLiquidity === undefined || allowanceNUSDForLiquidity < amountNUSD) {
      toast.error("Approval required", "Please approve NUSD first");
      return;
    }
    try {
      toast.info("Adding liquidity", "Please confirm transaction...");
      await addLiquidity(poolToken.address, nusdAddress!, amountToken, amountNUSD);
    } catch (error) {
      toast.handleError(error, "Add liquidity failed");
    }
  };

  // Farm handlers - Add Liquidity to farm
  const handleFarmAdd = async () => {
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
    const tokenAmount = farmTokenAmountForNusd(amountNUSD, pd, nusdAddress!);
    
    // Check approval for non-native tokens
    if (farmPoolToken !== NATIVE_ADDRESS) {
      if (!farmTokenAllowance || (farmTokenAllowance as bigint) < tokenAmount) {
        toast.error("Approval required", `Please click "Approve ${(tokenSymbols[selectedFarmPool] as string) || "Token"}\" first`);
        return;
      }
    }
    if (allowanceNUSDForLiquidity === undefined || allowanceNUSDForLiquidity < amountNUSD) {
      toast.error("Approval required", "Please approve NUSD first");
      return;
    }
    
    try {
      toast.info("Adding Liquidity", "Please confirm transaction to farm...");
      await addLiquidity(farmPoolToken, nusdAddress!, tokenAmount, amountNUSD);
    } catch (error) {
      toast.handleError(error, "Add liquidity failed");
    }
  };

  const handleFarmRemove = async () => {
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
    try {
      toast.info("Removing Liquidity", "Please confirm transaction...");
      await removeLiquidity(farmPairId, amount);
    } catch (error) {
      toast.handleError(error, "Remove liquidity failed");
    }
  };

  const handleClaim = async () => {
    if (!isConnected || !ensureCorrectChain()) return;
    try {
      toast.info("Claiming reward", "Please confirm transaction...");
      await claimReward();
    } catch (error) {
      toast.handleError(error, "Claim reward failed");
    }
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

  const handleApprove = async (token: Token) => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!ensureCorrectChain()) return;

    const isNUSD = token.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${token.symbol || "Token"}...`);
    try {
      const hash = await writeContractAsync({
        address: token.address as `0x${string}`,
        abi,
        functionName: "approve",
        args: [DEX_ADDRESS as `0x${string}`, maxUint256],
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Approval transaction reverted");
      }
      await Promise.allSettled([
        refetchAllowanceIn?.(),
        refetchAllowancePool?.(),
        refetchFarmAllowance?.(),
        refetchAllowanceNUSD(),
      ]);
      toast.success("Approved", `${token.symbol || "Token"} is ready`);
    } catch (error) {
      toast.handleError(error, "Approval failed");
    }
  };

  const handleApproveCustomToken = async () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!createTokenA || !needsCreateApproval) return;

    const isNUSD = createApprovalToken.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${createApprovalToken.symbol || "Token"}...`);
    try {
      const hash = await writeContractAsync({
        address: createApprovalToken.address,
        abi,
        functionName: "approve",
        args: [DEX_ADDRESS as `0x${string}`, maxUint256],
      });
      if (publicClient) {
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("Approval transaction reverted");
      }
      await Promise.allSettled([
        refetchAllowance?.(),
        refetchAllowanceIn?.(),
        refetchAllowancePool?.(),
        refetchFarmAllowance?.(),
        refetchAllowanceNUSD(),
      ]);
      toast.success("Approved", `${createApprovalToken.symbol || "Token"} is ready`);
    } catch (error) {
      toast.handleError(error, "Approval failed");
    }
  };

  // Anyone can create a pool by adding initial liquidity to a new pair
  const handleCreatePool = async () => {
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
    if (needsCreateApproval) {
      toast.error("Approval required", `Please approve ${createApprovalToken.symbol || "token"} first`);
      return;
    }
    
    // Use addLiquidity to create pool (creates pool + adds liquidity in one tx)
    try {
      toast.info("Creating Pool", "Please confirm transaction...");
      await addLiquidity(tokenA, tokenB, amountA, amountB);
    } catch (error) {
      toast.handleError(error, "Create pool failed");
    }
  };

  const swapApprovalAmount = safeParseUnits(swapAmountIn, swapTokenIn.decimals) ?? 0n;
  const poolApprovalAmount = safeParseUnits(poolAmountToken, poolToken.decimals) ?? 0n;
  const poolNusdApprovalAmount = safeParseUnits(poolAmountNUSD, 18) ?? 0n;
  const needsSwapApproval = Boolean(
    swapTokenIn.address !== NATIVE_ADDRESS &&
    !allowanceInError &&
    swapApprovalAmount > 0n &&
    (allowanceIn === undefined || allowanceIn < swapApprovalAmount)
  );
  const needsPoolTokenApproval = Boolean(
    poolToken.address !== NATIVE_ADDRESS &&
    !allowancePoolError &&
    poolApprovalAmount > 0n &&
    (allowancePoolToken === undefined || allowancePoolToken < poolApprovalAmount)
  );
  const needsPoolNusdApproval = Boolean(
    poolNusdApprovalAmount > 0n &&
    (allowanceNUSDForLiquidity === undefined || allowanceNUSDForLiquidity < poolNusdApprovalAmount)
  );
  const needsPoolApproval = needsPoolTokenApproval || needsPoolNusdApproval;
  const poolApprovalToken = needsPoolTokenApproval ? poolToken : KNOWN_TOKENS[1];

  const createNusdApprovalAmount = createAmountBParsed ?? 0n;
  const needsCreateNusdApproval = Boolean(
    createNusdApprovalAmount > 0n &&
    (allowanceNUSDForLiquidity === undefined || allowanceNUSDForLiquidity < createNusdApprovalAmount)
  );
  const needsCreateApproval = needsCreateTokenApproval || needsCreateNusdApproval;
  const createApprovalToken: Token = needsCreateTokenApproval
    ? {
        address: createTokenA as `0x${string}`,
        symbol: (tokenSymbol as string) || "TOKEN",
        decimals: Number(tokenDecimals ?? 18),
        name: (tokenName as string) || "Token",
      }
    : KNOWN_TOKENS[1];

  const farmNusdApprovalAmount = safeParseUnits(farmNUSDAmount, 18) ?? 0n;
  const farmPoolData = allPoolData[selectedFarmPool];
  const farmTokenApprovalAmount = farmPoolData && farmNusdApprovalAmount > 0n && nusdAddress
    ? farmTokenAmountForNusd(farmNusdApprovalAmount, farmPoolData, nusdAddress)
    : 0n;
  const needsFarmTokenApproval = Boolean(
    farmPoolToken &&
    farmPoolToken !== NATIVE_ADDRESS &&
    farmTokenApprovalAmount > 0n &&
    (farmTokenAllowance === undefined || farmTokenAllowance < farmTokenApprovalAmount)
  );
  const needsFarmNusdApproval = Boolean(
    farmNusdApprovalAmount > 0n &&
    (allowanceNUSDForLiquidity === undefined || allowanceNUSDForLiquidity < farmNusdApprovalAmount)
  );
  const farmApprovalToken: Token | null = needsFarmTokenApproval && farmPoolToken
    ? {
        address: farmPoolToken,
        symbol: (tokenSymbols[selectedFarmPool] as string) || "TOKEN",
        decimals: getPoolTokenDecimals(selectedFarmPool),
        name: "Token",
      }
    : needsFarmNusdApproval
      ? KNOWN_TOKENS[1]
      : null;

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

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-3 lg:gap-6">
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
                        const priceImpact = reserveIn > 0n
                          ? Number((amountInWei * 10_000n) / reserveIn) / 100
                          : 0;
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
                      {KNOWN_TOKENS.map(t => (
                        <option key={t.address} value={t.address} disabled={t.address === NUSD_ADDRESS}>
                          {t.symbol}
                        </option>
                      ))}
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
                  <button onClick={() => handleApprove(poolApprovalToken)} className="w-full mb-3 pixel-btn-soft pixel-btn-soft-amber">
                    APPROVE {poolApprovalToken.symbol}
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
          <div className="dex-top-pairs min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 mb-4">
              <h2 className="text-base sm:text-lg font-bold text-white shrink-0" style={{ fontFamily: "var(--font-departure)" }}>
                Top Pairs ({poolOptions.length})
              </h2>
              <div className="flex gap-1 bg-[#13131F] p-1 rounded-lg ml-auto">
                <button
                  type="button"
                  onClick={() => handleSwapHistoryPairChange("")}
                  className={`dex-all-tx-filter px-2 py-1 text-xs font-bold transition-all pixel-btn-soft ${
                    !swapHistoryPairId
                      ? "pixel-btn-soft-indigo pixel-btn-soft-sm"
                      : "pixel-btn-soft-secondary pixel-btn-soft-sm"
                  }`}
                  aria-pressed={!swapHistoryPairId}
                >
                  ALL TX
                </button>
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
            <div
              className="dex-top-pairs-list space-y-2"
              ref={poolListRef}
              role="region"
              aria-label="All top pairs"
              tabIndex={0}
            >
              {poolOptions.length > 0 ? (
                sortedPoolIndices.map((poolIndex, rankIndex) => {
                  const pool = poolOptions[poolIndex];
                  const pData = allPoolData[poolIndex];
                  const token0 = pData?.[0] as `0x${string}` | undefined;
                  const token1 = pData?.[1] as `0x${string}` | undefined;
                  const normalizedPairId = pool.pairId.toLowerCase();

                  if (!pData) return (
                    <PoolCardSkeleton key={pool.pairId} />
                  );

                  return (
                    <PoolCard
                      key={pool.pairId}
                      rank={rankIndex + 1}
                      token0={token0 || pool.token}
                      token1={token1 || pool.nusd}
                      reserve0={(pData[2] as bigint) || 0n}
                      reserve1={(pData[3] as bigint) || 0n}
                      volume24h={(pData[5] as bigint) || 0n}
                      totalVolume={(pData[6] as bigint) || 0n}
                      lpTotal={(pData[4] as bigint) || 0n}
                      pairId={pool.pairId}
                      chartHref="/0xdex"
                      tokenSymbol={getPoolTokenSymbol(poolIndex)}
                      tokenDecimals={getPoolTokenDecimals(poolIndex)}
                      swapSelected={activeSwapPairId === normalizedPairId}
                      historyFiltered={swapHistoryPairId === normalizedPairId}
                      onFilterHistory={() => {
                        handleSwapHistoryPairChange(
                          swapHistoryPairId === normalizedPairId ? "" : normalizedPairId,
                        );
                      }}
                      onSelect={() => {
                        selectPoolForSwap(poolIndex);
                      }}
                      onViewChart={(chartAnchor) => {
                        openChartForPool(poolIndex, chartAnchor);
                      }}
                      onWarmChart={(chartAnchor) => {
                        warmChartForPool(poolIndex, chartAnchor);
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
                        const amountNUSD = safeParseUnits(farmNUSDAmount, 18);
                        if (!amountNUSD || !nusdAddress) return "0.0000";
                        const tokenAmt = farmTokenAmountForNusd(amountNUSD, pd, nusdAddress);
                        return `${Number(formatUnits(tokenAmt, getPoolTokenDecimals(selectedFarmPool))).toFixed(4)}`;
                      })()
                    ) : "0.0000"}
                  </span>
                </div>
              </div>

              {/* Check if approval needed for farm */}
              {(farmApprovalToken || (farmPoolToken && farmPoolToken !== NATIVE_ADDRESS)) && (
                <div className="mb-4">
                  {farmApprovalToken ? (
                    <button
                      onClick={() => handleApprove(farmApprovalToken)}
                      className="w-full py-3 pixel-btn-soft pixel-btn-soft-amber"
                    >
                      APPROVE {farmApprovalToken.symbol}
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
            totalCount={swapHistoryExactTotal}
            hasMore={swapHistoryHasMore}
            loadingMore={swapHistoryLoadingMore}
            onLoadMore={() => void loadOlderSwapHistory()}
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
              {Array.from({ length: chartPreloadTotal }, (_, index) => (
                <div
                  key={index}
                  className={`h-3 flex-1 border border-white/20 ${index < chartPreloadProgress ? "bg-white" : "bg-white/10"}`}
                />
              ))}
            </div>
            <div className="text-[9px] text-white/55">
              {chartPreloadProgress}/{chartPreloadTotal} READY
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
