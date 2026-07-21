"use client";

import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  useAccount,
  useBalance,
  useWatchContractEvent,
} from "wagmi";
import { erc20Abi, formatUnits, maxUint256, parseUnits } from "viem";
import { useCallback, useMemo, useRef, useState, useEffect } from "react";
import {
  DEX_ABI,
  DEX_ADDRESS,
  NATIVE_ADDRESS,
  PoolInfo,
} from "./0xDexAbi";
import { REWARD_MANAGER_ABI, REWARD_MANAGER_ADDRESS } from "./rewardAbi";
import { NUSD_ADDRESS } from "./NUSDContract";

// ============================================================
// Tokens registry — NUSD + native (zkLTC on LitVM)
// ============================================================

export const NATIVE_TOKEN = {
  address: NATIVE_ADDRESS,
  symbol: "zkLTC",
  decimals: 18,
  name: "zkLIT",
} as const;

export interface Token {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  name: string;
  logo?: string;
}

export const KNOWN_TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: NUSD_ADDRESS,
    symbol: "NUSD",
    decimals: 18,
    name: "NUSD Stablecoin",
    logo: "/NUSD_LOGO.jpg",
  },
];

// ============================================================
// Generic read helper
// ============================================================

export function useDexRead<T = unknown>(
  functionName: string,
  args?: readonly unknown[],
  enabled = true,
) {
  const result = useReadContract({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    functionName: functionName as never,
    args: args as never,
    query: { enabled },
  });

  return result as Omit<typeof result, "data"> & { data: T | undefined };
}

export function useRewardRead<T = unknown>(
  functionName: string,
  args?: readonly unknown[],
  enabled = true,
) {
  const result = useReadContract({
    address: REWARD_MANAGER_ADDRESS,
    abi: REWARD_MANAGER_ABI,
    functionName: functionName as never,
    args: args as never,
    query: { enabled },
  });

  return result as Omit<typeof result, "data"> & { data: T | undefined };
}

// ============================================================
// Write hooks
// ============================================================

export function useDexWrite() {
  const { writeContractAsync } = useWriteContract();

  const addLiquidity = useCallback(
    (
      tokenA: `0x${string}`,
      tokenB: `0x${string}`,
      amountA: bigint,
      amountB: bigint,
    ) => {
      return writeContractAsync({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "addLiquidity",
        args: [tokenA, tokenB, amountA, amountB],
        value:
          tokenA === NATIVE_ADDRESS
            ? amountA
            : tokenB === NATIVE_ADDRESS
              ? amountB
              : undefined,
      });
    },
    [writeContractAsync],
  );

  const removeLiquidity = useCallback(
    (pairId: `0x${string}`, lpAmount: bigint) => {
      return writeContractAsync({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "removeLiquidity",
        args: [pairId, lpAmount],
      });
    },
    [writeContractAsync],
  );

  const swap = useCallback(
    (
      tokenIn: `0x${string}`,
      tokenOut: `0x${string}`,
      amountIn: bigint,
      minAmountOut: bigint,
    ) => {
      return writeContractAsync({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "swap",
        args: [tokenIn, tokenOut, amountIn, minAmountOut],
        value: tokenIn === NATIVE_ADDRESS ? amountIn : undefined,
      });
    },
    [writeContractAsync],
  );

  const claimReward = useCallback(() => {
    return writeContractAsync({
      address: REWARD_MANAGER_ADDRESS,
      abi: REWARD_MANAGER_ABI,
      functionName: "claimReward",
      args: [],
    });
  }, [writeContractAsync]);

  const approveToken = useCallback(
    (
      token: `0x${string}`,
      spender: `0x${string}` = DEX_ADDRESS,
      amount: bigint = maxUint256,
    ) => {
      return writeContractAsync({
        address: token,
        abi: erc20Abi,
        functionName: "approve",
        args: [spender, amount],
      });
    },
    [writeContractAsync],
  );

  const setSwapFee = useCallback(
    (newFee: bigint) => {
      return writeContractAsync({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "setSwapFee",
        args: [newFee],
      });
    },
    [writeContractAsync],
  );

  return { addLiquidity, removeLiquidity, swap, claimReward, approveToken, setSwapFee };
}

// ============================================================
// Token balance / allowance / approve
// ============================================================

