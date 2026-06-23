"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAccount, useReadContract, useConnect, useDisconnect, useBlockNumber, useWriteContract, useSwitchChain } from "wagmi";
import { erc20Abi, maxUint256 } from "viem";
import { useDexStats, useUserPendingReward, useAllPools, useDexRead, useDexWrite, NATIVE_TOKEN, useTokenBalance, useTokenAllowance, useDexOwner, Token, useDexAutoRefresh } from "@/lib/use0xDex";
import { useTokenApproval } from "@/lib/useTokenApproval";
import { DEX_ADDRESS, NATIVE_ADDRESS } from "@/lib/0xDexContract";
import { NUSD_ADDRESS, NUSD_ABI } from "@/lib/NUSDContract";
import { formatUnits, parseUnits, keccak256, encodePacked } from "viem";
import { useToast } from "@/components/Toast";

// Type definitions
interface PoolData {
  token0: `0x${string}`;
  token1: `0x${string}`;
  reserve0: bigint;
  reserve1: bigint;
  totalLP: bigint;
  volume24h: bigint;
  totalVolume: bigint;
}

// Helper to cast pool data
function castPoolData(data: unknown): PoolData | null {
  if (!data || !Array.isArray(data) || data.length < 7) return null;
  return {
    token0: data[0] as `0x${string}`,
    token1: data[1] as `0x${string}`,
    reserve0: data[2] as bigint,
    reserve1: data[3] as bigint,
    totalLP: data[4] as bigint,
    volume24h: data[5] as bigint,
    totalVolume: data[6] as bigint,
  };
}

const KNOWN_TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: NUSD_ADDRESS,
    symbol: "$NUSD",
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

function formatNum(value: bigint, decimals = 18) {
  const num = Number(formatUnits(value, decimals));
  if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (num >= 1e3) return `${(num / 1e3).toFixed(2)}K`;
  return num.toFixed(2);
}

function StatCard({ label, value, icon, color = "indigo" }: { label: string; value: string; icon: string; color?: string }) {
  const gradient = color === "emerald" ? "from-emerald-500/10 to-teal-500/10" : "from-indigo-500/10 to-purple-500/10";
  return (
    <div className="relative overflow-hidden rounded-lg bg-gradient-to-br from-[#1A1A2E] to-[#13131F] border border-[#2D2D44] p-4">
      <div className={`absolute top-0 right-0 w-16 h-16 bg-gradient-to-br ${gradient} rounded-bl-full`} />
      <div className="relative">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm opacity-60">{icon}</span>
          <span className="text-xs uppercase tracking-wider text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>
            {label}
          </span>
        </div>
        <div className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
          {value}
        </div>
      </div>
    </div>
  );
}

