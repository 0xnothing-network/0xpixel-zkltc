"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useAccount, useReadContracts, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther } from "viem";
import { PMINING_CONTRACT_ADDRESS, NTOKEN_ADDRESS, getPMExplorerUrl } from "@/lib/pmContract";
import { PMiningAbi } from "@/lib/pmAbi";
import { useToast } from "@/components/Toast";

const ERC20_ABI = [
  {
    type: "function",
    name: "approve",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
  {
    type: "function",
    name: "allowance",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const SCAN_RANGE = 200;

export default function PMMarketplace() {
  const { address, isConnected } = useAccount();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [checkRange, setCheckRange] = useState<bigint[]>([]);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    setCheckRange(Array.from({ length: SCAN_RANGE }, (_, i) => BigInt(i + 1)));
  }, []);

  const { data: firstPrice } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "FIRST_MACHINE_PRICE",
  });

  const { data: normalPrice } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "NORMAL_MACHINE_PRICE",
  });

  const { data: totalRewardPool } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "totalRewardPool",
  });

  const { data: userRigCount } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "userRigCount",
    args: [address!],
    query: { enabled: !!address },
  });

  const { data: rigStatuses } = useReadContracts({
    allowFailure: true,
    contracts: checkRange.flatMap((nftId) => [
      {
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "isRigDeposited",
        args: [nftId],
      },
      {
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "rigOwner",
        args: [nftId],
      },
    ]),
  });

  const availableRigs = useMemo(() => {
    if (!rigStatuses) return [];
    const out: bigint[] = [];
    for (let i = 0; i < checkRange.length; i++) {
      const isDeposited = rigStatuses[i * 2]?.result as boolean | undefined;
      const owner = rigStatuses[i * 2 + 1]?.result as string | undefined;
      if (isDeposited === true && (!owner || owner === "0x0000000000000000000000000000000000000000")) {
        out.push(checkRange[i]);
      }
    }
    return out;
  }, [rigStatuses, checkRange]);

  const isFirstRig = !userRigCount || userRigCount === 0n;
  const priceForUser = isFirstRig ? firstPrice : normalPrice;

  const { data: nAllowance, refetch: refetchAllowance } = useReadContract({
    address: NTOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [address!, PMINING_CONTRACT_ADDRESS],
    query: { enabled: !!address && priceForUser !== undefined },
  });

  const {
    writeContractAsync,
    isPending: isWritePending,
    data: txHash,
  } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (isConfirmed) {
      toast.show({
        title: "Rig purchased",
        description: "You are now the owner of this rig.",
        href: txHash ? getPMExplorerUrl(`tx/${txHash}`) : undefined,
        hrefLabel: "View on Explorer",
      });
      refetchAllowance();
    }
  }, [isConfirmed, txHash, toast, refetchAllowance]);

  const handleBuy = useCallback(async (nftId: bigint) => {
    if (!isConnected) {
      toast.warning("Connect wallet", "Please connect your wallet first.");
      return;
    }
    if (!priceForUser) {
      toast.error("Price not loaded", "Please try again in a moment.");
      return;
    }
    if (nAllowance !== undefined && nAllowance < priceForUser) {
      try {
        toast.info("Approving N token", "Please confirm the approval transaction first.");
        await writeContractAsync({
          address: NTOKEN_ADDRESS,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [PMINING_CONTRACT_ADDRESS, priceForUser],
        });
        await refetchAllowance();
      } catch (err) {
        toast.handleError(err, "Approval failed");
        return;
      }
    }
    try {
      const hash = await writeContractAsync({
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "buyRig",
        args: [nftId],
      });
      toast.show({
        title: "Purchase submitted",
        description: "Waiting for confirmation...",
        href: getPMExplorerUrl(`tx/${hash}`),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Purchase failed");
    }
  }, [isConnected, priceForUser, nAllowance, writeContractAsync, refetchAllowance, toast]);

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="h-8 w-48 bg-[#2D2D44] rounded animate-pulse" />
          <div className="h-16 w-32 bg-[#2D2D44] rounded animate-pulse" />
        </div>
        <div className="h-64 bg-[#1A1A2E] rounded-xl border border-[#2D2D44] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Rig Marketplace</h1>
          <p className="text-[#94A3B8] text-sm mt-1">
            {availableRigs.length} available {availableRigs.length === 1 ? "rig" : "rigs"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[#64748B] text-xs">First rig</p>
          <p className="text-white font-bold text-sm">{firstPrice ? formatEther(firstPrice) : "—"} N</p>
          <p className="text-[#64748B] text-xs mt-1">Subsequent</p>
          <p className="text-white font-bold text-sm">{normalPrice ? formatEther(normalPrice) : "—"} N</p>
        </div>
      </div>

      {isConnected && priceForUser !== undefined && (
        <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl px-4 py-3 text-sm">
          <span className="text-[#94A3B8]">Your price: </span>
          <span className="text-white font-bold">{formatEther(priceForUser)} N</span>
          <span className="text-[#64748B] ml-2">
            {isFirstRig ? "(your first rig)" : `(${userRigCount?.toString() || 0} owned)`}
          </span>
        </div>
      )}

      {availableRigs.length === 0 ? (
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-8 text-center">
          <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          </div>
          <h2 className="text-white font-bold text-lg mb-2">No Rigs Available</h2>
          <p className="text-[#94A3B8] text-sm max-w-md mx-auto">
            No rigs are for sale right now. The dev can deposit more in the Admin Panel.
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {availableRigs.map((nftId) => (
            <div key={nftId.toString()} className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] overflow-hidden hover:border-indigo-500/40 transition-colors">
              <div className="aspect-square bg-gradient-to-br from-indigo-500/20 via-purple-500/10 to-[#0F0F23] flex items-center justify-center relative">
                <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 opacity-30">
                  {Array.from({ length: 64 }).map((_, i) => (
                    <div key={i} className="border border-indigo-500/10" />
                  ))}
                </div>
                <div className="relative text-center">
                  <svg className="w-12 h-12 text-indigo-400 mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 7.5l-9-5.25L3 7.5m18 0l-9 5.25m9-5.25v9l-9 5.25M3 7.5l9 5.25M3 7.5v9l9 5.25m0-9v9" />
                  </svg>
                  <p className="text-[#64748B] text-[10px]">NFT</p>
                  <p className="text-white font-bold text-lg">#{nftId.toString()}</p>
                </div>
              </div>
              <div className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] uppercase tracking-wider text-emerald-400 font-bold">Available</span>
                  <span className="text-[10px] text-[#64748B]">Lvl 1 • 24 N/day</span>
                </div>
                <button
                  onClick={() => handleBuy(nftId)}
                  disabled={!isConnected || isWritePending || isConfirming || !priceForUser}
                  className="w-full pixel-btn pixel-btn-primary py-2.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isWritePending || isConfirming
                    ? "Processing..."
                    : `Buy for ${priceForUser ? formatEther(priceForUser) : "—"} N`}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3">
        <div className="bg-[#0F0F23] rounded-lg px-4 py-2">
          <p className="text-[#64748B] text-xs">Reward pool</p>
          <p className="text-white font-bold">{totalRewardPool ? formatEther(totalRewardPool) : "—"} N</p>
        </div>
        <div className="bg-[#0F0F23] rounded-lg px-4 py-2">
          <p className="text-[#64748B] text-xs">Available rigs</p>
          <p className="text-white font-bold">{availableRigs.length}</p>
        </div>
      </div>
    </div>
  );
}