export function useTokenBalance(
  address: `0x${string}` | undefined,
  token: Token | null,
): { data: bigint | undefined } {
  const isNative = token?.address === NATIVE_ADDRESS;
  const { data: nativeBalance } = useBalance({ address });
  const { data: erc20Balance } = useReadContract({
    address: isNative ? undefined : (token?.address as `0x${string}` | undefined),
    abi: isNative ? undefined : erc20Abi,
    functionName: "balanceOf",
    args: isNative ? undefined : [address],
    query: { enabled: !!address && !!token && !isNative },
  });

  return {
    data: isNative ? (nativeBalance?.value ?? 0n) : (erc20Balance as bigint | undefined),
  };
}

export function useTokenAllowance(token: Token | null, spender: `0x${string}`) {
  const { address: user } = useAccount();

  const result = useReadContract({
    address: token?.address === NATIVE_ADDRESS ? undefined : token?.address,
    abi: token?.address === NATIVE_ADDRESS ? undefined : erc20Abi,
    functionName: "allowance",
    args: token?.address === NATIVE_ADDRESS ? undefined : [user, spender],
    query: {
      enabled: !!user && !!token && token.address !== NATIVE_ADDRESS,
    },
  });

  return result;
}

// ============================================================
// Pools
// ============================================================

export type PoolDataTuple = readonly [
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

export function useAllPools() {
  const pairIdsQuery = useDexRead<readonly `0x${string}`[]>(
    "getAllPools",
  );
  const pairIds = pairIdsQuery.data;

  const poolInfosQuery = useReadContracts({
    contracts:
      pairIds?.map((pairId) => ({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "pools" as const,
        args: [pairId] as const,
      })) ?? [],
    allowFailure: true,
    query: { enabled: !!pairIds && pairIds.length > 0 },
  });
  const refetchPairIds = pairIdsQuery.refetch;
  const refetchPoolInfos = poolInfosQuery.refetch;

  const result = useMemo<
    | {
        pairId: `0x${string}`;
        token0: `0x${string}`;
        token1: `0x${string}`;
        poolData: PoolDataTuple;
      }[]
    | undefined
  >(() => {
    if (!pairIds) return undefined;
    return pairIds.flatMap((pairId, index) => {
      const entry = poolInfosQuery.data?.[index];
      if (entry?.status !== "success") return [];
      const poolData = entry.result as PoolDataTuple;
      return [{
        pairId,
        token0: poolData[0],
        token1: poolData[1],
        poolData,
      }];
    });
  }, [pairIds, poolInfosQuery.data]);

  const refetch = useCallback(async () => {
    const [pairIdsResult] = await Promise.allSettled([
      refetchPairIds(),
      refetchPoolInfos(),
    ]);
    return pairIdsResult.status === "fulfilled" ? pairIdsResult.value : undefined;
  }, [refetchPairIds, refetchPoolInfos]);

  return {
    data: result,
    refetch,
  };
}

export function usePoolInfo(pairId: `0x${string}` | undefined) {
  // New ABI returns [token0, token1, reserve0, reserve1, totalLP, volume24h, totalVolume, lastVolumeReset, createdAt]
  const { data: poolData } = useDexRead<
    readonly [
      string,
      string,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]
  >("pools", pairId ? [pairId] : undefined, !!pairId);

  return useMemo<PoolInfo | null>(() => {
    if (!poolData) return null;
    return {
      token0: poolData[0] as `0x${string}`,
      token1: poolData[1] as `0x${string}`,
      reserve0: poolData[2],
      reserve1: poolData[3],
      totalLP: poolData[4],
      volume24h: poolData[5],
      totalVolume: poolData[6],
      lastVolumeReset: poolData[7],
      createdAt: poolData[8],
    };
  }, [poolData]);
}

export function usePoolByTokens(
  token0: `0x${string}` | undefined,
  token1: `0x${string}` | undefined,
) {
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    token0 && token1 ? [token0, token1] : undefined,
    !!token0 && !!token1,
  );
  const pool = usePoolInfo(pairId);
  return { pairId, pool };
}

// ============================================================
// Rewards
// ============================================================