function PoolCard({ token0, token1, reserve0, reserve1, volume24h, totalVolume, lpTotal, rank, onSelect, tokenSymbol, tokenDecimals = 18 }: {
  token0: `0x${string}`; token1: `0x${string}`; reserve0: bigint; reserve1: bigint; volume24h: bigint; totalVolume: bigint; lpTotal: bigint; rank: number;
  onSelect?: (data: { token: `0x${string}`, nusd: `0x${string}`, reserve0: bigint, reserve1: bigint }) => void;
  tokenSymbol?: string;
  tokenDecimals?: number;
}) {
  const NUSD_ADDRESS = "0xC1F96C07D3EAbd25b080522aE85DaaA978192EC0";
  const NATIVE = "0x0000000000000000000000000000000000000000";
  const isToken0NUSD = token0.toLowerCase() === NUSD_ADDRESS.toLowerCase();
  const isToken1NUSD = token1.toLowerCase() === NUSD_ADDRESS.toLowerCase();
  const isToken0Native = token0.toLowerCase() === NATIVE.toLowerCase();
  const otherToken = isToken0NUSD ? token1 : (isToken1NUSD ? token0 : token0);
  const nusdAddr = isToken0NUSD ? token0 : (isToken1NUSD ? token1 : null);
  const isOtherNative = isToken0NUSD ? isToken1NUSD : isToken0Native;
  const reserveOther = isToken0NUSD ? reserve1 : (isToken1NUSD ? reserve0 : reserve1);
  const reserveNUSD = isToken0NUSD ? reserve0 : (isToken1NUSD ? reserve1 : reserve0);
  const displaySymbol = tokenSymbol || (isOtherNative ? "zkLTC" : otherToken.slice(0, 8) + "...");

  // Calculate price: show minimum value (cheaper side)
  const pricePerNUSD = reserveOther > 0n && reserveNUSD > 0n
    ? Number(formatUnits(reserveOther, tokenDecimals)) / Number(formatUnits(reserveNUSD, 18))
    : 0;
  const pricePerToken = reserveNUSD > 0n && reserveOther > 0n
    ? Number(formatUnits(reserveNUSD, 18)) / Number(formatUnits(reserveOther, tokenDecimals))
    : 0;
  const minPrice = Math.min(pricePerNUSD, pricePerToken);

  const handleClick = () => {
    if (!nusdAddr) return;
    onSelect?.({ token: otherToken, nusd: nusdAddr, reserve0: reserveOther, reserve1: reserveNUSD });
  };

  // TVL = reserveToken (in USD) + reserveNUSD = 2 * reserveNUSD (since they're equal value)
  const tvlUSD = reserveNUSD > 0n ? Number(formatUnits(reserveNUSD, 18)) * 2 : 0;

  return (
    <div
      className="p-4 rounded-xl bg-[#13131F] border border-[#2D2D44] hover:border-indigo-500/50 transition-all cursor-pointer"
      onClick={handleClick}
    >
      {/* Top Row: Rank, Symbol, Price */}
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xs text-[#64748B] bg-[#2D2D44] px-2 py-0.5 rounded">#{rank}</span>
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-bold">L$</div>
          <span className="font-bold text-white text-sm" style={{ fontFamily: "var(--font-departure)" }}>
            {displaySymbol}/$NUSD
          </span>
          <span className="text-xs text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
            ${minPrice > 0 ? minPrice.toFixed(6) : "0"}
          </span>
        </div>
      </div>
      
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">TVL</div>
          <div className="text-xs font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
            ${tvlUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">LP Shares</div>
          <div className="text-xs font-bold text-amber-400" style={{ fontFamily: "var(--font-departure)" }}>
            {formatNum(lpTotal)}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">24h Volume</div>
          <div className="text-xs font-bold text-indigo-400" style={{ fontFamily: "var(--font-departure)" }}>
            ${(volume24h > 0n ? Number(formatUnits(volume24h, 18)) : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
        <div className="bg-[#1A1A2E]/50 rounded-lg p-2">
          <div className="text-[10px] text-[#64748B] uppercase">Total Volume</div>
          <div className="text-xs font-bold text-purple-400" style={{ fontFamily: "var(--font-departure)" }}>
            ${(totalVolume > 0n ? Number(formatUnits(totalVolume, 18)) : 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DexAllInOne() {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { writeContract } = useWriteContract();
  const toast = useToast();
  const { addLiquidity, removeLiquidity, swap, claimReward, createPool } = useDexWrite();
  const LITVM_CHAIN_ID = 4441;

  // State
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"swap" | "pools" | "addpool">("swap");

  // Farm state - Add Liquidity = Farm (no separate stake needed)
  const [selectedFarmPool, setSelectedFarmPool] = useState(0);
  const [farmNUSDAmount, setFarmNUSDAmount] = useState("");
  const [farmLpAmount, setFarmLpAmount] = useState("");
  const [farmUserLP, setFarmUserLP] = useState<bigint | undefined>();
  const [farmPending, setFarmPending] = useState<bigint | undefined>();
  const [farmEstimatedLP, setFarmEstimatedLP] = useState<number>(0);

  // Auto-switch to LitVM when connected to wrong chain
  useEffect(() => {
    if (isConnected && chainId && chainId !== LITVM_CHAIN_ID) {
      toast.info("Wrong Network", "Switching to LitVM...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
    }
  }, [isConnected, chainId, switchChain]);

  // Swap state
  const [swapTokenIn, setSwapTokenIn] = useState<Token>(KNOWN_TOKENS[1]); // NUSD
  const [swapTokenOut, setSwapTokenOut] = useState<Token | null>(NATIVE_TOKEN); // zkLTC
  const [swapAmountIn, setSwapAmountIn] = useState("");
  const [swapAmountOut, setSwapAmountOut] = useState("");
  const [swapMode, setSwapMode] = useState<"fixed" | "custom">("fixed");
  const [customTokenAddress, setCustomTokenAddress] = useState("");
  const [customDirection, setCustomDirection] = useState<"token_to_nusd" | "nusd_to_token">("token_to_nusd");
  const [customAmountIn, setCustomAmountIn] = useState("");
  const [customAmountOut, setCustomAmountOut] = useState("");

  // Pool state
  const [poolToken, setPoolToken] = useState<Token>(NATIVE_TOKEN);
  const [poolAmountToken, setPoolAmountToken] = useState("");
  const [poolAmountNUSD, setPoolAmountNUSD] = useState("");
  const [pairFilter, setPairFilter] = useState<"tvl" | "vol24h" | "volAll" | "new">("tvl");

  // Check if user is owner
  const { isOwner, owner } = useDexOwner();
  
  // Admin state
  const [createTokenA, setCreateTokenA] = useState("");
  const [createTokenB, setCreateTokenB] = useState("");
  const [createAmountA, setCreateAmountA] = useState("");
  const [createAmountB, setCreateAmountB] = useState("");
  const [createTokenName, setCreateTokenName] = useState("");
  const [createTokenSymbol, setCreateTokenSymbol] = useState("");
  const [createTokenDecimals, setCreateTokenDecimals] = useState(18);

  // Fetch token info when address changes
  const { data: tokenName } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "name",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: tokenSymbol } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: tokenDecimals } = useReadContract({
    address: createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? createTokenA as `0x${string}` : undefined,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: !!createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) },
  });
  const { data: createTokenBalance } = useTokenBalance(address, createTokenA ? { address: createTokenA as `0x${string}`, symbol: tokenSymbol as string || "TOKEN", decimals: tokenDecimals as number || 18, name: tokenName as string || "Token" } : null);
  
  // Pool Modal state
  const [selectedPoolModal, setSelectedPoolModal] = useState<{token: `0x${string}`, nusd: `0x${string}`, reserve0: bigint, reserve1: bigint} | null>(null);
  const [poolModalTab, setPoolModalTab] = useState<"swap" | "add" | "remove">("swap");

  // Data
  const stats = useDexStats();
  const { data: pendingReward } = useUserPendingReward();
  const { data: allPools } = useAllPools();
  const { data: nusdAddress } = useDexRead<`0x${string}`>("NUSD");

  // Check allowance for create pool token
  const { data: createTokenAllowance, refetch: refetchAllowance } = useTokenAllowance(
    createTokenA && /^0x[a-fA-F0-9]{40}$/.test(createTokenA) ? { address: createTokenA as `0x${string}`, symbol: tokenSymbol || "TOKEN", decimals: tokenDecimals || 18, name: tokenName || "Token" } : null,
    DEX_ADDRESS as `0x${string}`
  );
  const needsCreateApproval = createTokenA && createAmountA && Number(createAmountA) > 0 && 
    (!createTokenAllowance || (createTokenAllowance as bigint) < parseUnits(createAmountA, tokenDecimals || 18));

  // Pool options - dedupe by pairId
  const poolOptions = useMemo(() => {
    if (!allPools || !nusdAddress) return [];
    const seen = new Set<string>();
    return allPools.map((token) => {
      const nusd = nusdAddress;
      const pairId = keccak256(encodePacked(["address", "address"], 
        [token < nusd ? token : nusd, token < nusd ? nusd : token]
      ));
      // Skip duplicates
      if (seen.has(pairId)) return null;
      seen.add(pairId);
      return {
        token,
        nusd,
        pairId,
        label: `${token === NATIVE_ADDRESS ? "zkLTC" : token.slice(0, 8) + "..."}/NUSD`,
      };
    }).filter(Boolean) as { token: `0x${string}`; nusd: `0x${string}`; pairId: `0x${string}`; label: string }[];
  }, [allPools, nusdAddress]);

  // Get pool data for each option (max 8)
  const pool0PairId = poolOptions[0]?.pairId;
  const pool1PairId = poolOptions[1]?.pairId;
  const pool2PairId = poolOptions[2]?.pairId;
  const pool3PairId = poolOptions[3]?.pairId;
  const pool4PairId = poolOptions[4]?.pairId;
  const pool5PairId = poolOptions[5]?.pairId;
  const pool6PairId = poolOptions[6]?.pairId;
  const pool7PairId = poolOptions[7]?.pairId;

  const { data: pool0Data, refetch: refetchPool0 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool0PairId ? [pool0PairId] : undefined);
  const { data: pool1Data, refetch: refetchPool1 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool1PairId ? [pool1PairId] : undefined);
  const { data: pool2Data, refetch: refetchPool2 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool2PairId ? [pool2PairId] : undefined);
  const { data: pool3Data, refetch: refetchPool3 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool3PairId ? [pool3PairId] : undefined);
  const { data: pool4Data, refetch: refetchPool4 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool4PairId ? [pool4PairId] : undefined);
  const { data: pool5Data, refetch: refetchPool5 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool5PairId ? [pool5PairId] : undefined);
  const { data: pool6Data, refetch: refetchPool6 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool6PairId ? [pool6PairId] : undefined);
  const { data: pool7Data, refetch: refetchPool7 } = useDexRead< readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint] >("pools", pool7PairId ? [pool7PairId] : undefined);
  const { refetch: refetchAllPools } = useAllPools();

  // Calculate total volume from all pools
  const totalVolume = useMemo(() => {
    const volumes = [pool0Data?.[6], pool1Data?.[6], pool2Data?.[6], pool3Data?.[6], pool4Data?.[6], pool5Data?.[6], pool6Data?.[6], pool7Data?.[6]];
    return volumes.reduce((sum: bigint, v) => sum + (v ?? 0n), 0n);
  }, [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data]);

  // Fetch token symbols for each pool
  const { data: token0Symbol } = useReadContract({
    address: poolOptions[0]?.token !== NATIVE_ADDRESS ? poolOptions[0]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[0]?.token && poolOptions[0]?.token !== NATIVE_ADDRESS }
  });
  const { data: token1Symbol } = useReadContract({
    address: poolOptions[1]?.token !== NATIVE_ADDRESS ? poolOptions[1]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[1]?.token && poolOptions[1]?.token !== NATIVE_ADDRESS }
  });
  const { data: token2Symbol } = useReadContract({
    address: poolOptions[2]?.token !== NATIVE_ADDRESS ? poolOptions[2]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[2]?.token && poolOptions[2]?.token !== NATIVE_ADDRESS }
  });
  const { data: token3Symbol } = useReadContract({
    address: poolOptions[3]?.token !== NATIVE_ADDRESS ? poolOptions[3]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[3]?.token && poolOptions[3]?.token !== NATIVE_ADDRESS }
  });
  const { data: token4Symbol } = useReadContract({
    address: poolOptions[4]?.token !== NATIVE_ADDRESS ? poolOptions[4]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[4]?.token && poolOptions[4]?.token !== NATIVE_ADDRESS }
  });
  const { data: token5Symbol } = useReadContract({
    address: poolOptions[5]?.token !== NATIVE_ADDRESS ? poolOptions[5]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[5]?.token && poolOptions[5]?.token !== NATIVE_ADDRESS }
  });
  const { data: token6Symbol } = useReadContract({
    address: poolOptions[6]?.token !== NATIVE_ADDRESS ? poolOptions[6]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[6]?.token && poolOptions[6]?.token !== NATIVE_ADDRESS }
  });
  const { data: token7Symbol } = useReadContract({
    address: poolOptions[7]?.token !== NATIVE_ADDRESS ? poolOptions[7]?.token : undefined,
    abi: erc20Abi,
    functionName: "symbol",
    query: { enabled: !!poolOptions[7]?.token && poolOptions[7]?.token !== NATIVE_ADDRESS }
  });

  const tokenSymbols = [token0Symbol, token1Symbol, token2Symbol, token3Symbol, token4Symbol, token5Symbol, token6Symbol, token7Symbol];

  // Collect all pool data
  type PoolDataTuple = readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint];
  const allPoolData = useMemo<PoolDataTuple[]>(() => {
    return [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data].filter(Boolean) as PoolDataTuple[];
  }, [pool0Data, pool1Data, pool2Data, pool3Data, pool4Data, pool5Data, pool6Data, pool7Data]);

  // Sort pools based on filter
  const sortedPoolIndices = useMemo(() => {
    const indices = poolOptions.map((_, i) => i);
    return indices.sort((a, b) => {
      const dataA = allPoolData[a];
      const dataB = allPoolData[b];
      if (!dataA) return 1;
      if (!dataB) return -1;
      
      switch (pairFilter) {
        case "tvl":
          // Use NUSD reserve as TVL proxy (all pools are paired with NUSD)
          return Number(dataB[3]) - Number(dataA[3]);
        case "vol24h":
          return Number(dataB[5]) - Number(dataA[5]); // volume24h (index 5)
        case "volAll":
          return Number(dataB[6]) - Number(dataA[6]); // totalVolume (index 6)
        case "new":
          return b - a; // newest first by index
        default:
          return 0;
      }
    });
  }, [poolOptions, allPoolData, pairFilter]);

  // Check if selected pool is Base Pool (contains NUSD) - only Base Pools can farm
  const isSelectedBasePool = useMemo(() => {
    if (poolOptions.length <= selectedFarmPool) return true;
    const pd = allPoolData[selectedFarmPool];
    if (!pd) return true;
    const token0 = pd[0];
    return token0 === nusdAddress || pd[1] === nusdAddress;
  }, [poolOptions, selectedFarmPool, allPoolData, nusdAddress]);

  // Get pool data
  const { data: pairId } = useDexRead<`0x${string}`>(
    "getPairId",
    swapTokenIn && swapTokenOut ? [swapTokenIn.address, swapTokenOut.address] : undefined
  );
  const { data: poolData } = useDexRead("pools", pairId ? [pairId] : undefined);
  const { data: userLP } = useDexRead<bigint>("userLP", pairId && address ? [pairId, address] : undefined);

  // Farm LP queries - use selectedFarmPool index
  const farmPairId = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.pairId : undefined;
  const farmPoolToken = poolOptions.length > selectedFarmPool ? poolOptions[selectedFarmPool]?.token : undefined;
  const { data: farmLPData, refetch: refetchFarmLP } = useDexRead<bigint>("userLP",
    farmPairId && address ? [farmPairId, address as `0x${string}`] : undefined
  );
  const { data: farmPendingReward, refetch: refetchPendingReward } = useDexRead<bigint>("getUserPendingReward",
    address ? [address as `0x${string}`] : undefined
  );
  
  // Farm token balance
  const { data: farmTokenBalance } = useTokenBalance(
    address, 
    farmPoolToken ? { address: farmPoolToken, symbol: "TOKEN", decimals: 18, name: "Token" } : null
  );
  
  // Farm token allowance
  const { data: farmTokenAllowance, refetch: refetchFarmAllowance } = useReadContract({
    address: farmPoolToken && farmPoolToken !== NATIVE_ADDRESS ? farmPoolToken : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: farmPoolToken && farmPoolToken !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: { enabled: !!address && !!farmPoolToken && farmPoolToken !== NATIVE_ADDRESS }
  });

  // Update farm state when data changes
  useEffect(() => { setFarmUserLP(farmLPData as bigint | undefined); }, [farmLPData]);
  useEffect(() => { setFarmPending(farmPendingReward as bigint | undefined); }, [farmPendingReward]);

  // Balances
  const { data: balanceIn } = useTokenBalance(address, swapTokenIn);
  const { data: balanceOut } = useTokenBalance(address, swapTokenOut);
  const { data: balancePoolToken } = useTokenBalance(address, poolToken);
  const { data: balanceNUSD } = useTokenBalance(address, KNOWN_TOKENS[1]);

  // Custom token balance & allowance
  const customToken = useMemo(() => customTokenAddress && /^0x[a-fA-F0-9]{40}$/.test(customTokenAddress)
    ? { address: customTokenAddress as `0x${string}`, symbol: "TOKEN", decimals: 18, name: "Custom Token" }
    : null, [customTokenAddress]);
  const { data: customBalance } = useTokenBalance(address, customToken);
  const { data: customAllowance } = useTokenAllowance(customToken, DEX_ADDRESS as `0x${string}`);

  // Real-time block updates for auto-refresh
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { refetch: refetchPool } = useDexRead("pools", pairId ? [pairId] : undefined);

  // Auto-refetch all data when block changes
  useEffect(() => {
    if (blockNumber) {
      // Refetch all pool data
      refetchPool?.();
      refetchAllPools?.();
      refetchFarmLP?.();
      refetchPendingReward?.();
      refetchAllowanceIn?.();
      refetchAllowancePool?.();
      refetchFarmAllowance?.();
      refetchAllowance?.();
      // Refetch individual pool data
      refetchPool0?.();
      refetchPool1?.();
      refetchPool2?.();
      refetchPool3?.();
      refetchPool4?.();
      refetchPool5?.();
      refetchPool6?.();
      refetchPool7?.();
    }
  }, [blockNumber]);

  // Allowances - use useReadContract directly for better reliability
  const { data: allowanceIn, refetch: refetchAllowanceIn, isError: allowanceInError } = useReadContract({
    address: swapTokenIn?.address !== NATIVE_ADDRESS ? swapTokenIn?.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: swapTokenIn?.address !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: {
      enabled: !!address && !!swapTokenIn && swapTokenIn.address !== NATIVE_ADDRESS,
    },
  });
  const { data: allowancePoolToken, refetch: refetchAllowancePool, isError: allowancePoolError } = useReadContract({
    address: poolToken?.address !== NATIVE_ADDRESS ? poolToken?.address : undefined,
    abi: erc20Abi,
    functionName: "allowance",
    args: poolToken?.address !== NATIVE_ADDRESS && address ? [address, DEX_ADDRESS as `0x${string}`] : undefined,
    query: {
      enabled: !!address && !!poolToken && poolToken.address !== NATIVE_ADDRESS,
    },
  });

  // Calculate swap output
  useEffect(() => {
    if (!poolData || !swapAmountIn || parseFloat(swapAmountIn) === 0) {
      setSwapAmountOut("");
      return;
    }
    const pd = poolData as PoolDataTuple;
    const amountIn = parseUnits(swapAmountIn, swapTokenIn.decimals);
    const t0 = pd[0];
    const r0 = pd[2];
    const r1 = pd[3];
    const isReversed = swapTokenIn.address !== t0;
    const reserveIn = isReversed ? r1 : r0;
    const reserveOut = isReversed ? r0 : r1;
    const amountOut = amountIn * reserveOut / (reserveIn + amountIn);
    setSwapAmountOut(Number(formatUnits(amountOut, swapTokenOut?.decimals || 18)).toFixed(6));
  }, [swapAmountIn, poolData, swapTokenIn, swapTokenOut]);

  // Auto-refetch when new block arrives
  useEffect(() => {
    if (blockNumber) {
      refetchAllowanceIn?.();
      refetchAllowancePool?.();
      refetchPool?.();
      refetchPool0?.();
      refetchPool1?.();
      refetchPool2?.();
      refetchPool3?.();
      refetchPool4?.();
      refetchPool5?.();
      refetchPool6?.();
      refetchPool7?.();
      refetchAllPools?.();
      refetchFarmLP?.();
      refetchPendingReward?.();
      refetchFarmAllowance?.();
      refetchAllowance?.();
    }
  }, [blockNumber]);

  useEffect(() => { setMounted(true); }, []);

  const handleSwap = () => {
    if (!swapTokenIn || !swapTokenOut || !swapAmountIn) return;
    if (swapTokenIn.address !== NATIVE_ADDRESS && needsSwapApproval) {
      toast.error("Approval required", `Please approve ${swapTokenIn.symbol} first`);
      return;
    }
    const amountIn = parseUnits(swapAmountIn, swapTokenIn.decimals);
    const minOut = parseUnits(String(parseFloat(swapAmountOut) * 0.95), swapTokenOut.decimals);
    swap(swapTokenIn.address, swapTokenOut.address, amountIn, minOut);
    toast.info("Swapping", "Please confirm transaction...");
  };

  const handleSwapApprove = () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!ensureCorrectChain()) return;
    if (!swapTokenIn) return;

    const isNUSD = swapTokenIn.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;
    const tokenAddr = swapTokenIn.address as `0x${string}`;

    toast.info("Approving", `Please approve ${swapTokenIn.symbol}...`);

    try {
      writeContract({
        address: tokenAddr,
        abi,
        functionName: "approve",
        args: [DEX_ADDRESS as `0x${string}`, maxUint256],
      });
    } catch (err) {
      console.error("Approve error:", err);
      toast.error("Error", "Failed to send approval transaction");
    }
  };

  const handleFixedSwap = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!swapAmountIn || !poolData || !swapTokenOut) return;
    if (swapTokenIn.address !== NATIVE_ADDRESS && needsSwapApproval) {
      toast.error("Approval required", `Please approve ${swapTokenIn.symbol} first`);
      return;
    }
    const amountIn = parseUnits(swapAmountIn, swapTokenIn.decimals);
    const minOut = parseUnits(String(parseFloat(swapAmountOut) * 0.99), swapTokenOut.decimals);
    swap(swapTokenIn.address, swapTokenOut.address, amountIn, minOut);
    toast.info("Swapping", "Please confirm transaction...");
  };

  const handleCustomSwap = () => {
    if (!customTokenAddress || !customAmountIn) return;
    const tokenIn = customDirection === "token_to_nusd" ? customTokenAddress : nusdAddress!;
    const tokenOut = customDirection === "token_to_nusd" ? nusdAddress! : customTokenAddress;
    const amountIn = parseUnits(customAmountIn, 18);
    const minOut = parseUnits(String(parseFloat(customAmountOut) * 0.95), 18);
    swap(tokenIn as `0x${string}`, tokenOut as `0x${string}`, amountIn, minOut);
    toast.info("Swapping", "Please confirm transaction...");
  };

  const handlePoolSwap = (token0: `0x${string}`, token1: `0x${string}`) => {
    setActiveTab("swap");
    const token0Obj = KNOWN_TOKENS.find(t => t.address === token0) || { address: token0, symbol: "TOKEN", decimals: 18, name: "Token" };
    const token1Obj = KNOWN_TOKENS.find(t => t.address === token1) || { address: token1, symbol: "TOKEN", decimals: 18, name: "Token" };
    setSwapTokenIn(token0Obj);
    setSwapTokenOut(token1Obj);
  };

  const handleCustomApprove = () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!customToken) return;

    const isNUSD = customToken.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${customToken.symbol}...`);
    writeContract({
      address: customToken.address as `0x${string}`,
      abi,
      functionName: "approve",
      args: [DEX_ADDRESS as `0x${string}`, maxUint256],
    });
  };

  // Custom swap calculation
  useEffect(() => {
    if (!customTokenAddress || !customAmountIn || parseFloat(customAmountIn) === 0) {
      setCustomAmountOut("");
      return;
    }
    const tokenIn = customDirection === "token_to_nusd" ? customTokenAddress : nusdAddress!;
    const tokenOut = customDirection === "token_to_nusd" ? nusdAddress! : customTokenAddress;
    // Use same calculation logic as main swap
    const amountIn = parseUnits(customAmountIn, 18);
    const pairId = keccak256(encodePacked(["address", "address"], [tokenIn < tokenOut ? tokenIn as `0x${string}` : tokenOut as `0x${string}`, tokenIn < tokenOut ? tokenOut as `0x${string}` : tokenIn as `0x${string}`]));
    // For now estimate with 1% fee formula
    const estimatedOut = amountIn * 99n / 100n;
    setCustomAmountOut(Number(formatUnits(estimatedOut, 18)).toFixed(6));
  }, [customAmountIn, customDirection, customTokenAddress, nusdAddress]);

  const handleAddLiquidity = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!poolToken || !poolAmountToken || !poolAmountNUSD) return;
    if (poolToken.address !== NATIVE_ADDRESS && (!allowancePoolToken || allowancePoolToken < parseUnits(poolAmountToken, poolToken.decimals))) {
      toast.error("Approval required", `Please approve ${poolToken.symbol} first`);
      return;
    }
    const amountToken = parseUnits(poolAmountToken, poolToken.decimals);
    const amountNUSD = parseUnits(poolAmountNUSD, 18);
    addLiquidity(poolToken.address, nusdAddress!, amountToken, amountNUSD);
    toast.info("Adding liquidity", "Please confirm transaction...");
  };

  // Farm handlers - Add Liquidity to farm
  const handleFarmAdd = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!farmNUSDAmount || !farmPairId) return;
    if (!farmPoolToken) return;
    
    const amountNUSD = parseUnits(farmNUSDAmount, 18);
    const pd = allPoolData[selectedFarmPool];
    
    if (!pd) return;
    
    // Calculate token amount based on pool ratio
    const reserve0 = pd[2];
    const reserve1 = pd[3];
    const totalLP = pd[4];
    
    // Calculate how much token needed for the NUSD amount
    let tokenAmount: bigint;
    if (totalLP === 0n) {
      // New pool - use 1:1 ratio
      tokenAmount = amountNUSD;
    } else {
      // Existing pool - use ratio from reserves
      if (nusdAddress === pd[0]) {
        // NUSD is token0
        tokenAmount = reserve1 > 0 ? (amountNUSD * reserve1) / reserve0 : amountNUSD;
      } else {
        // NUSD is token1
        tokenAmount = reserve0 > 0 ? (amountNUSD * reserve0) / reserve1 : amountNUSD;
      }
    }
    
    // Check approval for non-native tokens
    if (farmPoolToken !== NATIVE_ADDRESS) {
      if (!farmTokenAllowance || (farmTokenAllowance as bigint) < tokenAmount) {
        toast.error("Approval required", `Please click "Approve ${(tokenSymbols[selectedFarmPool] as string) || "Token"}\" first`);
        return;
      }
    }
    
    addLiquidity(farmPoolToken, nusdAddress!, tokenAmount, amountNUSD);
    toast.info("Adding Liquidity", "Please confirm transaction to farm...");
  };

  const handleFarmRemove = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!farmLpAmount || !farmPairId) return;
    const amount = parseUnits(farmLpAmount, 18);
    removeLiquidity(farmPairId, amount);
    toast.info("Removing Liquidity", "Please confirm transaction...");
  };

  const handleClaim = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    claimReward();
    toast.info("Claiming reward", "Please confirm transaction...");
  };

  // Auto-switch to LitVM helper
  const ensureCorrectChain = () => {
    if (isConnected && chainId && chainId !== LITVM_CHAIN_ID) {
      toast.info("Wrong Network", "Switching to LitVM...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
      return false;
    }
    return true;
  };

  const handleApprove = (token: Token) => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!ensureCorrectChain()) return;

    const isNUSD = token.address.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${token.symbol || "Token"}...`);
    writeContract({
      address: token.address as `0x${string}`,
      abi,
      functionName: "approve",
      args: [DEX_ADDRESS as `0x${string}`, maxUint256],
    });
  };

  const handleApproveCustomToken = () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (!createTokenA) return;

    const isNUSD = createTokenA.toLowerCase() === NUSD_ADDRESS.toLowerCase();
    const abi = isNUSD ? NUSD_ABI : erc20Abi;

    toast.info("Approving", `Please approve ${tokenSymbol || "Token"}...`);
    writeContract({
      address: createTokenA as `0x${string}`,
      abi,
      functionName: "approve",
      args: [DEX_ADDRESS as `0x${string}`, maxUint256],
    }, {
      onSuccess: () => {
        setTimeout(() => {
          refetchAllowance?.();
          refetchAllowanceIn?.();
          refetchAllowancePool?.();
          refetchFarmAllowance?.();
        }, 2000);
      }
    });
  };

  // Create Pool uses addLiquidity (only owner can create new pools)
  const handleCreatePool = () => {
    if (!isConnected || !ensureCorrectChain()) return;
    if (!isOwner) {
      toast.error("Permission denied", "Only contract owner can create new pools");
      return;
    }
    if (!createTokenA || !createAmountA || !createAmountB) return;
    
    const tokenA = createTokenA.trim() as `0x${string}`;
    const tokenB = nusdAddress!;
    const amountA = parseUnits(createAmountA, tokenDecimals || 18);
    const amountB = parseUnits(createAmountB, 18);
    
    // Check approval for tokenA
    if (tokenA !== NATIVE_ADDRESS && needsCreateApproval) {
      toast.error("Approval required", `Please approve ${tokenSymbol || "token"} first`);
      return;
    }
    
    // Use addLiquidity to create pool (creates pool + adds liquidity in one tx)
    addLiquidity(tokenA, tokenB, amountA, amountB);
    toast.info("Creating Pool", "Please confirm transaction...");
  };

  const needsSwapApproval = swapTokenIn && swapTokenIn.address !== NATIVE_ADDRESS && !allowanceInError && allowanceIn !== undefined && allowanceIn === 0n;
  const needsPoolApproval = poolToken && poolToken.address !== NATIVE_ADDRESS && !allowancePoolError && allowancePoolToken !== undefined && allowancePoolToken === 0n;
  const needsCustomApproval = customDirection === "token_to_nusd" && customToken && customBalance && (!customAllowance || (customAllowance as bigint) < parseUnits(customAmountIn || "0", 18));

  // Calculate pairIds for pools
  const getPairId = (token: `0x${string}`, nusd: `0x${string}`) => 
    keccak256(encodePacked(["address", "address"], [token < nusd ? token : nusd, token < nusd ? nusd : token]));

  if (!mounted) return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center">
      <div className="relative">
        <div className="w-16 h-16 border-4 border-purple-500/30 border-t-purple-500 animate-spin rounded-full" />
        <div className="absolute inset-0 w-16 h-16 border-4 border-indigo-500/20 border-t-indigo-500 animate-spin rounded-full" style={{ animationDirection: 'reverse', animationDuration: '1.5s' }} />
      </div>
      <div className="mt-6 text-lg text-purple-400 animate-pulse" style={{ fontFamily: "var(--font-departure)" }}>
        LOADING
      </div>
      <div className="flex gap-1 mt-2">
        <span className="w-2 h-2 bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-2 h-2 bg-indigo-500 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-2 h-2 bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }} />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/NUSD_LOGO.jpg" alt="0xDex" width={32} height={32} className="w-8 h-8 rounded-full" />
            <span className="text-white font-bold" style={{ fontFamily: "var(--font-departure)" }}>0xDex</span>
          </Link>
          <div className="flex items-center gap-3">
            <div className="text-xs text-[#64748B]">LitVM LiteForge</div>
            {isConnected && address ? (
              <button
                onClick={() => disconnect()}
                className="px-3 py-1.5 rounded-lg bg-[#2D2D44] text-white text-xs font-bold hover:bg-[#3D3D54] transition-colors"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {address.slice(0, 6)}...{address.slice(-4)}
              </button>
            ) : (
              <button
                onClick={() => connectors[0] && connect({ connector: connectors[0] })}
                className="px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-bold hover:opacity-90 transition-opacity"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                Connect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-[100rem] mx-auto px-4 py-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="TVL" value={formatUSD(stats.totalNUSDLocked)} icon="◫" />
          <StatCard label="Total Volume" value={formatUSD(totalVolume)} icon="◈" />
          <StatCard label="Pools" value={String(allPools?.length || 0)} icon="◫" />
          <StatCard label="Your Rewards" value={pendingReward ? formatUSD(pendingReward) : "$0.00"} icon="★" color="emerald" />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          {[
            { id: "swap", label: "⇄ SWAP", color: "indigo" },
            { id: "addpool", label: "+ ADD POOL", color: "rose" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`flex-1 py-3 rounded-lg font-bold text-sm transition-all ${
                activeTab === tab.id
                  ? tab.color === "emerald" ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/40"
                  : tab.color === "amber" ? "bg-amber-500/20 text-amber-400 border border-amber-500/40"
                  : tab.color === "rose" ? "bg-rose-500/20 text-rose-400 border border-rose-500/40"
                  : "bg-indigo-500/20 text-indigo-400 border border-indigo-500/40"
                  : "bg-[#1A1A2E] text-[#64748B] border border-[#2D2D44] hover:text-white"
              }`}
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left Panel - Swap */}
          <div className="bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5">
            {activeTab === "swap" && (
              <>
                <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>Swap</h2>

                {/* From */}
                <div className="mb-2">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">From</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceIn ? Number(formatUnits(balanceIn as bigint, swapTokenIn.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="bg-[#13131F] rounded-xl border border-[#2D2D44] p-4">
                    <input
                      type="number"
                      value={swapAmountIn}
                      onChange={(e) => setSwapAmountIn(e.target.value)}
                      placeholder="0.0"
                      className="w-full bg-transparent text-2xl font-bold text-white outline-none"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <div className="mt-2 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {swapTokenIn.logo && (
                          <Image src={swapTokenIn.logo} alt={swapTokenIn.symbol} width={20} height={20} className="rounded-full" />
                        )}
                        <span className="font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
                          {swapTokenIn.symbol}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Swap Button */}
                <div className="flex justify-center -my-2 relative z-10">
                  <button
                    onClick={() => {
                      const temp = swapTokenIn;
                      if (swapTokenOut) {
                        setSwapTokenIn(swapTokenOut);
                        setSwapTokenOut(temp);
                        setSwapAmountIn(swapAmountOut || "");
                        setSwapAmountOut("");
                      }
                    }}
                    className="w-10 h-10 rounded-full bg-indigo-500 border-4 border-[#1A1A2E] flex items-center justify-center text-white font-bold hover:bg-indigo-400 transition-all"
                  >
                    ⇅
                  </button>
                </div>

                {/* To */}
                <div className="mb-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">To</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceOut && swapTokenOut ? Number(formatUnits(balanceOut as bigint, swapTokenOut.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="bg-[#13131F] rounded-xl border border-[#2D2D44] p-4">
                    <input
                      type="number"
                      value={swapAmountOut}
                      readOnly
                      placeholder="0.0"
                      className="w-full bg-transparent text-2xl font-bold text-white outline-none"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <div className="mt-2 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        {swapTokenOut && swapTokenOut.logo && (
                          <Image src={swapTokenOut.logo} alt={swapTokenOut.symbol} width={20} height={20} className="rounded-full" />
                        )}
                        <span className="font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
                          {swapTokenOut?.symbol}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Pool & Slippage Info */}
                {poolData && swapAmountOut && swapTokenOut && (
                  <div className="mb-4 p-3 rounded-xl bg-[#13131F]/80 border border-[#2D2D44] text-xs space-y-1">
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Pool</span>
                      <span className="text-indigo-400 font-bold">{swapTokenIn.symbol} → {swapTokenOut.symbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Price Impact</span>
                      {(() => {
                        const amountInWei = parseUnits(swapAmountIn || "0", swapTokenIn.decimals);
                        const pd = poolData as PoolDataTuple;
                        const t0 = pd[0];
                        const r0 = pd[2];
                        const r1 = pd[3];
                        const reserveIn = swapTokenIn.address === t0 ? r0 : r1;
                        const priceImpact = reserveIn > 0n ? (Number(amountInWei) / Number(reserveIn) * 100) : 0;
                        return (
                          <span className={priceImpact > 5 ? "text-red-400" : "text-emerald-400"}>
                            {priceImpact.toFixed(2)}%
                          </span>
                        );
                      })()}
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Slippage</span>
                      <span className="text-white">1.0%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">Fee</span>
                      <span className="text-white">1%</span>
                    </div>
                  </div>
                )}

                {/* Approval */}
                {needsSwapApproval && (
                  <button onClick={handleSwapApprove} className="w-full mb-3 py-4 rounded-xl bg-amber-500 text-amber-900 font-bold text-sm hover:bg-amber-400" style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(245, 158, 11, 0.3)" }}>
                    APPROVE {swapTokenIn.symbol}
                  </button>
                )}

                {/* Button */}
                <button
                  onClick={handleFixedSwap}
                  disabled={!swapAmountIn || !poolData || !swapTokenIn || needsSwapApproval}
                  className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-indigo-500 to-purple-500 disabled:opacity-50"
                  style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(99, 102, 241, 0.3)" }}
                >
                  {!isConnected ? "Connect Wallet" : !swapAmountIn ? "Enter Amount" : !poolData ? "No Pool Found" : needsSwapApproval ? `Approve ${swapTokenIn.symbol}` : "Swap"}
                </button>
              </>
            )}

            {activeTab === "pools" && (
              <>
                <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>Add Liquidity</h2>

                {/* Pool Price */}
                {poolData && (
                  <div className="mb-4 p-3 rounded-lg bg-[#13131F]/50 border border-[#2D2D44] text-sm">
                    <div className="flex justify-between">
                      <span className="text-[#64748B]">1 NUSD =</span>
                      <span className="text-emerald-400 font-bold">
                        ${poolData ? (Number(formatUnits((poolData as PoolDataTuple)[2], 18)) / Number(formatUnits((poolData as PoolDataTuple)[3], poolToken.decimals))).toFixed(6) : "0"} {poolToken.symbol}
                      </span>
                    </div>
                    <div className="flex justify-between mt-1">
                      <span className="text-[#64748B]">1 {poolToken.symbol} =</span>
                      <span className="text-indigo-400 font-bold">
                        ${poolData ? (Number(formatUnits((poolData as PoolDataTuple)[3], poolToken.decimals)) / Number(formatUnits((poolData as PoolDataTuple)[2], 18))).toFixed(6) : "0"} NUSD
                      </span>
                    </div>
                  </div>
                )}

                {/* Pool Token */}
                <div className="mb-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Token / NUSD</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balancePoolToken ? Number(formatUnits(balancePoolToken as bigint, poolToken.decimals)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={poolAmountToken}
                      onChange={(e) => setPoolAmountToken(e.target.value)}
                      placeholder="0.0"
                      className="flex-1 bg-[#13131F] p-3 rounded-lg text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-emerald-500"
                      style={{ fontFamily: "var(--font-departure)" }}
                    />
                    <select
                      value={poolToken.address}
                      onChange={(e) => setPoolToken(KNOWN_TOKENS.find(t => t.address === e.target.value)!)}
                      className="bg-[#13131F] p-3 rounded-lg text-white border border-[#2D2D44] outline-none"
                    >
                      {KNOWN_TOKENS.map(t => <option key={t.address} value={t.address}>{t.symbol}</option>)}
                    </select>
                  </div>
                </div>

                {/* NUSD */}
                <div className="mb-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">NUSD</span>
                    <span className="text-xs text-[#64748B]">
                      Balance: {balanceNUSD ? Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4) : "0"}
                    </span>
                  </div>
                  <input
                    type="number"
                    value={poolAmountNUSD}
                    onChange={(e) => setPoolAmountNUSD(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] p-3 rounded-lg text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-emerald-500"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                </div>

                {/* Approval */}
                {needsPoolApproval && (
                  <button onClick={() => handleApprove(poolToken)} className="w-full mb-3 py-4 rounded-xl bg-amber-500 text-amber-900 font-bold text-sm hover:bg-amber-400" style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(245, 158, 11, 0.3)" }}>
                    APPROVE {poolToken.symbol}
                  </button>
                )}

                {/* Button */}
                <button
                  onClick={handleAddLiquidity}
                  disabled={!poolAmountToken || !poolAmountNUSD || needsPoolApproval}
                  className="w-full py-4 rounded-xl font-bold text-white bg-gradient-to-r from-emerald-500 to-teal-500 disabled:opacity-50"
                  style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(16, 185, 129, 0.3)" }}
                >
                  {!isConnected ? "Connect Wallet" : !poolAmountToken || !poolAmountNUSD ? "Enter Amounts" : "Add Liquidity"}
                </button>
              </>
            )}

            {activeTab === "addpool" && (
              <>
                <h2 className="text-lg font-bold text-white mb-2" style={{ fontFamily: "var(--font-departure)" }}>Create New Pool</h2>
                
                {/* Owner Warning */}
                {!isOwner && (
                  <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-xs text-amber-400">
                    Only the contract owner can create new pools. Owner: {owner ? `${owner.slice(0, 10)}...` : "Loading..."}
                  </div>
                )}
                
                {/* Pool Token Address */}
                <div className="mb-3">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Token Address</span>
                    {createTokenBalance !== undefined && (
                      <span className="text-xs text-[#64748B]">
                        Balance: {tokenDecimals && createTokenBalance ? Number(formatUnits(createTokenBalance as bigint, tokenDecimals)).toFixed(4) : Number(createTokenBalance || 0n).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={createTokenA}
                    onChange={(e) => setCreateTokenA(e.target.value)}
                    placeholder="0x..."
                    className="w-full bg-[#13131F] p-3 rounded-lg text-sm font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {tokenName && (
                    <div className="mt-1 text-xs text-emerald-400">
                      {tokenName as string} ({tokenSymbol as string})
                    </div>
                  )}
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5 px-1">
                    <span className="text-xs text-[#64748B]">Token Amount</span>
                  </div>
                  <input
                    type="number"
                    value={createAmountA}
                    onChange={(e) => setCreateAmountA(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] px-4 py-3 rounded-lg text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {createTokenBalance !== undefined && (
                    <div className="flex gap-1 mt-1.5">
                      {[25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            const bal = tokenDecimals && createTokenBalance ? Number(formatUnits(createTokenBalance as bigint, tokenDecimals)) : 0;
                            setCreateAmountA((bal * pct / 100).toString());
                          }}
                          className="flex-1 py-1 text-[10px] bg-[#2D2D44] hover:bg-rose-500/30 rounded text-[#64748B] hover:text-white transition-colors font-bold"
                          style={{ fontFamily: "var(--font-departure)" }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Fixed NUSD */}
                <div className="mb-3 mt-4">
                  <div className="flex justify-between mb-2">
                    <span className="text-xs text-[#64748B]">Pair With</span>
                    {balanceNUSD !== undefined && (
                      <span className="text-xs text-[#64748B]">
                        Balance: {Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4)}
                      </span>
                    )}
                  </div>
                  <div className="bg-[#13131F] p-3 rounded-lg text-sm font-bold text-white border border-[#2D2D44]">
                    $NUSD
                  </div>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1.5 px-1">
                    <span className="text-xs text-[#64748B]">$NUSD Amount</span>
                  </div>
                  <input
                    type="number"
                    value={createAmountB}
                    onChange={(e) => setCreateAmountB(e.target.value)}
                    placeholder="0.0"
                    className="w-full bg-[#13131F] px-4 py-3 rounded-lg text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-rose-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  {balanceNUSD !== undefined && (
                    <div className="flex gap-1 mt-1.5">
                      {[25, 50, 75, 100].map(pct => (
                        <button
                          key={pct}
                          onClick={() => {
                            const bal = Number(formatUnits(balanceNUSD as bigint, 18));
                            setCreateAmountB((bal * pct / 100).toString());
                          }}
                          className="flex-1 py-1 text-[10px] bg-[#2D2D44] hover:bg-rose-500/30 rounded text-[#64748B] hover:text-white transition-colors font-bold"
                          style={{ fontFamily: "var(--font-departure)" }}
                        >
                          {pct}%
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Price Info */}
                {createAmountA && createAmountB && Number(createAmountB) > 0 && Number(createAmountA) > 0 && (
                  <div className="mt-4 px-1 text-xs flex justify-between">
                    <span className="text-[#64748B]">Initial Price</span>
                    <span className="text-emerald-400 font-bold">
                      1 {createTokenSymbol || "Token"} = {(Number(createAmountB) / Number(createAmountA)).toFixed(6)} $NUSD
                    </span>
                  </div>
                )}

                {/* Create Pool Button */}
                <button
                  onClick={needsCreateApproval ? handleApproveCustomToken : handleCreatePool}
                  disabled={!isOwner || !createTokenA || !createAmountA || !createAmountB}
                  className={`w-full mt-4 py-4 rounded-xl font-bold text-white disabled:opacity-50 ${
                    needsCreateApproval 
                      ? "bg-amber-500 hover:bg-amber-600" 
                      : "bg-gradient-to-r from-rose-500 to-red-600"
                  }`}
                  style={{ fontFamily: "var(--font-departure)", boxShadow: needsCreateApproval ? "0 0 20px rgba(245, 158, 11, 0.3)" : "0 0 20px rgba(244, 63, 94, 0.3)" }}
                >
                  {!isConnected ? "Connect Wallet" : !isOwner ? "Not Owner" : !createTokenA ? "Enter Token Address" : !createAmountA || !createAmountB ? "Enter Amounts" : needsCreateApproval ? `Approve ${createTokenSymbol || "Token"} & Create Pool` : "Create Pool"}
                </button>
              </>
            )}
          </div>

          {/* Middle Panel - Top Pairs */}
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-white" style={{ fontFamily: "var(--font-departure)" }}>
                Top Pairs ({poolOptions.length})
              </h2>
              <div className="flex gap-1 bg-[#13131F] p-1 rounded-lg">
                {(["tvl", "vol24h", "volAll", "new"] as const).map((filter) => (
                  <button
                    key={filter}
                    onClick={() => setPairFilter(filter)}
                    className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                      pairFilter === filter
                        ? "bg-indigo-500 text-white"
                        : "text-[#64748B] hover:text-white"
                    }`}
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    {filter === "tvl" ? "TVL" : filter === "vol24h" ? "Vol 24h" : filter === "volAll" ? "Vol All" : "New"}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {poolOptions.length > 0 ? (
                sortedPoolIndices.slice(0, 8).map((poolIndex) => {
                  const pool = poolOptions[poolIndex];
                  const pData = allPoolData[poolIndex];
                  const token0 = pData?.[0] as `0x${string}` | undefined;
                  const token1 = pData?.[1] as `0x${string}` | undefined;

                  if (!pData) return (
                    <div key={poolIndex} className="p-4 rounded-xl bg-[#13131F] border border-[#2D2D44] animate-pulse">
                      <div className="h-6 bg-[#2D2D44] rounded w-24" />
                    </div>
                  );

                  return (
                    <PoolCard
                      key={poolIndex}
                      rank={sortedPoolIndices.indexOf(poolIndex) + 1}
                      token0={token0 || pool.token}
                      token1={token1 || pool.nusd}
                      reserve0={(pData[2] as bigint) || 0n}
                      reserve1={(pData[3] as bigint) || 0n}
                      volume24h={(pData[5] as bigint) || 0n}
                      totalVolume={(pData[6] as bigint) || 0n}
                      lpTotal={(pData[4] as bigint) || 0n}
                      tokenSymbol={pool.token === NATIVE_ADDRESS ? "zkLTC" : (tokenSymbols[poolIndex] as string) || undefined}
                      onSelect={() => {
                        setActiveTab("swap");
                        setSwapTokenIn(KNOWN_TOKENS[1]);
                        if (pool.token.toLowerCase() === NATIVE_ADDRESS.toLowerCase()) {
                          setSwapTokenOut(NATIVE_TOKEN);
                        } else {
                          setSwapTokenOut({ address: pool.token, symbol: (tokenSymbols[poolIndex] as string) || "TOKEN", decimals: 18, name: "Token" });
                        }
                        setSwapMode("fixed");
                      }}
                    />
                  );
                })
              ) : (
                <div className="p-8 text-center text-[#64748B]">
                  No pools available
                </div>
              )}
            </div>
          </div>

          {/* Right Panel - Farm */}
          <div>
            {/* Farm Panel */}
            <div className="bg-[#1A1A2E]/90 border border-amber-500/30 rounded-2xl p-5">
              <h2 className="text-lg font-bold text-amber-400 mb-1" style={{ fontFamily: "var(--font-departure)" }}>
                Liquidity Mining
              </h2>
              <p className="text-xs text-[#64748B] mb-4">Add liquidity to Base Pools (with NUSD) to earn rewards</p>

              {isSelectedBasePool && (
                <div className="mb-4 p-3 bg-emerald-500/10 text-emerald-400 rounded-xl text-xs text-center" style={{ fontFamily: "var(--font-departure)" }}>
                  Supports Liquidity Mining rewards
                </div>
              )}

              {/* Warnings */}
              {!isSelectedBasePool && (
                <div className="mb-4 p-3 bg-blue-500/10 text-blue-400 rounded-xl text-xs" style={{ fontFamily: "var(--font-departure)" }}>
                  This pool is not a Base Pool - Cannot earn Liquidity Mining rewards
                </div>
              )}

              {/* Pool Selector */}
              <div className="mb-4">
                <span className="text-xs text-[#64748B] block mb-2" style={{ fontFamily: "var(--font-departure)" }}>Select Base Pool</span>
                <select
                  value={selectedFarmPool}
                  onChange={(e) => setSelectedFarmPool(parseInt(e.target.value))}
                  className="w-full bg-[#13131F] p-3 rounded-xl text-white border border-[#2D2D44] outline-none"
                  style={{ fontFamily: "var(--font-departure)" }}
                >
                  {poolOptions.map((p, i) => (
                    <option key={i} value={i}>
                      {p.token === NATIVE_ADDRESS ? "zkLTC" : (tokenSymbols[i] as string) || `Pool ${i + 1}`}/NUSD
                    </option>
                  ))}
                </select>
              </div>

              {/* Farm Stats */}
              {allPoolData[selectedFarmPool] && (
                <div className="mb-4 p-3 rounded-xl bg-[#13131F]/50 border border-[#2D2D44] text-xs space-y-2">
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Your LP Shares</span>
                    <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>{farmUserLP ? formatNum(farmUserLP) : "0"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Total LP</span>
                    <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>{formatNum((allPoolData[selectedFarmPool]?.[4] as bigint) || 0n)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#64748B]">Pending Reward</span>
                    <span className="text-emerald-400 font-bold" style={{ fontFamily: "var(--font-departure)" }}>{farmPending ? formatUSD(farmPending) : "$0"}</span>
                  </div>
                </div>
              )}

              {/* NUSD Amount Input */}
              <div className="mb-3">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>NUSD Amount</span>
                  <button
                    onClick={() => balanceNUSD && setFarmNUSDAmount(Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4))}
                    className="text-xs text-amber-400"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    Balance: {balanceNUSD ? Number(formatUnits(balanceNUSD as bigint, 18)).toFixed(4) : "0"}
                  </button>
                </div>
                <input
                  type="number"
                  value={farmNUSDAmount}
                  onChange={(e) => setFarmNUSDAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-[#13131F] p-3 rounded-xl text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-amber-500"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
              </div>

              {/* Token Amount (auto-calculated) */}
              <div className="mb-4 p-3 rounded-xl bg-[#13131F]/50 border border-[#2D2D44] text-xs">
                <div className="flex justify-between">
                  <span className="text-[#64748B]">{farmPoolToken === NATIVE_ADDRESS ? "zkLTC" : (tokenSymbols[selectedFarmPool] as string) || "Token"} Amount</span>
                  <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>
                    {farmNUSDAmount && allPoolData[selectedFarmPool] ? (
                      (() => {
                        const pd = allPoolData[selectedFarmPool];
                        const reserve0 = pd[2] as bigint;
                        const reserve1 = pd[3] as bigint;
                        const totalLP = pd[4] as bigint;
                        const amountNUSD = parseUnits(farmNUSDAmount, 18);
                        let tokenAmt: bigint;
                        if (totalLP === 0n) {
                          tokenAmt = amountNUSD;
                        } else {
                          if (nusdAddress === pd[0]) {
                            tokenAmt = reserve1 > 0n ? (amountNUSD * reserve1) / reserve0 : amountNUSD;
                          } else {
                            tokenAmt = reserve0 > 0n ? (amountNUSD * reserve0) / reserve1 : amountNUSD;
                          }
                        }
                        return `${Number(formatUnits(tokenAmt, 18)).toFixed(4)}`;
                      })()
                    ) : "0.0000"}
                  </span>
                </div>
              </div>

              {/* Check if approval needed for farm */}
              {farmPoolToken && farmPoolToken !== NATIVE_ADDRESS && (
                <div className="mb-4">
                  {(!farmTokenAllowance || (farmTokenAllowance as bigint) === 0n) ? (
                    <button
                      onClick={() => handleApprove({
                        address: farmPoolToken as `0x${string}`,
                        symbol: (tokenSymbols[selectedFarmPool] as string) || "TOKEN",
                        decimals: 18,
                        name: "Token"
                      })}
                      className="w-full py-3 rounded-xl bg-amber-500 text-amber-900 font-bold text-sm hover:bg-amber-400"
                      style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(245, 158, 11, 0.3)" }}
                    >
                      APPROVE {(tokenSymbols[selectedFarmPool] as string) || "Token"}
                    </button>
                  ) : (
                    <div className="text-xs text-emerald-400 text-center p-2 rounded-xl bg-emerald-500/10" style={{ fontFamily: "var(--font-departure)" }}>
                      Token Approved ✓
                    </div>
                  )}
                </div>
              )}

              {/* Add/Remove Buttons */}
              <div className="flex gap-3">
                <button
                  onClick={handleFarmAdd}
                  disabled={!farmNUSDAmount || !farmNUSDAmount || parseFloat(farmNUSDAmount) <= 0}
                  className="flex-1 py-3 rounded-xl bg-emerald-500 text-emerald-900 font-bold text-sm hover:bg-emerald-400 disabled:opacity-50"
                  style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(16, 185, 129, 0.3)" }}
                >
                  Add Liquidity
                </button>
                <button
                  onClick={handleFarmRemove}
                  disabled={!farmLpAmount || !farmUserLP || parseFloat(farmLpAmount) <= 0}
                  className="flex-1 py-3 rounded-xl bg-amber-500 text-amber-900 font-bold text-sm hover:bg-amber-400 disabled:opacity-50"
                  style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(245, 158, 11, 0.3)" }}
                >
                  Remove LP
                </button>
              </div>
              
              {/* LP Amount for removal */}
              <div className="mt-3 mb-3">
                <div className="flex justify-between mb-2">
                  <span className="text-xs text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>LP to Remove</span>
                  <button
                    onClick={() => farmUserLP && setFarmLpAmount(Number(formatUnits(farmUserLP, 18)).toFixed(4))}
                    className="text-xs text-amber-400"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    Max: {farmUserLP ? formatNum(farmUserLP) : "0"}
                  </button>
                </div>
                <input
                  type="number"
                  value={farmLpAmount}
                  onChange={(e) => setFarmLpAmount(e.target.value)}
                  placeholder="0.0"
                  className="w-full bg-[#13131F] p-3 rounded-xl text-lg font-bold text-white outline-none border border-[#2D2D44] focus:border-amber-500"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
              </div>

              {/* Claim Button - Compact */}
              <button
                onClick={handleClaim}
                disabled={!farmPending || farmPending === 0n}
                className="w-full py-3 rounded-xl bg-amber-500 text-amber-900 font-bold text-sm hover:bg-amber-400 disabled:opacity-50"
                style={{ fontFamily: "var(--font-departure)", boxShadow: "0 0 20px rgba(245, 158, 11, 0.3)" }}
              >
                CLAIM ({farmPending ? formatUSD(farmPending) : "$0"})
              </button>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
}