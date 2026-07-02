"use client";

import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  useAccount,
  useBalance,
  useWatchContractEvent,
} from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
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
) {
  const result = useReadContract({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    functionName: functionName as never,
    args: args as never,
  });

  return {
    ...result,
    data: result.data as T | undefined,
  };
}

export function useRewardRead<T = unknown>(
  functionName: string,
  args?: readonly unknown[],
) {
  const result = useReadContract({
    address: REWARD_MANAGER_ADDRESS,
    abi: REWARD_MANAGER_ABI,
    functionName: functionName as never,
    args: args as never,
  });

  return {
    ...result,
    data: result.data as T | undefined,
  };
}

// ============================================================
// Write hooks
// ============================================================

export function useDexWrite() {
  const { writeContract } = useWriteContract();

  const addLiquidity = useCallback(
    (
      tokenA: `0x${string}`,
      tokenB: `0x${string}`,
      amountA: bigint,
      amountB: bigint,
    ) => {
      return writeContract({
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
    [writeContract],
  );

  const removeLiquidity = useCallback(
    (pairId: `0x${string}`, lpAmount: bigint) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "removeLiquidity",
        args: [pairId, lpAmount],
      });
    },
    [writeContract],
  );

  const swap = useCallback(
    (
      tokenIn: `0x${string}`,
      tokenOut: `0x${string}`,
      amountIn: bigint,
      minAmountOut: bigint,
    ) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "swap",
        args: [tokenIn, tokenOut, amountIn, minAmountOut],
        value: tokenIn === NATIVE_ADDRESS ? amountIn : undefined,
      });
    },
    [writeContract],
  );

  const claimReward = useCallback(() => {
    return writeContract({
      address: REWARD_MANAGER_ADDRESS,
      abi: REWARD_MANAGER_ABI,
      functionName: "claimReward",
      args: [],
    });
  }, [writeContract]);

  const setSwapFee = useCallback(
    (newFee: bigint) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "setSwapFee",
        args: [newFee],
      });
    },
    [writeContract],
  );

  return { addLiquidity, removeLiquidity, swap, claimReward, setSwapFee };
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

  return { ...result, refetch: result.refetch };
}

// ============================================================
// Pools
// ============================================================

export function useAllPools() {
  const { data: pairIds, ...rest } = useDexRead<readonly `0x${string}`[]>(
    "getAllPools",
  );

  const { data: poolInfos } = useReadContracts({
    contracts:
      pairIds?.map((pairId) => ({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "pools" as const,
        args: [pairId] as const,
      })) ?? [],
    query: { enabled: !!pairIds && pairIds.length > 0 },
  });

  type PoolTuple = readonly [
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

  const result = useMemo<
    | { pairId: `0x${string}`; token0: `0x${string}`; token1: `0x${string}` }[]
    | undefined
  >(() => {
    if (!pairIds) return undefined;
    return pairIds.map((pairId, i) => {
      const info = poolInfos?.[i]?.result as PoolTuple | undefined;
      return {
        pairId,
        token0: (info?.[0] ?? NATIVE_ADDRESS) as `0x${string}`,
        token1: (info?.[1] ?? NATIVE_ADDRESS) as `0x${string}`,
      };
    });
  }, [pairIds, poolInfos]);

  return {
    ...rest,
    data: result,
  };
}

export function usePoolExists(pairId: `0x${string}` | undefined) {
  return useDexRead<boolean>("poolExists", pairId ? [pairId] : undefined);
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
  >("pools", pairId ? [pairId] : undefined);

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
  );
  const pool = usePoolInfo(pairId);
  return { pairId, pool };
}

export function usePoolPriceInfo(pairId: `0x${string}` | undefined) {
  return useDexRead<readonly [bigint, bigint, bigint, bigint]>(
    "getPoolPriceInfo",
    pairId ? [pairId] : undefined,
  );
}

