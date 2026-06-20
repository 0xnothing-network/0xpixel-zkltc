"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { getPMExplorerUrl } from "@/lib/pmContract";
import { useToast } from "@/components/Toast";

interface LeaderboardEntry {
  address: `0x${string}`;
  rigCount: number;
  totalMined: string;
}

interface LeaderboardData {
  entries: LeaderboardEntry[];
  totalRigs: number;
  totalMined: string;
  uniqueMiners: number;
  refreshedAt: number;
  nextRefreshAt: number;
  stale?: boolean;
}

function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function rankBadge(rank: number) {
  if (rank === 1) return { emoji: "1ST", cls: "bg-gradient-to-r from-yellow-400 to-amber-500 text-black" };
  if (rank === 2) return { emoji: "2ND", cls: "bg-gradient-to-r from-slate-300 to-slate-400 text-black" };
  if (rank === 3) return { emoji: "3RD", cls: "bg-gradient-to-r from-orange-400 to-orange-600 text-white" };
  return { emoji: `#${rank}`, cls: "bg-[#0F0F23] border border-[#2D2D44] text-[#64748B]" };
}

function formatCountdown(ms: number) {
  if (ms <= 0) return "Refreshing…";
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function NextRefresh({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = target - now;
  return <span className="font-mono">{formatCountdown(ms)}</span>;
}

function Row({
  entry,
  rank,
  isMe,
  onCopy,
}: {
  entry: LeaderboardEntry;
  rank: number;
  isMe: boolean;
  onCopy: (a: string) => void;
}) {
  const badge = rankBadge(rank);
  const mined = Number(formatEther(BigInt(entry.totalMined)));
  return (
    <div
      className={
        "grid grid-cols-12 gap-2 items-center px-3.5 py-3 border-b border-[#2D2D44] last:border-b-0 transition-colors " +
        (isMe
          ? "bg-indigo-500/10 hover:bg-indigo-500/15"
          : "hover:bg-[#1F1F38]")
      }
    >
      <div className="col-span-2 sm:col-span-1">
        <span
          className={`inline-flex items-center justify-center w-12 h-7 rounded-md text-[10px] font-bold ${badge.cls}`}
        >
          {badge.emoji}
        </span>
      </div>
      <div className="col-span-6 sm:col-span-6 min-w-0">
        <div className="flex items-center gap-2">
          <a
            href={getPMExplorerUrl(`address/${entry.address}`)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-white text-sm font-mono truncate hover:text-indigo-300"
            title={entry.address}
          >
            {shortAddr(entry.address)}
          </a>
          {isMe && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-500/30 text-indigo-200 border border-indigo-500/40">
              YOU
            </span>
          )}
          <button
            onClick={() => onCopy(entry.address)}
            className="text-[#64748B] hover:text-indigo-300 transition-colors"
            title="Copy address"
          >
            <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <rect x="9" y="9" width="13" height="13" rx="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          </button>
        </div>
      </div>
      <div className="col-span-2 sm:col-span-2 text-center">
        <span className="text-white text-sm font-mono font-bold">
          {entry.rigCount}
        </span>
        <span className="text-[#64748B] text-[10px] ml-1">rigs</span>
      </div>
      <div className="col-span-2 sm:col-span-3 text-right">
        <div className="text-emerald-300 text-sm font-mono font-bold">
          +{mined.toLocaleString(undefined, { maximumFractionDigits: 0 })}
        </div>
        <div className="text-[#64748B] text-[9px]">N mined</div>
      </div>
    </div>
  );
}

export default function PMLeaderboard() {
  const { address } = useAccount();
  const toast = useToast();
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (force = false) => {
    try {
      if (force) setRefreshing(true);
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as LeaderboardData;
      setData(json);
    } catch (err) {
      toast.handleError(err, "Failed to load leaderboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const onCopy = useCallback(
    async (a: string) => {
      try {
        await navigator.clipboard.writeText(a);
        toast.info("Copied", shortAddr(a));
      } catch {
        toast.warning("Copy failed", "Browser blocked clipboard");
      }
    },
    [toast]
  );

  const TOP_DISPLAY = 20;

  const topEntries = data?.entries.slice(0, TOP_DISPLAY) ?? [];
  const userEntry = address
    ? data?.entries.find((e) => e.address.toLowerCase() === address.toLowerCase())
    : undefined;
  const userInTop = userEntry !== undefined && topEntries.some((e) => e.address.toLowerCase() === address!.toLowerCase());
  const myRank = userEntry ? (data?.entries.findIndex((e) => e.address.toLowerCase() === address!.toLowerCase()) ?? -1) : -1;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
          <p className="text-[#94A3B8] text-sm mt-1">
            Top miners ranked by total N claimed.
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          className="px-4 py-2 rounded-lg text-xs font-bold border bg-[#1A1A2E] border-[#2D2D44] hover:border-indigo-500/40 text-white transition-colors disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* Stats cards */}
      <div className="grid sm:grid-cols-3 gap-3">
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4">
          <p className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">Miners</p>
          <p className="text-white text-2xl font-bold mt-1 font-mono">
            {data ? data.uniqueMiners.toLocaleString() : "—"}
          </p>
        </div>
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4">
          <p className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">Active Rigs</p>
          <p className="text-white text-2xl font-bold mt-1 font-mono">
            {data ? data.totalRigs.toLocaleString() : "—"}
          </p>
        </div>
        <div className="bg-[#1A1A2E] rounded-xl border border-[#2D2D44] p-4">
          <p className="text-[#64748B] text-[10px] uppercase tracking-wider font-bold">Total Mined</p>
          <p className="text-emerald-300 text-2xl font-bold mt-1 font-mono">
            {data
              ? Number(formatEther(BigInt(data.totalMined))).toLocaleString(undefined, { maximumFractionDigits: 0 })
              : "—"}{" "}
            <span className="text-[#64748B] text-sm">N</span>
          </p>
        </div>
      </div>

      {/* Next refresh info */}
      {data && (
        <div className="bg-gradient-to-r from-indigo-500/10 to-purple-500/10 border border-indigo-500/20 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[#94A3B8]">
              {data.stale ? "Last cached snapshot" : "Live snapshot"} • Updated{" "}
              {new Date(data.refreshedAt).toUTCString().slice(17, 22)} UTC
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-[#94A3B8]">
            <span>Next refresh in</span>
            <NextRefresh target={data.nextRefreshAt} />
          </div>
        </div>
      )}

      {/* Your rank */}
      {myRank >= 0 && data && (
        <div className="bg-gradient-to-r from-indigo-500/15 to-purple-500/15 border border-indigo-500/30 rounded-xl p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center justify-center w-12 h-7 rounded-md text-[10px] font-bold bg-indigo-500 text-white">
              #{myRank + 1}
            </span>
            <div>
              <p className="text-white text-sm font-bold">Your rank</p>
              <p className="text-[#94A3B8] text-xs font-mono">{shortAddr(address!)}</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-emerald-300 font-mono font-bold text-sm">
              +{Number(formatEther(BigInt(data.entries[myRank].totalMined))).toLocaleString(undefined, { maximumFractionDigits: 0 })} N
            </p>
            <p className="text-[#64748B] text-[10px]">
              {data.entries[myRank].rigCount} rig{data.entries[myRank].rigCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      )}

      {/* Leaderboard table */}
      <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] overflow-hidden">
        <div className="grid grid-cols-12 gap-2 px-3.5 py-2.5 border-b border-[#2D2D44] bg-[#0F0F23] text-[10px] uppercase tracking-wider font-bold text-[#64748B]">
          <div className="col-span-2 sm:col-span-1">Rank</div>
          <div className="col-span-6 sm:col-span-6">Wallet</div>
          <div className="col-span-2 sm:col-span-2 text-center">Rigs</div>
          <div className="col-span-2 sm:col-span-3 text-right">Mined</div>
        </div>

        {loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-12 bg-[#0F0F23] rounded animate-pulse" />
            ))}
          </div>
        ) : data && data.entries.length > 0 ? (
          <>
            {topEntries.map((entry, i) => (
              <Row
                key={entry.address}
                entry={entry}
                rank={i + 1}
                isMe={!!address && entry.address.toLowerCase() === address.toLowerCase()}
                onCopy={onCopy}
              />
            ))}
            {!userInTop && userEntry && (
              <>
                <div className="px-3.5 py-2 border-b border-[#2D2D44] text-center text-[10px] text-[#4D4D64] italic">
                  ··· {data.entries.length - TOP_DISPLAY} more miners ···
                </div>
                <Row
                  key={userEntry.address}
                  entry={userEntry}
                  rank={myRank + 1}
                  isMe={true}
                  onCopy={onCopy}
                />
              </>
            )}
          </>
        ) : (
          <div className="py-16 text-center text-[#64748B] text-sm">
            No mining activity yet. Be the first!
          </div>
        )}
      </div>

      {data && data.entries.length > 0 && (
        <p className="text-center text-[10px] text-[#64748B]">
          Showing top {topEntries.length}{!userInTop && userEntry ? ` + you (#${myRank + 1})` : ""} from {data.entries.length} total miners
        </p>
      )}
    </div>
  );
}
