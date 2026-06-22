"use client";

import { useReadContract, useWriteContract } from "wagmi";
import { parseUnits, MaxUint256, erc20Abi } from "viem";
import { useCallback } from "react";
import { DEX_ADDRESS } from "./0xDexContract";

export function useTokenApproval(
  tokenAddress: `0x${string}` | undefined,
  spenderAddress: `0x${string}` = DEX_ADDRESS
) {
  const { writeContract, writeContractAsync } = useWriteContract();

  const { data: allowance, refetch: refetchAllowance, isLoading: isLoadingAllowance } = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: "allowance",
    args: undefined,
    query: { enabled: false },
  });

  const checkAllowance = useCallback(
    (userAddress: `0x${string}` | undefined, amount: string, decimals: number) => {
      if (!allowance || !userAddress) return true;
      try {
        const amountBig = parseUnits(amount, decimals);
        return amountBig > (allowance as bigint);
      } catch {
        return true;
      }
    },
    [allowance]
  );

  const approve = useCallback(
    async (userAddress: `0x${string}` | undefined, amount: string, decimals: number): Promise<string | undefined> => {
      if (!userAddress || !tokenAddress) return undefined;

      try {
        const amountParsed = parseUnits(amount, decimals);
        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spenderAddress, amountParsed],
        });
        return hash;
      } catch (error) {
        console.error("Approve failed:", error);
        throw error;
      }
    },
    [writeContractAsync, spenderAddress, tokenAddress]
  );

  const approveMax = useCallback(
    async (userAddress: `0x${string}` | undefined): Promise<string | undefined> => {
      if (!userAddress || !tokenAddress) return undefined;

      try {
        const hash = await writeContractAsync({
          address: tokenAddress,
          abi: erc20Abi,
          functionName: "approve",
          args: [spenderAddress, MaxUint256],
        });
        return hash;
      } catch (error) {
        console.error("Approve max failed:", error);
        throw error;
      }
    },
    [writeContractAsync, spenderAddress, tokenAddress]
  );

  const approveMaxDirect = useCallback(() => {
    if (!tokenAddress) return;
    writeContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [spenderAddress, MaxUint256],
    });
  }, [writeContract, spenderAddress, tokenAddress]);

  return {
    allowance: allowance as bigint | undefined,
    refetchAllowance,
    isLoadingAllowance,
    checkAllowance,
    approve,
    approveMax,
    approveMaxDirect,
  };
}

export async function approveTokenMax(
  tokenAddress: `0x${string}`,
  spenderAddress: `0x${string}`,
  writeContractAsync: (params: any) => Promise<`0x${string}`>
): Promise<string | undefined> {
  try {
    const hash = await writeContractAsync({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "approve",
      args: [spenderAddress, MaxUint256],
    });
    return hash;
  } catch (error) {
    console.error("Approve max failed:", error);
    throw error;
  }
}
