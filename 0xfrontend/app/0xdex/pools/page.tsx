"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { useDexWrite, NATIVE_TOKEN, Token, useTokenBalance, useDexRead, useAllPools } from "@/lib/use0xDex";
import { DEX_ADDRESS } from "@/lib/0xDexContract";
import { formatUnits, parseUnits, keccak256, toBytes, encodePacked } from "viem";
import { useToast } from "@/components/Toast";
import { useChainId } from "wagmi";
import { LITVM_CHAIN_ID } from "@/lib/chainSwitch";

const DEX_NAV = [
  { href: "/0xdex", label: "Dashboard", icon: "◈" },
  { href: "/0xdex/swap", label: "Swap", icon: "⇄" },
  { href: "/0xdex/pools", label: "Pools", icon: "◫" },
] as const;

const KNOWN_TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: "0xf29F6040919329e5273cFB370924069AF966C1d7",
    symbol: "NUSD",
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

function PoolCard({ token0, token1, reserve0, reserve1, volume24h, totalVolume, lpTotal }: {
  token0: `0x${string}`; token1: `0x${string}`; reserve0: bigint; reserve1: bigint; volume24h: bigint; totalVolume: bigint; lpTotal: bigint;
}) {
  const token0Symbol = token0 === "0x0000000000000000000000000000000000000000" ? "zkLTC" : token0.slice(0, 6) + "...";
  const token1Symbol = token1 === "0x0000000000000000000000000000000000000000" ? "zkLTC" : token1.slice(0, 6) + "...";

  return (
    <div className="p-4 rounded-xl bg-[#13131F] border border-[#2D2D44] hover:border-[#3D3D54] transition-colors">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
            {token0Symbol[0]}{token1Symbol[0]}
          </div>
          <span className="font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
            {token0Symbol} / {token1Symbol}
          </span>
        </div>
        <Link href="/0xdex/swap" className="pixel-btn pixel-btn-indigo text-xs">
          TRADE
        </Link>
      </div>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-[#64748B] mb-1">Liquidity</div>
          <div className="text-white font-medium" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSD(reserve0 + reserve1)}
          </div>
        </div>
        <div>
          <div className="text-[#64748B] mb-1">Volume 24h</div>
          <div className="text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
            {formatUSD(volume24h)}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PoolsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const toast = useToast();
  const { addLiquidity, removeLiquidity } = useDexWrite();
  
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"add" | "remove">("add");
  const [showTopPools, setShowTopPools] = useState(true);
  
  // Add liquidity state
  const [selectedPoolIndex, setSelectedPoolIndex] = useState<number>(0);
  const [tokenA, setTokenA] = useState<Token | null>(null);
  const [tokenB, setTokenB] = useState<Token | null>(null);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  
  // Remove liquidity state
  const [selectedRemovePool, setSelectedRemovePool] = useState<number>(0);
  const [lpAmount, setLpAmount] = useState("");
  
  // Get all pools
  const { data: allPools } = useAllPools();
  
  // Get NUSD address
  const { data: nusdAddress } = useDexRead<`0x${string}`>("NUSD");
  
  // Build pool options from allPools
  const poolOptions = useMemo(() => {
    if (!allPools || !nusdAddress) return [];
    return allPools.map(token => {
      const pairId = keccak256PairId(token, nusdAddress);
      return {
        token0: token,
        token1: nusdAddress,
        pairId,
        label: `${token === "0x0000000000000000000000000000000000000000" ? "zkLTC" : "NUSD"} / NUSD`,
      };
    });
  }, [allPools, nusdAddress]);
  
  // Selected pool data
  const selectedPool = poolOptions[selectedPoolIndex];
  
  // Get pool info for selected pool
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    tokenA && tokenB ? [tokenA.address, tokenB.address] : undefined
  );
  
  const { data: poolExists } = useDexRead<boolean>(
    "poolExists",
    pairId ? [pairId] : undefined
  );
  
  // Get user LP balance for selected pool
  const { data: userLP } = useDexRead<bigint>(
    "userLP",
    pairId && address ? [pairId, address] : undefined
  );
  
  // Get pool reserves
  const { data: poolData } = useDexRead("pools", pairId ? [pairId] : undefined);
  
  // Balances
  const { data: balanceA } = useTokenBalance(address, tokenA);
  const { data: balanceB } = useTokenBalance(address, tokenB);
  
  // Allowance check
  const { data: allowanceA } = useReadContract({
    address: tokenA?.address !== NATIVE_TOKEN.address ? tokenA?.address : undefined,
    abi: [
      {
        name: "allowance",
        type: "function",
        inputs: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" }
        ],
        outputs: [{ name: "", type: "uint256" }],
        stateMutability: "view",
      }
    ],
    functionName: "allowance",
    args: tokenA?.address !== NATIVE_TOKEN.address && address ? [address as `0x${string}`, DEX_ADDRESS] : undefined,
    query: { enabled: !!address && !!tokenA && tokenA.address !== NATIVE_TOKEN.address }
  });
  
  const needsApproval = tokenA && tokenA.address !== NATIVE_TOKEN.address && allowanceA !== undefined;
  const hasAllowance = !needsApproval || (allowanceA && allowanceA >= (amountA ? parseUnits(amountA, tokenA.decimals) : 0n));

  useEffect(() => {
    setMounted(true);
  }, []);
  
  useEffect(() => {
    if (mounted && isConnected && chainId !== LITVM_CHAIN_ID) {
      toast.warning("Wrong network", "Please switch to LitVM LiteForge");
    }
  }, [mounted, isConnected, chainId, toast]);

  const handleApprove = () => {
    if (!tokenA || !amountA) return;
    const amount = parseUnits(amountA, tokenA.decimals);
    toast.info("Approving", `Approving ${tokenA.symbol}...`);
  };
  
  const handleAddLiquidity = () => {
    if (!tokenA || !tokenB || !amountA || !amountB) {
      toast.error("Invalid input", "Please select tokens and enter amounts");
      return;
    }
    
    if (needsApproval && !hasAllowance) {
      toast.error("Approval required", "Please approve the token first");
      return;
    }
    
    const amountAFormatted = parseUnits(amountA, tokenA.decimals);
    const amountBFormatted = parseUnits(amountB, tokenB.decimals);
    
    try {
      addLiquidity(tokenA.address, tokenB.address, amountAFormatted, amountBFormatted);
      toast.info("Adding liquidity", "Please confirm the transaction...");
    } catch (err) {
      toast.error("Failed", "Could not add liquidity");
    }
  };
  
  const handleRemoveLiquidity = () => {
    if (!pairId || !lpAmount) {
      toast.error("Invalid input", "Please select a pool and enter amount");
      return;
    }
    
    const lpFormatted = parseUnits(lpAmount, 18);
    
    try {
      removeLiquidity(pairId, lpFormatted);
      toast.info("Removing liquidity", "Please confirm the transaction...");
    } catch (err) {
      toast.error("Failed", "Could not remove liquidity");
    }
  };
  
  const isValidAdd = tokenA && tokenB && amountA && amountB && parseFloat(amountA) > 0 && parseFloat(amountB) > 0 && poolExists && hasAllowance;

  return (
    <div className="min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white font-bold">
              ◈
            </div>
            <span
              className="text-white font-bold text-lg tracking-tight"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              0xDex
            </span>
          </Link>

          <nav className="hidden md:flex items-center gap-2">
            {DEX_NAV.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
                  link.href === "/0xdex/pools"
                    ? "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                    : "text-[#64748B] hover:text-white hover:bg-white/5"
                }`}
                style={{ fontFamily: "var(--font-departure)" }}
              >
                <span className="mr-2">{link.icon}</span>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-5 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 
              className="text-2xl font-bold text-white mb-1"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              Liquidity Pools
            </h1>
            <p className="text-[#64748B] text-sm">Farm rewards by providing liquidity</p>
          </div>
          <button
            onClick={() => setShowTopPools(!showTopPools)}
            className="pixel-btn pixel-btn-indigo text-xs"
          >
            {showTopPools ? "HIDE" : "SHOW"} TOP PAIRS
          </button>
        </div>

        {/* Top Pairs */}
        {showTopPools && (
          <div className="mb-8">
            <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>
              Top Pairs by Volume
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {poolOptions.slice(0, 6).map((pool, i) => (
                <PoolTopCard key={i} index={i} token0={pool.token0} token1={pool.token1} />
              ))}
            </div>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("add")}
            className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
              activeTab === "add"
                ? "bg-gradient-to-r from-indigo-500 to-purple-500 text-white"
                : "bg-[#1A1A2E] text-[#64748B] hover:text-white border border-[#2D2D44]"
            }`}
            style={{ fontFamily: "var(--font-departure)" }}
          >
            + ADD LIQUIDITY
          </button>
          <button
            onClick={() => setActiveTab("remove")}
            className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
              activeTab === "remove"
                ? "bg-gradient-to-r from-emerald-500 to-teal-500 text-white"
                : "bg-[#1A1A2E] text-[#64748B] hover:text-white border border-[#2D2D44]"
            }`}
            style={{ fontFamily: "var(--font-departure)" }}
          >
            - REMOVE LIQUIDITY
          </button>
        </div>

        {activeTab === "add" ? (
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 to-purple-500/10 rounded-2xl blur-xl" />
            
            <div className="relative bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>
                Add Liquidity
              </h2>
              
              {/* Pool Selector */}
              <div className="mb-4">
                <label className="block text-xs text-[#64748B] uppercase tracking-wider mb-2">
                  Select Pool
                </label>
                <select
                  value={selectedPoolIndex}
                  onChange={(e) => {
                    const idx = parseInt(e.target.value);
                    setSelectedPoolIndex(idx);
                    const pool = poolOptions[idx];
                    if (pool) {
                      setTokenA(pool.token0 === "0x0000000000000000000000000000000000000000" 
                        ? NATIVE_TOKEN 
                        : KNOWN_TOKENS.find(t => t.address === pool.token0) || null);
                      setTokenB(KNOWN_TOKENS.find(t => t.address === pool.token1) || null);
                    }
                  }}
                  className="w-full bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] outline-none focus:border-indigo-500"
                >
                  {poolOptions.length > 0 ? (
                    poolOptions.map((pool, i) => (
                      <option key={i} value={i}>{pool.label}</option>
                    ))
                  ) : (
                    <option value="">No pools available</option>
                  )}
                </select>
              </div>
              
              {/* Pool Info */}
              {poolData && (
                <div className="mb-4 p-3 rounded-lg bg-[#13131F]/50 border border-[#2D2D44]">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[#64748B]">Total LP</div>
                      <div className="text-white font-medium" style={{ fontFamily: "var(--font-departure)" }}>
                        {Number(formatUnits(poolData[4], 18)).toFixed(2)}
                      </div>
                    </div>
                    <div>
                      <div className="text-[#64748B]">Volume 24h</div>
                      <div className="text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
                        {formatUSD(poolData[5])}
                      </div>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Token A */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[#64748B] uppercase tracking-wider">
                    Token A
                  </label>
                  {balanceA && tokenA && (
                    <button
                      onClick={() => setAmountA(formatUnits(balanceA, tokenA.decimals).slice(0, 8))}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      style={{ fontFamily: "var(--font-departure)" }}
                    >
                      Balance: {formatUnits(balanceA, tokenA.decimals).slice(0, 8)}
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={amountA}
                    onChange={(e) => setAmountA(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 bg-[#13131F] p-4 rounded-lg text-xl font-bold text-white outline-none border border-[#2D2D44] focus:border-indigo-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  <div className="bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] min-w-[100px] text-center">
                    {tokenA?.symbol || "—"}
                  </div>
                </div>
              </div>
              
              {/* Plus Divider */}
              <div className="relative h-0 flex justify-center my-2">
                <div className="relative -mt-4 w-10 h-10 rounded-full bg-[#1A1A2E] border-4 border-[#0F0F23] flex items-center justify-center text-lg font-bold text-indigo-400">
                  +
                </div>
              </div>
              
              {/* Token B */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[#64748B] uppercase tracking-wider">
                    Token B (NUSD)
                  </label>
                  {balanceB && tokenB && (
                    <button
                      onClick={() => setAmountB(formatUnits(balanceB, tokenB.decimals).slice(0, 8))}
                      className="text-xs text-indigo-400 hover:text-indigo-300"
                      style={{ fontFamily: "var(--font-departure)" }}
                    >
                      Balance: {formatUnits(balanceB, tokenB.decimals).slice(0, 8)}
                    </button>
                  )}
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    value={amountB}
                    onChange={(e) => setAmountB(e.target.value)}
                    placeholder="0.0"
                    className="flex-1 bg-[#13131F] p-4 rounded-lg text-xl font-bold text-white outline-none border border-[#2D2D44] focus:border-indigo-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  <div className="bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] min-w-[100px] text-center">
                    {tokenB?.symbol || "—"}
                  </div>
                </div>
              </div>
              
              {/* Approval Warning */}
              {needsApproval && !hasAllowance && (
                <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <p className="text-xs text-amber-400 mb-3">
                    You need to approve {tokenA?.symbol} before adding liquidity
                  </p>
                  <button
                    onClick={handleApprove}
                    className="w-full py-2 rounded-lg bg-amber-500/20 text-amber-400 font-bold text-sm hover:bg-amber-500/30 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    APPROVE {tokenA?.symbol}
                  </button>
                </div>
              )}
              
              {/* Add Button */}
              <button
                onClick={handleAddLiquidity}
                disabled={!isValidAdd || !mounted || !isConnected}
                className="w-full py-4 rounded-xl font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  fontFamily: "var(--font-departure)",
                  background: isValidAdd && mounted && isConnected
                    ? "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)"
                    : undefined,
                  boxShadow: isValidAdd && mounted && isConnected ? "0 0 20px rgba(99, 102, 241, 0.4)" : undefined,
                }}
              >
                {!mounted || !isConnected 
                  ? "Connect Wallet"
                  : !poolExists 
                    ? "Pool Not Available"
                    : needsApproval && !hasAllowance
                      ? "Approve First"
                      : !amountA || !amountB 
                        ? "Enter Amounts"
                        : "Add Liquidity"
                }
              </button>
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/10 to-teal-500/10 rounded-2xl blur-xl" />
            
            <div className="relative bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>
                Remove Liquidity
              </h2>
              
              {/* Pool Selector */}
              <div className="mb-4">
                <label className="block text-xs text-[#64748B] uppercase tracking-wider mb-2">
                  Select Pool
                </label>
                <select
                  value={selectedRemovePool}
                  onChange={(e) => setSelectedRemovePool(parseInt(e.target.value))}
                  className="w-full bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] outline-none focus:border-emerald-500"
                >
                  {poolOptions.length > 0 ? (
                    poolOptions.map((pool, i) => (
                      <option key={i} value={i}>{pool.label}</option>
                    ))
                  ) : (
                    <option value="">No pools</option>
                  )}
                </select>
              </div>
              
              {/* LP Amount */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[#64748B] uppercase tracking-wider">
                    LP Tokens
                  </label>
                  {userLP && (
                    <button
                      onClick={() => setLpAmount(formatUnits(userLP, 18).slice(0, 8))}
                      className="text-xs text-emerald-400 hover:text-emerald-300"
                      style={{ fontFamily: "var(--font-departure)" }}
                    >
                      Balance: {formatUnits(userLP, 18).slice(0, 8)}
                    </button>
                  )}
                </div>
                <input
                  type="text"
                  value={lpAmount}
                  onChange={(e) => setLpAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-[#13131F] p-4 rounded-lg text-xl font-bold text-white outline-none border border-[#2D2D44] focus:border-emerald-500 transition-colors"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
              </div>
              
              {/* Remove Button */}
              <button
                onClick={handleRemoveLiquidity}
                disabled={!lpAmount || !mounted || !isConnected || !pairId}
                className="w-full py-4 rounded-xl font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  fontFamily: "var(--font-departure)",
                  background: lpAmount && mounted && isConnected
                    ? "linear-gradient(135deg, #10B981 0%, #059669 100%)"
                    : undefined,
                  boxShadow: lpAmount && mounted && isConnected ? "0 0 20px rgba(16, 185, 129, 0.4)" : undefined,
                }}
              >
                {!mounted || !isConnected 
                  ? "Connect Wallet"
                  : !lpAmount 
                    ? "Enter LP Amount"
                    : "Remove Liquidity"
              }
              </button>
            </div>
          </div>
        )}

        {/* Info Card */}
        <div className="mt-6 p-4 rounded-xl bg-[#1A1A2E]/50 border border-[#2D2D44]">
          <h3 className="text-sm font-bold text-white mb-3" style={{ fontFamily: "var(--font-departure)" }}>
            How Liquidity Farming Works
          </h3>
          <ul className="space-y-2 text-xs text-[#64748B]">
            <li className="flex items-start gap-2">
              <span className="text-indigo-400">1.</span>
              Only existing pools (with NUSD pair) can receive liquidity
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400">2.</span>
              Earn 0.3% trading fee on your LP share
            </li>
            <li className="flex items-start gap-2">
              <span className="text-amber-400">3.</span>
              Additional rewards distributed in NUSD
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}

// Helper function to match contract's getPairId
function keccak256PairId(tokenA: `0x${string}`, tokenB: `0x${string}`): `0x${string}` {
  const token0 = tokenA < tokenB ? tokenA : tokenB;
  const token1 = tokenA < tokenB ? tokenB : tokenA;
  // Use viem's keccak256 and encodePacked
  const hash = keccak256(encodePacked(["address", "address"], [token0, token1]));
  return hash;
}

function PoolTopCard({ index, token0, token1 }: { index: number; token0: `0x${string}`; token1: `0x${string}` }) {
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    token0 && token1 ? [token0, token1] : undefined
  );
  
  const { data: poolData } = useDexRead("pools", pairId ? [pairId] : undefined);
  
  const token0Symbol = token0 === "0x0000000000000000000000000000000000000000" ? "zkLTC" : "TKN";
  const token1Symbol = "NUSD";
  
  return (
    <div className="p-4 rounded-xl bg-[#13131F] border border-[#2D2D44]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-[#64748B]">#{index + 1}</span>
        <div className="w-6 h-6 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">
          {token0Symbol[0]}{token1Symbol[0]}
        </div>
        <span className="font-medium text-white text-sm" style={{ fontFamily: "var(--font-departure)" }}>
          {token0Symbol}/{token1Symbol}
        </span>
      </div>
      {poolData ? (
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[#64748B]">Vol 24h</div>
            <div className="text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
              {formatUSD(poolData[5])}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Total Vol</div>
            <div className="text-white font-medium" style={{ fontFamily: "var(--font-departure)" }}>
              {formatUSD(poolData[6])}
            </div>
          </div>
        </div>
      ) : (
        <div className="h-10 bg-[#2D2D44]/50 rounded animate-pulse" />
      )}
    </div>
  );
}
