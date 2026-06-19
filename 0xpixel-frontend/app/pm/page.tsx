"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther } from "viem";
import {
  PMINING_CONTRACT_ADDRESS,
  NTOKEN_ADDRESS,
  getPMExplorerUrl,
} from "@/lib/pmContract";
import { PMiningAbi } from "@/lib/pmAbi";
import { fetchTokenDataCached } from "@/lib/contract";
import { pixelDataToSVG } from "@/lib/gridParser";
import { useToast } from "@/components/Toast";

const CLAIM_COOLDOWN_SECONDS = 24 * 60 * 60;

const NTOKEN_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

type RigLevel = 1 | 2 | 3;

interface RigInfo {
  nftId: bigint;
  level: RigLevel;
  dailyProduction: bigint;
  nextClaimTime: bigint;
  imageUrl: string;
  name: string;
  ready: boolean;
  secondsLeft: number;
}

function useCountdownTick(intervalMs = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function formatHMS(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return { h, m, s, total: totalSeconds };
}

function RigImage({ imageUrl, level }: { imageUrl: string; level: RigLevel }) {
  const accent =
    level === 3 ? "from-fuchsia-500 to-pink-400" : level === 2 ? "from-indigo-500 to-purple-500" : "from-emerald-500 to-cyan-500";

  if (!imageUrl) {
    return (
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${accent} opacity-20`} />
        <svg viewBox="0 0 64 64" className="w-1/2 h-1/2 opacity-70" shapeRendering="crispEdges">
          <rect x="14" y="14" width="36" height="36" fill="currentColor" className="text-white" />
          <rect x="22" y="22" width="8" height="8" className="fill-black/40" />
          <rect x="34" y="22" width="8" height="8" className="fill-black/40" />
          <rect x="28" y="34" width="8" height="8" className="fill-black/40" />
          <rect x="28" y="46" width="8" height="4" className="fill-black/40" />
        </svg>
      </div>
    );
  }

  return (
    <div
      className="w-full h-full"
      style={{ backgroundImage: `url("${imageUrl}")`, backgroundSize: "contain", backgroundRepeat: "no-repeat", backgroundPosition: "center", imageRendering: "pixelated" }}
      dangerouslySetInnerHTML={{ __html: "" }}
    />
  );
}

function RigCard({
  rig,
  onClaim,
  claiming,
  onUpgrade,
  upgrading,
  nBalance,
  costL2,
  costL3,
}: {
  rig: RigInfo;
  onClaim: (id: bigint) => void;
  claiming: boolean;
  onUpgrade: (id: bigint) => void;
  upgrading: boolean;
  nBalance: bigint | null;
  costL2: bigint | null;
  costL3: bigint | null;
}) {
  const levelColor =
    rig.level === 3 ? "bg-fuchsia-500/15 border-fuchsia-500/40 text-fuchsia-300"
      : rig.level === 2 ? "bg-indigo-500/15 border-indigo-500/40 text-indigo-300"
      : "bg-emerald-500/15 border-emerald-500/40 text-emerald-300";

  const production = Number(formatEther(rig.dailyProduction));

  return (
    <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] overflow-hidden hover:border-indigo-500/40 transition-colors group">
      {/* Image - clean, no overlays */}
      <div className="aspect-square relative bg-[#0F0F23]">
        <RigImage imageUrl={rig.imageUrl} level={rig.level} />
      </div>

      {/* Body */}
      <div className="p-3.5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-white text-sm font-bold truncate">
              {rig.name || `Rig #${rig.nftId.toString()}`}
            </h3>
            <p className="text-[#64748B] text-[10px] mt-0.5 font-mono">#{rig.nftId.toString()}</p>
          </div>
          <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold border ${levelColor}`}>
            LV {rig.level}
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono">
          <span className="text-[#64748B]">Production</span>
          <span className="text-emerald-300 font-bold">+{production.toLocaleString()} N/day</span>
        </div>

        {rig.ready ? (
          <button
            onClick={() => onClaim(rig.nftId)}
            disabled={claiming}
            className="w-full py-2 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-black font-bold text-xs tracking-wider transition-all active:translate-y-px disabled:opacity-50"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            {claiming ? "CLAIMING…" : `CLAIM +${production.toLocaleString()} N`}
          </button>
        ) : (
          <Countdown secondsLeft={rig.secondsLeft} />
        )}

        {rig.level < 3 && (
          <DashboardUpgradeBtn
            rigId={rig.nftId}
            level={rig.level}
            nBalance={nBalance}
            onUpgrade={onUpgrade}
            upgrading={upgrading}
            costL2={costL2}
            costL3={costL3}
          />
        )}
      </div>
    </div>
  );
}

function DashboardUpgradeBtn({
  rigId,
  level,
  nBalance,
  onUpgrade,
  upgrading,
  costL2,
  costL3,
}: {
  rigId: bigint;
  level: RigLevel;
  nBalance: bigint | null;
  onUpgrade: (id: bigint) => void;
  upgrading: boolean;
  costL2: bigint | null;
  costL3: bigint | null;
}) {
  const nextLevel = (level + 1) as 2 | 3;
  const cost = nextLevel === 2 ? costL2 : costL3;
  const costNum = cost !== null ? Number(formatEther(cost)) : 0;
  const canAfford = nBalance !== null && cost !== null && nBalance >= cost;

  return (
    <button
      onClick={() => onUpgrade(rigId)}
      disabled={upgrading || !canAfford}
      title={canAfford ? `Upgrade to LV ${nextLevel}` : `Need ${costNum.toLocaleString()} N`}
      className={
        "w-full py-1.5 rounded-lg text-[10px] font-bold border transition-all flex items-center justify-center gap-1 " +
        (canAfford
          ? "bg-indigo-500/10 hover:bg-indigo-500/20 border-indigo-500/30 text-indigo-300"
          : "bg-[#0F0F23] border-[#2D2D44] text-[#4D4D64] cursor-not-allowed")
      }
    >
      <svg width="10" height="10" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path d="M7 17L17 7M17 7H8M17 7V16" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {upgrading ? "Upgrading…" : `Upgrade → LV ${nextLevel} • ${costNum.toLocaleString()} N`}
    </button>
  );
}

function Countdown({ secondsLeft }: { secondsLeft: number }) {
  const { h, m, s } = formatHMS(secondsLeft);
  return (
    <div className="rounded-lg bg-[#0F0F23] border border-[#2D2D44] p-2.5">
      <p className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold mb-1.5 text-center">
        Next claim in
      </p>
      <div className="flex items-center justify-center gap-1.5 font-mono text-sm">
        <TimeCell value={h} label="H" />
        <span className="text-[#4D4D64]">:</span>
        <TimeCell value={m} label="M" />
        <span className="text-[#4D4D64]">:</span>
        <TimeCell value={s} label="S" />
      </div>
      <div className="mt-2 h-1 bg-[#1A1A2E] rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-1000"
          style={{ width: `${Math.max(0, Math.min(100, ((CLAIM_COOLDOWN_SECONDS - secondsLeft) / CLAIM_COOLDOWN_SECONDS) * 100))}%` }}
        />
      </div>
    </div>
  );
}

function TimeCell({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className="text-white font-bold tabular-nums">{String(value).padStart(2, "0")}</span>
      <span className="text-[#4D4D64] text-[8px] mt-0.5">{label}</span>
    </div>
  );
}

export default function PMDashboard() {
  const { address, isConnected } = useAccount();
  const toast = useToast();
  const [mounted, setMounted] = useState(false);
  const now = useCountdownTick(1000);

  useEffect(() => {
    setMounted(true);
  }, []);

  const { data: userRigCount } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "userRigCount",
    args: [address!],
    query: { enabled: !!address },
  });

  const { data: nTokenBalance } = useReadContract({
    address: NTOKEN_ADDRESS,
    abi: NTOKEN_ABI,
    functionName: "balanceOf",
    args: [address!],
    query: { enabled: !!address },
  });

  const { data: userMachines } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "getUserMachines",
    args: [address!],
    query: { enabled: !!address && (userRigCount ?? 0n) > 0n },
  });

  const nftIds = useMemo(() => (Array.isArray(userMachines) ? userMachines as bigint[] : []), [userMachines]);

  const { data: rigDetails } = useReadContracts({
    allowFailure: true,
    contracts: nftIds.map((id) => ({
      address: PMINING_CONTRACT_ADDRESS,
      abi: PMiningAbi,
      functionName: "getRigInfo",
      args: [id],
    })),
    query: { enabled: nftIds.length > 0 },
  });

  // Aggregate rigs data + fetch metadata async
  const [rigs, setRigs] = useState<RigInfo[]>([]);
  const metaReqRef = useRef<{ ids: Set<string>; pending: boolean }>({ ids: new Set(), pending: false });

  useEffect(() => {
    if (!address || nftIds.length === 0 || !rigDetails) {
      setRigs([]);
      return;
    }

    const baseRigs = nftIds.map((id, i) => {
      const info = rigDetails[i]?.result as
        | [owner: `0x${string}`, level: number, dailyProduction: bigint, nextClaimTime: bigint]
        | undefined;
      const level = (info?.[1] ?? 1) as RigLevel;
      const nextClaimTime = info?.[3] ?? 0n;
      return {
        nftId: id,
        level,
        dailyProduction: info?.[2] ?? 0n,
        nextClaimTime,
        owner: info?.[0] ?? "0x0000000000000000000000000000000000000000",
        imageUrl: "",
        name: `Rig #${id.toString()}`,
        ready: false,
        secondsLeft: 0,
      };
    });

    setRigs(
      baseRigs.map((r) => ({
        ...r,
        ready: Number(r.nextClaimTime) <= Math.floor(Date.now() / 1000),
        secondsLeft: Math.max(0, Number(r.nextClaimTime) - Math.floor(Date.now() / 1000)),
      }))
    );

    const drain = async () => {
      metaReqRef.current.pending = true;
      try {
        for (const id of nftIds) metaReqRef.current.ids.add(id.toString());
        while (metaReqRef.current.ids.size > 0) {
          const batch = Array.from(metaReqRef.current.ids).slice(0, 4);
          for (const id of batch) metaReqRef.current.ids.delete(id);
          const enriched = await Promise.all(
            batch.map(async (idStr) => {
              const id = BigInt(idStr);
              try {
                const data = await fetchTokenDataCached(id);
                if (!data) return { id, imageUrl: "", name: `Rig #${idStr}` };
                const imageUrl =
                  data.pixelData && data.gridSize
                    ? pixelDataToSVG(data.pixelData as unknown as string, Number(data.gridSize))
                    : "";
                return { id, imageUrl, name: data.name || `Rig #${idStr}` };
              } catch {
                return { id, imageUrl: "", name: `Rig #${idStr}` };
              }
            })
          );
          setRigs((prev) =>
            prev.map((r) => {
              const hit = enriched.find((e) => e.id === r.nftId);
              if (!hit) return r;
              return { ...r, imageUrl: hit.imageUrl, name: hit.name };
            })
          );
          await new Promise((r) => setTimeout(r, 100));
        }
      } finally {
        metaReqRef.current.pending = false;
      }
    };
    void drain();
  }, [address, nftIds, rigDetails]);

  // Update countdown every tick
  useEffect(() => {
    setRigs((prev) =>
      prev.map((r) => ({
        ...r,
        ready: Number(r.nextClaimTime) <= now,
        secondsLeft: Math.max(0, Number(r.nextClaimTime) - now),
      }))
    );
  }, [now]);

  const {
    writeContractAsync,
    isPending: isWritePending,
    data: txHash,
  } = useWriteContract();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: owner } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "owner",
  });

  const isDev = address?.toLowerCase() === (owner as string | undefined)?.toLowerCase();

  const [claimingId, setClaimingId] = useState<bigint | null>(null);
  const [upgradingId, setUpgradingId] = useState<bigint | null>(null);

  const { data: costL2 } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "levelUpgradeCost",
    args: [2],
  });

  const { data: costL3 } = useReadContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "levelUpgradeCost",
    args: [3],
  });

  const handleUpgrade = useCallback(
    async (nftId: bigint) => {
      const target = rigs.find((r) => r.nftId === nftId);
      const level = target?.level ?? 1;
      const nextLevel = level + 1;
      const cost = nextLevel === 2 ? costL2 : costL3;
      if (cost === undefined) {
        toast.warning("Loading", "Upgrade cost not loaded yet, try again.");
        return;
      }
      try {
        setUpgradingId(nftId);
        const { NTOKEN_ADDRESS, pmPublicClient } = await import("@/lib/pmContract");
        const allowance = (await pmPublicClient.readContract({
          address: NTOKEN_ADDRESS,
          abi: [
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
          ],
          functionName: "allowance",
          args: [address!, PMINING_CONTRACT_ADDRESS],
        })) as bigint;
        if (allowance < cost) {
          const approveHash = await writeContractAsync({
            address: NTOKEN_ADDRESS,
            abi: [
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
            ],
            functionName: "approve",
            args: [PMINING_CONTRACT_ADDRESS, cost],
          });
          toast.info("Approving N", "Confirming approval…");
          await pmPublicClient.waitForTransactionReceipt({ hash: approveHash });
        }
        const hash = await writeContractAsync({
          address: PMINING_CONTRACT_ADDRESS,
          abi: PMiningAbi,
          functionName: "upgradeRig",
          args: [nftId],
        });
        toast.show({
          title: "Upgrade submitted",
          description: `Rig #${nftId.toString()} → LV ${nextLevel}`,
          href: getPMExplorerUrl(`tx/${hash}`),
          hrefLabel: "View on Explorer",
        });
      } catch (err) {
        toast.handleError(err, "Upgrade failed");
      } finally {
        setUpgradingId(null);
      }
    },
    [rigs, costL2, costL3, writeContractAsync, toast, address]
  );

  const handleClaim = useCallback(
    async (nftId: bigint) => {
      try {
        setClaimingId(nftId);
        const hash = await writeContractAsync({
          address: PMINING_CONTRACT_ADDRESS,
          abi: PMiningAbi,
          functionName: "claimRig",
          args: [nftId],
        });
        toast.show({
          title: "Claim submitted",
          description: `Rig #${nftId.toString()} • waiting for confirmation`,
          href: getPMExplorerUrl(`tx/${hash}`),
          hrefLabel: "View on Explorer",
        });
      } catch (err) {
        toast.handleError(err, "Claim failed");
      } finally {
        setClaimingId(null);
      }
    },
    [writeContractAsync, toast]
  );

  const handleClaimAll = useCallback(async () => {
    if (!isConnected) {
      toast.warning("Connect wallet", "Please connect your wallet first.");
      return;
    }
    const ready = rigs.filter((r) => r.ready);
    if (ready.length === 0) {
      toast.info("No rigs ready", "Wait for the cooldown to finish.");
      return;
    }
    try {
      const hash = await writeContractAsync({
        address: PMINING_CONTRACT_ADDRESS,
        abi: PMiningAbi,
        functionName: "claimAllRigs",
        args: [],
      });
      toast.show({
        title: "Claim All submitted",
        description: `${ready.length} rig(s) • waiting for confirmation`,
        href: getPMExplorerUrl(`tx/${hash}`),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Claim all failed");
    }
  }, [isConnected, rigs, writeContractAsync, toast]);

  if (!mounted) {
    return <DashboardSkeleton />;
  }

  const readyCount = rigs.filter((r) => r.ready).length;
  const totalDaily = rigs.reduce((acc, r) => acc + Number(formatEther(r.dailyProduction)), 0);

  return (
    <div className="space-y-6">
      {/* Hero stats row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Your Rigs"
          value={userRigCount ? userRigCount.toString() : "0"}
          accent="indigo"
          icon={
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1" />
              <rect x="14" y="3" width="7" height="7" rx="1" />
              <rect x="3" y="14" width="7" height="7" rx="1" />
              <rect x="14" y="14" width="7" height="7" rx="1" />
            </svg>
          }
        />
        <StatCard
          label="Daily Production"
          value={totalDaily > 0 ? totalDaily.toLocaleString() : "0"}
          symbol="N"
          accent="emerald"
          icon={
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
          }
        />
        <StatCard
          label="Ready to Claim"
          value={readyCount.toString()}
          sub={readyCount > 0 ? "Claim now" : "Wait for cooldown"}
          accent={readyCount > 0 ? "amber" : "slate"}
          icon={
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          }
        />
        <StatCard
          label="N Balance"
          value={nTokenBalance ? Number(formatEther(nTokenBalance)).toLocaleString() : "0"}
          symbol="N"
          accent="purple"
          icon={
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M21 12V7H5a2 2 0 010-4h14v4M3 5v14a2 2 0 002 2h16v-5" />
              <path d="M18 12a2 2 0 100 4h4v-4z" />
            </svg>
          }
        />
      </div>

      {/* Rigs grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-bold text-lg" style={{ fontFamily: "var(--font-departure)" }}>
            Your Mining Rigs
          </h2>
          {rigs.length > 0 ? (
            <button
              onClick={handleClaimAll}
              disabled={!isConnected || readyCount === 0 || isWritePending || isConfirming}
              className="pixel-btn pixel-btn-emerald text-[10px] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {isWritePending || isConfirming ? "Processing…" : `Claim All (${readyCount})`}
            </button>
          ) : null}
        </div>

        {rigs.length === 0 ? (
          <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] border-dashed p-10 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <svg width="32" height="32" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-indigo-400">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
            </div>
            <h3 className="text-white font-bold mb-2">No rigs yet</h3>
            <p className="text-[#64748B] text-sm mb-5 max-w-sm mx-auto">
              {address
                ? "Buy your first rig from the marketplace to start mining N tokens daily."
                : "Connect your wallet to start mining."}
            </p>
            {address ? (
              <Link href="/pm/marketplace" className="pixel-btn pixel-btn-indigo inline-flex">
                Browse Marketplace
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {rigs.map((r) => (
              <RigCard
                key={r.nftId.toString()}
                rig={r}
                onClaim={handleClaim}
                claiming={claimingId === r.nftId}
                onUpgrade={handleUpgrade}
                upgrading={upgradingId === r.nftId}
                nBalance={(nTokenBalance as bigint | undefined) ?? null}
                costL2={(costL2 as bigint | undefined) ?? null}
                costL3={(costL3 as bigint | undefined) ?? null}
              />
            ))}
          </div>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-3">
        <Link href="/pm/marketplace" className="pixel-btn pixel-btn-secondary">
          Buy New Rig
        </Link>
        <Link href="/pm/myrigs" className="pixel-btn pixel-btn-secondary">
          Leaderboard
        </Link>
        {isDev ? (
          <Link href="/pm/admin" className="pixel-btn pixel-btn-amber">
            Dev Panel
          </Link>
        ) : null}
      </div>

      {/* Info card */}
      <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-5">
        <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" className="text-indigo-400">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          How it works
        </h2>
        <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-[#94A3B8] text-xs">
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 mt-0.5 font-bold">1.</span>
            <span>Buy a Rig NFT from marketplace — 1 N for the first rig, 1000 N for each additional.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 mt-0.5 font-bold">2.</span>
            <span>Each rig produces N tokens every 24h, scaled by its level (24 / 100 / 300 N/day).</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 mt-0.5 font-bold">3.</span>
            <span>Wait for the countdown to hit zero, then claim. Claim All works too.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-indigo-400 mt-0.5 font-bold">4.</span>
            <span>Upgrade rigs (500 N → L2, 9000 N → L3) to boost daily production.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  symbol,
  accent = "slate",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  symbol?: string;
  accent?: "indigo" | "emerald" | "amber" | "purple" | "slate";
  icon?: React.ReactNode;
}) {
  const colors: Record<string, string> = {
    indigo: "text-indigo-400 bg-indigo-500/10 border-indigo-500/20",
    emerald: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
    amber: "text-amber-400 bg-amber-500/10 border-amber-500/20",
    purple: "text-purple-400 bg-purple-500/10 border-purple-500/20",
    slate: "text-[#64748B] bg-white/5 border-white/5",
  };

  return (
    <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4 hover:border-[#3D3D5C] transition-colors">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[#64748B] text-[11px] uppercase tracking-wider font-bold">{label}</p>
        {icon ? (
          <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${colors[accent]}`}>
            {icon}
          </div>
        ) : null}
      </div>
      <p className="text-white font-bold text-2xl tracking-tight tabular-nums">
        {value}
        {symbol ? <span className="text-[#64748B] text-sm ml-1.5 font-normal">{symbol}</span> : null}
      </p>
      {sub ? <p className="text-[#64748B] text-[10px] mt-1">{sub}</p> : null}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4 h-24 animate-pulse" />
        ))}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] aspect-square animate-pulse" />
        ))}
      </div>
    </div>
  );
}