export function useDexStats() {
  const { data: totalNUSDLocked, isLoading: loadingNUSD } = useRewardRead<bigint>("totalNUSDLocked");
  const { data: totalRewardPool, isLoading: loadingReward } = useRewardRead<bigint>("totalRewardPool");
  const { data: accRewardPerNUSD, isLoading: loadingAcc } = useRewardRead<bigint>("accRewardPerNUSD");
  const { data: swapFee, isLoading: loadingFee } = useDexRead<bigint>("swapFee");

  const isLoading = loadingNUSD || loadingReward || loadingAcc || loadingFee;

  return useMemo(
    () => ({
      totalNUSDLocked: totalNUSDLocked ?? 0n,
      totalRewardPool: totalRewardPool ?? 0n,
      accRewardPerNUSD: accRewardPerNUSD ?? 0n,
      swapFee: swapFee ?? 0n,
      loading: isLoading,
    }),
    [totalNUSDLocked, totalRewardPool, accRewardPerNUSD, swapFee, isLoading],
  );
}

// ============================================================
// Swap quote (local constant-product math matching contract)
// ============================================================

export function useSwapQuote(
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountIn: string,
  swapFeeBps: bigint = 10n,
) {
  const amountInFormatted = useMemo(() => {
    if (!amountIn || !tokenIn) return 0n;
    try {
      return parseUnits(amountIn, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountIn, tokenIn]);

  const { pairId, pool } = usePoolByTokens(
    tokenIn?.address,
    tokenOut?.address,
  );

  const quote = useMemo(() => {
    if (!pool || !tokenIn || !tokenOut || amountInFormatted === 0n) return null;
    if (pool.reserve0 === 0n || pool.reserve1 === 0n) return null;

    const isReversed = tokenIn.address !== pool.token0;
    const reserveIn = isReversed ? pool.reserve1 : pool.reserve0;
    const reserveOut = isReversed ? pool.reserve0 : pool.reserve1;

    const fee = (amountInFormatted * swapFeeBps) / 10000n;
    const amountInAfterFee = amountInFormatted - fee;
    const amountOut =
      (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

    const amountOutFormatted = formatUnits(amountOut, tokenOut.decimals);

    let priceImpact = 0;
    if (reserveIn > 0n) {
      const impactBp = Number((amountInFormatted * 10000n) / reserveIn);
      priceImpact = impactBp / 100;
    }

    return {
      amountOut,
      amountOutFormatted,
      priceImpact,
      fee,
      pairId: pairId!,
    };
  }, [amountInFormatted, tokenIn, tokenOut, pool, pairId, swapFeeBps]);

  return quote;
}

// ============================================================
// Realtime price from contract events — instant, no subgraph delay
// ============================================================

export interface RealtimePrice {
  price: number;       // NUSD per Token (matches chart convention)
  rawAmountIn: string;
  rawAmountOut: string;
  timestamp: number;
}

export interface SwappedEvent {
  args: {
    user: `0x${string}`;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn: bigint;
    amountOut: bigint;
    fee: bigint;
  } | undefined;
  blockNumber: bigint;
}

type CachedSwappedEvent = {
  args?: {
    user: `0x${string}`;
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
    amountIn: string;
    amountOut: string;
    fee: string;
  };
  blockNumber: string;
};

function realtimePriceCacheKey(token0?: string, token1?: string) {
  if (!token0 || !token1) return "";
  return `rtprice:${token0.toLowerCase()}:${token1.toLowerCase()}`;
}

function readRealtimeEvents(cacheKey: string, lookback: number): SwappedEvent[] {
  if (!cacheKey || typeof window === "undefined") return [];
  try {
    const cached = sessionStorage.getItem(cacheKey);
    if (!cached) return [];
    const parsed = JSON.parse(cached) as CachedSwappedEvent[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, lookback).flatMap((event) => {
      try {
        return [{
          args: event.args
            ? {
                ...event.args,
                amountIn: BigInt(event.args.amountIn),
                amountOut: BigInt(event.args.amountOut),
                fee: BigInt(event.args.fee),
              }
            : undefined,
          blockNumber: BigInt(event.blockNumber),
        } satisfies SwappedEvent];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function writeRealtimeEvents(cacheKey: string, events: SwappedEvent[]) {
  if (!cacheKey || typeof window === "undefined") return;
  const serialized: CachedSwappedEvent[] = events.slice(0, 20).map((event) => ({
    args: event.args
      ? {
          ...event.args,
          amountIn: event.args.amountIn.toString(),
          amountOut: event.args.amountOut.toString(),
          fee: event.args.fee.toString(),
        }
      : undefined,
    blockNumber: event.blockNumber.toString(),
  }));
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify(serialized));
  } catch {}
}

/**
 * Watch live Swapped events on the DEX contract and derive the realtime price.
 * Updates instantly when any swap occurs — no subgraph delay.
 *
 * Price is always quoted as token0_per_token1 (Token per NUSD when token0=NUSD).
 *
 * @param token0  First token address (e.g. NUSD)
 * @param token1  Second token address (e.g. zkLTC)
 * @param lookback Number of recent events to keep in history (default 50)
 */
export function useRealtimePrice(
  token0: `0x${string}` | undefined,
  token1: `0x${string}` | undefined,
  lookback = 50,
  token0Decimals = 18,
  token1Decimals = 18,
) {
  const cacheKey = realtimePriceCacheKey(token0, token1);
  const loadedCacheKeyRef = useRef(cacheKey);
  const [events, setEvents] = useState<SwappedEvent[]>(() => readRealtimeEvents(cacheKey, lookback));

  useEffect(() => {
    if (loadedCacheKeyRef.current === cacheKey) return;
    loadedCacheKeyRef.current = cacheKey;
    setEvents(readRealtimeEvents(cacheKey, lookback));
  }, [cacheKey, lookback]);

  useWatchContractEvent({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    eventName: "Swapped",
    enabled: Boolean(token0 && token1),
    onLogs: (logs) => {
      if (!token0 || !token1) return;
      const t0 = token0.toLowerCase();
      const t1 = token1.toLowerCase();
      const relevantLogs = logs.filter((log) => {
        const args = log.args as SwappedEvent["args"];
        if (!args) return false;
        const tokenIn = args.tokenIn.toLowerCase();
        const tokenOut = args.tokenOut.toLowerCase();
        return (
          (tokenIn === t0 && tokenOut === t1) ||
          (tokenIn === t1 && tokenOut === t0)
        );
      });
      if (relevantLogs.length === 0) return;
      setEvents((prev) => {
        const updated = [
          ...relevantLogs.map((log) => ({
            args: log.args as SwappedEvent["args"],
            blockNumber: log.blockNumber,
          })),
          ...prev,
        ].slice(0, lookback);

        // Persist to sessionStorage for instant restore on next mount
        if (updated.length > 0) writeRealtimeEvents(cacheKey, updated);

        return updated;
      });
    },
  });

  // Derive the latest price from the newest event involving these two tokens
  const latest = useMemo<RealtimePrice | null>(() => {
    if (!token0 || !token1) return null;
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();
    const event = events.find(
      (e) =>
        e.args &&
        ((e.args.tokenIn.toLowerCase() === t0 && e.args.tokenOut.toLowerCase() === t1) ||
          (e.args.tokenIn.toLowerCase() === t1 && e.args.tokenOut.toLowerCase() === t0)),
    );
    if (!event?.args) return null;
    const { tokenIn, amountIn, amountOut } = event.args;
    if (amountIn <= 0n || amountOut <= 0n) return null;

    // Price always = token1_per_token0 regardless of swap direction
    // Forward (token0→token1): price = ao/ai
    // Reverse (token1→token0): price = ai/ao
    let quoteAmount: number;
    let baseAmount: number;
    if (tokenIn.toLowerCase() === t0) {
      quoteAmount = Number(formatUnits(amountOut, token1Decimals));
      baseAmount = Number(formatUnits(amountIn, token0Decimals));
    } else {
      quoteAmount = Number(formatUnits(amountIn, token1Decimals));
      baseAmount = Number(formatUnits(amountOut, token0Decimals));
    }
    const price = quoteAmount / baseAmount;
    if (!isFinite(price) || price <= 0) return null;
    return {
      price,
      rawAmountIn: amountIn.toString(),
      rawAmountOut: amountOut.toString(),
      timestamp: Number(event.blockNumber),
    };
  }, [events, token0, token1, token0Decimals, token1Decimals]);

  return { latestPrice: latest, recentEvents: events };
}
