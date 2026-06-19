"use client";

import { useState, useCallback } from "react";
import { useEffect } from "react";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther } from "viem";
import { PMINING_CONTRACT_ADDRESS, NTOKEN_ADDRESS, getPMExplorerUrl } from "@/lib/pmContract";
import { PMiningAbi } from "@/lib/pmAbi";
import { useToast } from "@/components/Toast";

export default function PMAdmin() {
  const { address } = useAccount();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const [depositNftId, setDepositNftId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");

  useEffect(() => { setMounted(true); }, []);

  const { data: owner } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "owner",
  });

  const { data: devWallet } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "devWallet",
  });

  const { data: totalRewardPool } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "totalRewardPool",
  });

  const {
    writeContractAsync,
    isPending: isWritePending,
    data: txHash,
  } = useWriteContract();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const isDev = address?.toLowerCase() === (owner as string | undefined)?.toLowerCase();

  const handleDepositRig = useCallback(async () => {
    const nftId = parseInt(depositNftId);
    if (isNaN(nftId) || nftId <= 0) {
      toast.warning("Invalid NFT ID", "Please enter a valid NFT ID number.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "depositRig",
        args: [BigInt(nftId)],
      });
      toast.show({
        title: "Rig deposited",
        description: `NFT #${nftId} has been deposited.`,
        href: getPMExplorerUrl(`tx/${hash}`),
        hrefLabel: "View on Explorer",
      });
      setDepositNftId("");
    } catch (err) {
      toast.handleError(err, "Deposit failed");
    }
  }, [depositNftId, writeContractAsync, toast]);

  const handleDepositPool = useCallback(async () => {
    const amount = depositAmount.trim();
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      toast.warning("Invalid amount", "Please enter a valid N token amount.");
      return;
    }
    try {
      // First approve
      const amountWei = parseEther(amount);
      await writeContractAsync({
        address: NTOKEN_ADDRESS,
        abi: [{ type: "function", name: "approve", inputs: [
          { name: "spender", type: "address" },
          { name: "amount", type: "uint256" },
        ], outputs: [], stateMutability: "nonpayable" }],
        functionName: "approve",
        args: [PMINING_CONTRACT_ADDRESS, amountWei],
      });
      const hash = await writeContractAsync({
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "depositRewardPool",
        args: [amountWei],
      });
      toast.show({
        title: "Pool deposited",
        description: `${amount} N has been added to reward pool.`,
        href: getPMExplorerUrl(`tx/${hash}`),
        hrefLabel: "View on Explorer",
      });
      setDepositAmount("");
    } catch (err) {
      toast.handleError(err, "Deposit pool failed");
    }
  }, [depositAmount, writeContractAsync, toast]);

  const handleWithdrawFees = useCallback(async () => {
    try {
      const hash = await writeContractAsync({
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "withdrawDevFees",
        args: [],
      });
      toast.show({
        title: "Fees withdrawn",
        description: "Dev fees have been withdrawn.",
        href: getPMExplorerUrl(`tx/${hash}`),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Withdraw failed");
    }
  }, [writeContractAsync, toast]);

  if (!mounted) {
    return <div className="h-96 animate-pulse bg-[#1A1A2E] rounded-xl" />;
  }

  if (!isDev) {
    return (
      <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-8 text-center">
        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-white font-bold text-lg mb-2">Access Denied</h2>
        <p className="text-[#94A3B8] text-sm">Only the contract owner can access this panel.</p>
        {owner && (
          <p className="text-[#64748B] text-xs mt-3">
            Owner: {owner}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center">
          <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.397.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.505-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.149-.894z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Dev Panel</h1>
          <p className="text-[#94A3B8] text-sm">Manage the PMining contract</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4">
          <p className="text-[#64748B] text-xs mb-1">Total Reward Pool</p>
          <p className="text-white font-bold text-lg">{totalRewardPool ? formatEther(totalRewardPool) : "—"} N</p>
        </div>
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4">
          <p className="text-[#64748B] text-xs mb-1">Dev Wallet</p>
          <p className="text-white font-bold text-sm">{devWallet ? `${devWallet.slice(0,8)}...${devWallet.slice(-6)}` : "—"}</p>
        </div>
      </div>

      {/* Actions */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Deposit Rig */}
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-5">
          <h3 className="text-white font-bold text-sm mb-1">Deposit Rig</h3>
          <p className="text-[#64748B] text-xs mb-4">Deposit an NFT as a minable rig</p>
          <input
            type="number"
            value={depositNftId}
            onChange={(e) => setDepositNftId(e.target.value)}
            placeholder="NFT ID"
            className="w-full bg-[#0F0F23] border border-[#2D2D44] rounded-lg px-3 py-2 text-white text-xs mb-3 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleDepositRig}
            disabled={isWritePending || isConfirming || !depositNftId}
            className="w-full pixel-btn pixel-btn-primary py-2 text-xs disabled:opacity-50"
          >
            {isWritePending || isConfirming ? "Processing..." : "Deposit Rig"}
          </button>
        </div>

        {/* Deposit Reward Pool */}
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-5">
          <h3 className="text-white font-bold text-sm mb-1">Deposit Reward Pool</h3>
          <p className="text-[#64748B] text-xs mb-4">Add N tokens to reward pool</p>
          <input
            type="text"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            placeholder="Amount in N"
            className="w-full bg-[#0F0F23] border border-[#2D2D44] rounded-lg px-3 py-2 text-white text-xs mb-3 focus:outline-none focus:border-indigo-500"
          />
          <button
            onClick={handleDepositPool}
            disabled={isWritePending || isConfirming || !depositAmount}
            className="w-full pixel-btn pixel-btn-primary py-2 text-xs disabled:opacity-50"
          >
            {isWritePending || isConfirming ? "Processing..." : "Deposit to Pool"}
          </button>
        </div>

        {/* Withdraw Dev Fees */}
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-5">
          <h3 className="text-white font-bold text-sm mb-1">Withdraw Dev Fees</h3>
          <p className="text-[#64748B] text-xs mb-4">Withdraw accumulated dev fees</p>
          <button
            onClick={handleWithdrawFees}
            disabled={isWritePending || isConfirming}
            className="w-full pixel-btn pixel-btn-secondary py-2 text-xs disabled:opacity-50"
          >
            {isWritePending || isConfirming ? "Processing..." : "Withdraw Fees"}
          </button>
        </div>
      </div>
    </div>
  );
}