export function useSpotPrice(tokenIn: `0x${string}` | undefined, tokenOut: `0x${string}` | undefined) {
  const { data: pairId, isLoading: loadingPair, error: pairError } = useDexRead<`0x${string}`>(
    "getPairId",
    tokenIn && tokenOut ? [tokenIn, tokenOut] : undefined,
  );
  const { data: poolData, isLoading: loadingPool, error: poolError } = useDexRead<
    readonly [
      `0x${string}`,
      `0x${string}`,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ]
  >("pools", pairId ? [pairId] : undefined);

  const data = useMemo(() => {
    if (!poolData || !tokenIn || poolData[2] === 0n || poolData[3] === 0n) return undefined;
    return tokenIn.toLowerCase() === poolData[0].toLowerCase()
      ? (poolData[2] * 10n ** 18n) / poolData[3]
      : (poolData[3] * 10n ** 18n) / poolData[2];
  }, [poolData, tokenIn]);

  return {
    data,
    isLoading: loadingPair || loadingPool,
    error: pairError || poolError,
  };
}

// ============================================================
// Rewards
// ============================================================

export function useUserPendingReward() {
  const { address } = useAccount();
  return useRewardRead<bigint>(
    "getUserPendingReward",
    address ? [address] : undefined,
  );
}

export function useUserNUSDLocked() {
  const { address } = useAccount();
  return useRewardRead<bigint>(
    "userNUSDLocked",
    address ? [address] : undefined,
  );
}

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

export function useDexOwner() {
  const { address } = useAccount();
  const { data: owner } = useDexRead<`0x${string}`>("owner");

  return useMemo(
    () => ({
      isOwner: !!owner && !!address && owner.toLowerCase() === address.toLowerCase(),
      owner,
    }),
    [owner, address],
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
) {
  const [events, setEvents] = useState<SwappedEvent[]>(() => {
    // Restore from sessionStorage cache immediately (instant on mount)
    if (typeof window !== 'undefined' && token0 && token1) {
      const t0 = token0.toLowerCase();
      const t1 = token1.toLowerCase();
      const ck = `rtprice:${t0}:${t1}`;
      try {
        const cached = sessionStorage.getItem(ck);
        if (cached) {
          const parsed = JSON.parse(cached) as SwappedEvent[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {}
    }
    return [];
  });

  useWatchContractEvent({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    eventName: "Swapped",
    onLogs: (logs) => {
      setEvents((prev) => {
        const updated = [
          ...logs.map((log) => ({
            args: log.args as SwappedEvent["args"],
            blockNumber: log.blockNumber,
          })),
          ...prev,
        ].slice(0, lookback);

        // Persist to sessionStorage for instant restore on next mount
        if (token0 && token1 && updated.length > 0) {
          const t0 = token0.toLowerCase();
          const t1 = token1.toLowerCase();
          const ck = `rtprice:${t0}:${t1}`;
          try {
            sessionStorage.setItem(ck, JSON.stringify(updated.slice(0, 20)));
          } catch {}
        }

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
    const ai = Number(amountIn);
    const ao = Number(amountOut);
    if (ai <= 0 || ao <= 0) return null;

    // Price always = token1_per_token0 regardless of swap direction
    // Forward (token0→token1): price = ao/ai
    // Reverse (token1→token0): price = ai/ao
    let price: number;
    if (tokenIn.toLowerCase() === t0) {
      price = ai > 0 ? ao / ai : 0; // forward: token0 in, token1 out
    } else {
      price = ao > 0 ? ai / ao : 0; // reverse: token1 in, token0 out
    }
    if (!isFinite(price) || price <= 0) return null;
    return {
      price,
      rawAmountIn: amountIn.toString(),
      rawAmountOut: amountOut.toString(),
      timestamp: Number(event.blockNumber),
    };
  }, [events, token0, token1]);

  return { latestPrice: latest, recentEvents: events };
}

/**
 * Subscribe to realtime price updates for a token pair and call onUpdate
 * whenever the price changes (with optional throttle in ms).
 */
export function useRealtimePriceCallback(
  token0: `0x${string}` | undefined,
  token1: `0x${string}` | undefined,
  onUpdate: (price: number) => void,
  throttleMs = 100,
) {
  const { latestPrice } = useRealtimePrice(token0, token1);
  const lastUpdateRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!latestPrice) return;
    const now = Date.now();
    if (now - lastUpdateRef.current < throttleMs) {
      // Throttle: cancel pending and schedule new
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        lastUpdateRef.current = Date.now();
        onUpdate(latestPrice.price);
      }, throttleMs);
    } else {
      lastUpdateRef.current = now;
      onUpdate(latestPrice.price);
    }
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [latestPrice, throttleMs, onUpdate]);
}
