"use client";

import {
  useReadContract,
  useReadContracts,
  useWriteContract,
  useAccount,
  useBalance,
} from "wagmi";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useCallback, useMemo } from "react";
import {
  DEX_ABI,
  DEX_ADDRESS,
  NATIVE_ADDRESS,
  PoolInfo,
} from "./0xDexAbi";

const MaxUint256 =
  115792089237316195423570985008687907853269984665640564039457584007913129639935n;

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
    address: "0x6ffB02fa705A0DB3c8EbB31A63EdFE62c103363D",
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
      address: DEX_ADDRESS,
      abi: DEX_ABI,
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

export function useApproveToken() {
  const { writeContract, isPending } = useWriteContract();

  return useCallback(
    (token: Token, _amount: bigint) => {
      if (token.address === NATIVE_ADDRESS) return;
      try {
        writeContract({
          address: token.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [DEX_ADDRESS, MaxUint256],
        });
      } catch (err) {
        console.error("Approve error:", err);
      }
    },
    [writeContract],
  );
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
        token0: (info?.[0] ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
        token1: (info?.[1] ?? "0x0000000000000000000000000000000000000000") as `0x${string}`,
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
  // New ABI returns [token0, token1, reserve0, reserve1, totalLP, volume24h, totalVolume, lastVolumeReset]
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
  return useDexRead<bigint>(
    "getPrice",
    tokenIn && tokenOut ? [tokenIn, tokenOut] : undefined,
  );
}

// ============================================================
// Rewards
// ============================================================

export function useUserPendingReward() {
  const { address } = useAccount();
  return useDexRead<bigint>(
    "getUserPendingReward",
    address ? [address] : undefined,
  );
}

export function useUserNUSDLocked() {
  const { address } = useAccount();
  return useDexRead<bigint>(
    "userNUSDLocked",
    address ? [address] : undefined,
  );
}

export function useDexStats() {
  const { data: totalNUSDLocked } = useDexRead<bigint>("totalNUSDLocked");
  const { data: totalRewardPool } = useDexRead<bigint>("totalRewardPool");
  const { data: accRewardPerNUSD } = useDexRead<bigint>("accRewardPerNUSD");
  const { data: swapFee } = useDexRead<bigint>("swapFee");

  return useMemo(
    () => ({
      totalNUSDLocked: totalNUSDLocked ?? 0n,
      totalRewardPool: totalRewardPool ?? 0n,
      accRewardPerNUSD: accRewardPerNUSD ?? 0n,
      swapFee: swapFee ?? 0n,
    }),
    [totalNUSDLocked, totalRewardPool, accRewardPerNUSD, swapFee],
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

  return useMemo(() => {
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
      // impact = amountIn / reserveIn * 100 (approximate)
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
  }, [pool, amountInFormatted, tokenIn, tokenOut, swapFeeBps, pairId]);
}
