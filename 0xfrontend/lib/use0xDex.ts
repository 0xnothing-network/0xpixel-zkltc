"use client";

import { useReadContract, useWriteContract, useWaitForTransactionReceipt, useAccount, useChainId, useBalance } from "wagmi";
import { DEX_ABI, DEX_ADDRESS, PoolInfo } from "./0xDexContract";
import { NATIVE_ADDRESS } from "./0xDexContract";
import { erc20Abi, formatUnits, parseUnits } from "viem";

const MaxUint256 = 115792089237316195423570985008687907853269984665640564039457584007913129639935n;
import { LITVM_CHAIN_ID } from "./chainSwitch";
import { useCallback, useMemo } from "react";

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
    address: "0xC1F96C07D3EAbd25b080522aE85DaaA978192EC0",
    symbol: "NUSD",
    decimals: 18,
    name: "NUSD Stablecoin",
    logo: "/NUSD_LOGO.jpg",
  },
];

export function useDexRead<T = unknown>(functionName: string, args?: readonly unknown[]) {
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

export function useDexWrite() {
  const { writeContract } = useWriteContract();
  
  const addLiquidity = useCallback(
    (tokenA: `0x${string}`, tokenB: `0x${string}`, amountA: bigint, amountB: bigint) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "addLiquidity",
        args: [tokenA, tokenB, amountA, amountB],
        value: tokenA === NATIVE_ADDRESS ? amountA : tokenB === NATIVE_ADDRESS ? amountB : undefined,
      });
    },
    [writeContract]
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
    [writeContract]
  );

  const swap = useCallback(
    (tokenIn: `0x${string}`, tokenOut: `0x${string}`, amountIn: bigint, minAmountOut: bigint) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "swap",
        args: [tokenIn, tokenOut, amountIn, minAmountOut],
        value: tokenIn === NATIVE_ADDRESS ? amountIn : undefined,
      });
    },
    [writeContract]
  );

  const claimReward = useCallback(() => {
    return writeContract({
      address: DEX_ADDRESS,
      abi: DEX_ABI,
      functionName: "claimReward",
      args: [],
    });
  }, [writeContract]);

  const createPool = useCallback(
    (tokenA: `0x${string}`, tokenB: `0x${string}`, amountA: bigint, amountB: bigint) => {
      return writeContract({
        address: DEX_ADDRESS,
        abi: DEX_ABI,
        functionName: "addLiquidity",
        args: [tokenA, tokenB, amountA, amountB],
        value: tokenA === NATIVE_ADDRESS || tokenB === NATIVE_ADDRESS ? amountA + amountB : undefined,
      });
    },
    [writeContract]
  );

  return { addLiquidity, removeLiquidity, swap, claimReward, createPool };
}

export function useTokenBalance(address: `0x${string}` | undefined, token: Token | null): { data: bigint | undefined } {
  const isNative = token?.address === NATIVE_ADDRESS;
  const { data: nativeBalance } = useBalance({ address });
  const { data: erc20Balance } = useReadContract({
    address: isNative ? undefined : token?.address as `0x${string}` | undefined,
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
    (token: Token, amount: bigint) => {
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
    [writeContract]
  );
}

export function useAllPools() {
  return useDexRead<`0x${string}`[]>("getAllPools");
}

export function usePoolInfo(token0: `0x${string}`, token1: `0x${string}`) {
  const { data: pairId } = useDexRead<`0x${string}`>("getPairId", [token0, token1]);
  
  return useDexRead<PoolInfo>("getPoolInfo", pairId ? [pairId] : undefined);
}

export function useUserPendingReward() {
  const { address } = useAccount();
  return useDexRead<bigint>("getUserPendingReward", address ? [address] : undefined);
}

export function useDexStats() {
  const { data: totalNUSDLocked } = useDexRead<bigint>("totalNUSDLocked");
  const { data: totalRewardPool } = useDexRead<bigint>("totalRewardPool");
  const { data: accRewardPerNUSD } = useDexRead<bigint>("accRewardPerNUSD");
  
  return useMemo(() => ({
    totalNUSDLocked: totalNUSDLocked ?? 0n,
    totalRewardPool: totalRewardPool ?? 0n,
    accRewardPerNUSD: accRewardPerNUSD ?? 0n,
  }), [totalNUSDLocked, totalRewardPool, accRewardPerNUSD]);
}

export function useDexOwner() {
  const { address } = useAccount();
  const { data: owner } = useDexRead<`0x${string}`>("owner");
  
  return useMemo(() => ({
    isOwner: !!owner && !!address && owner.toLowerCase() === address.toLowerCase(),
    owner,
  }), [owner, address]);
}

export function useDexPoolStats(pairId: `0x${string}`) {
  const { data: poolData } = useDexRead<readonly [string, string, bigint, bigint, bigint, bigint, bigint, bigint]>("pools", [pairId]);
  
  if (!poolData) return null;
  
  return {
    token0: poolData[0] as `0x${string}`,
    token1: poolData[1] as `0x${string}`,
    reserve0: poolData[2] as bigint,
    reserve1: poolData[3] as bigint,
    totalLP: poolData[4] as bigint,
    volume24h: poolData[5] as bigint,
    totalVolume: poolData[6] as bigint,
  };
}

export function useSwapQuote(
  tokenIn: Token | null,
  tokenOut: Token | null,
  amountIn: string
) {
  const amountInFormatted = useMemo(() => {
    if (!amountIn || !tokenIn) return 0n;
    try {
      return parseUnits(amountIn, tokenIn.decimals);
    } catch {
      return 0n;
    }
  }, [amountIn, tokenIn]);

  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    tokenIn && tokenOut ? [tokenIn.address, tokenOut.address] : undefined
  );

  const { data: poolData } = useDexRead<readonly [string, string, bigint, bigint, bigint, bigint, bigint, bigint]>("pools", pairId ? [pairId] : undefined);

  return useMemo(() => {
    if (!poolData || amountInFormatted === 0n) return null;

    const [token0, token1, reserve0, reserve1] = poolData as [string, string, bigint, bigint, bigint, bigint, bigint, bigint];
    const isReversed = tokenIn!.address !== token0;

    const reserveIn = isReversed ? reserve1 : reserve0;
    const reserveOut = isReversed ? reserve0 : reserve1;

    const fee = amountInFormatted * 100n / 10000n;
    const amountInAfterFee = amountInFormatted - fee;
    const amountOut = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

    const amountOutFormatted = formatUnits(amountOut, tokenOut!.decimals);

    return {
      amountOut,
      amountOutFormatted,
      priceImpact: Number(amountInFormatted) / Number(reserveIn) * 100,
      fee,
    };
  }, [poolData, amountInFormatted, tokenIn, tokenOut]);
}

// Auto-refresh hook for real-time data updates
export function useDexAutoRefresh(enabled = true) {
  const { data: blockNumber } = useReadContract({
    address: DEX_ADDRESS,
    abi: DEX_ABI,
    functionName: "totalRewardPool", // any view function to track blocks
    query: { enabled },
  });

  return { blockNumber, refetchKey: blockNumber };
}
