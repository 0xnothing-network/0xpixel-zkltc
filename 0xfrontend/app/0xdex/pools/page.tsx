"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAccount, usePublicClient, useReadContract, useReadContracts, useSwitchChain } from "wagmi";
import { useDexWrite, NATIVE_TOKEN, Token, useTokenBalance, useAllPools } from "@/lib/use0xDex";
import { DEX_ABI, DEX_ADDRESS, NATIVE_ADDRESS } from "@/lib/0xDexAbi";
import { NUSD_ADDRESS } from "@/lib/NUSDContract";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useToast } from "@/components/Toast";
import { useChainId } from "wagmi";
import { LITVM_CHAIN_ID } from "@/lib/chainSwitch";
import {
  getAddressExplorerUrl,
  getTokenExplorerUrl,
  getTransactionExplorerUrl,
} from "@/lib/explorer";

const DEX_NAV = [
  { href: "/0xdex", label: "Dashboard", icon: "◈" },
  { href: "/0xdex/swap", label: "Swap", icon: "⇄" },
  { href: "/0xdex/pools", label: "Pools", icon: "◫" },
] as const;

const KNOWN_TOKENS: Token[] = [
  NATIVE_TOKEN,
  {
    address: NUSD_ADDRESS,
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

function safeParseAmount(value: string, decimals: number) {
  try {
    const parsed = parseUnits(value, decimals);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

const LP_SHARE_BPS = 10_000n;

function getLpRisk(
  walletLP: bigint | undefined,
  totalLP: bigint,
  isConnected: boolean,
  isLoading = false,
) {
  if (!isConnected) {
    return {
      label: "N/A",
      share: "Connect wallet",
      className: "border-[#2D2D44] bg-[#2D2D44]/30 text-[#64748B]",
    };
  }
  if (walletLP === undefined) {
    return {
      label: isLoading ? "..." : "N/A",
      share: isLoading ? "Loading" : "Unavailable",
      className: "border-[#2D2D44] bg-[#2D2D44]/30 text-[#64748B]",
    };
  }
  if (totalLP === 0n) {
    return {
      label: "NO LP",
      share: "No liquidity",
      className: "border-[#2D2D44] bg-[#2D2D44]/30 text-[#64748B]",
    };
  }
  if (walletLP === 0n) {
    return {
      label: "NO LP",
      share: "0% share",
      className: "border-[#2D2D44] bg-[#2D2D44]/30 text-[#64748B]",
    };
  }

  const shareBps = walletLP >= totalLP
    ? LP_SHARE_BPS
    : (walletLP * LP_SHARE_BPS) / totalLP;
  const share = shareBps === 0n
    ? "<0.01% share"
    : `${shareBps / 100n}.${(shareBps % 100n).toString().padStart(2, "0")}% share`;

  if (shareBps === LP_SHARE_BPS) {
    return {
      label: "SAFE",
      share,
      className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-400",
    };
  }
  if (shareBps >= 9_000n) {
    return {
      label: "LOW",
      share,
      className: "border-[#8888ff]/30 bg-[#8888ff]/10 text-[#8888ff]",
    };
  }
  if (shareBps >= 5_000n) {
    return {
      label: "MEDIUM",
      share,
      className: "border-amber-400/30 bg-amber-400/10 text-amber-400",
    };
  }
  return {
    label: "HIGH",
    share,
    className: "border-rose-400/30 bg-rose-400/10 text-rose-400",
  };
}

export default function PoolsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { switchChainAsync } = useSwitchChain();
  const toast = useToast();
  const { addLiquidity, approveToken, removeLiquidity } = useDexWrite();
  
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"add" | "remove">("add");
  const [showTopPools, setShowTopPools] = useState(true);
  const [busy, setBusy] = useState(false);
  
  // Add liquidity state
  const [selectedPoolIndex, setSelectedPoolIndex] = useState<number>(0);
  const [amountA, setAmountA] = useState("");
  const [amountB, setAmountB] = useState("");
  
  // Remove liquidity state
  const [selectedRemovePool, setSelectedRemovePool] = useState<number>(0);
  const [lpAmount, setLpAmount] = useState("");
  
  // Get all pools
  const { data: allPools, refetch: refetchAllPools } = useAllPools();

  const metadataTokenAddresses = useMemo(() => {
    const seen = new Set<string>();
    const addresses: `0x${string}`[] = [];
    allPools?.forEach((pool) => {
      [pool.token0, pool.token1].forEach((tokenAddress) => {
        const key = tokenAddress.toLowerCase();
        const isKnown = KNOWN_TOKENS.some(
          (token) => token.address.toLowerCase() === key,
        );
        if (key === NATIVE_ADDRESS.toLowerCase() || isKnown || seen.has(key)) return;
        seen.add(key);
        addresses.push(tokenAddress);
      });
    });
    return addresses;
  }, [allPools]);
  const tokenMetadataContracts = useMemo(
    () => metadataTokenAddresses.flatMap((tokenAddress) => [
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "symbol" as const,
      },
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "decimals" as const,
      },
      {
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "name" as const,
      },
    ]),
    [metadataTokenAddresses],
  );
  const {
    data: tokenMetadataResults,
    isPending: isTokenMetadataPending,
  } = useReadContracts({
    contracts: tokenMetadataContracts,
    allowFailure: true,
    query: { enabled: tokenMetadataContracts.length > 0 },
  });
  const tokenMetadataByAddress = useMemo(() => {
    const metadata = new Map<string, { token: Token; decimalsResolved: boolean }>();
    metadataTokenAddresses.forEach((tokenAddress, index) => {
      const resultOffset = index * 3;
      const symbolResult = tokenMetadataResults?.[resultOffset];
      const decimalsResult = tokenMetadataResults?.[resultOffset + 1];
      const nameResult = tokenMetadataResults?.[resultOffset + 2];
      const shortAddress = `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`;
      const symbol = symbolResult?.status === "success" && typeof symbolResult.result === "string"
        ? symbolResult.result
        : shortAddress;
      const decimals = decimalsResult?.status === "success" && typeof decimalsResult.result === "number"
        ? decimalsResult.result
        : 18;
      const name = nameResult?.status === "success" && typeof nameResult.result === "string"
        ? nameResult.result
        : symbol;
      metadata.set(tokenAddress.toLowerCase(), {
        token: {
          address: tokenAddress,
          symbol,
          decimals,
          name,
        },
        decimalsResolved: decimalsResult?.status === "success"
          && typeof decimalsResult.result === "number",
      });
    });
    return metadata;
  }, [metadataTokenAddresses, tokenMetadataResults]);

  // Build every pool from the shared pool and metadata batches.
  const poolOptions = useMemo(() => {
    if (!allPools) return [];
    const resolveToken = (tokenAddress: `0x${string}`) => {
      const known = KNOWN_TOKENS.find(
        (token) => token.address.toLowerCase() === tokenAddress.toLowerCase(),
      );
      if (known) return { token: known, decimalsResolved: true };
      return tokenMetadataByAddress.get(tokenAddress.toLowerCase()) ?? {
        token: {
          address: tokenAddress,
          symbol: `${tokenAddress.slice(0, 6)}...${tokenAddress.slice(-4)}`,
          decimals: 18,
          name: "Token",
        },
        decimalsResolved: false,
      };
    };
    return allPools.map(({ pairId, token0, token1, poolData }) => {
      const token0Result = resolveToken(token0);
      const token1Result = resolveToken(token1);
      const token0Metadata = token0Result.token;
      const token1Metadata = token1Result.token;
      const displayTokenMetadata = token0.toLowerCase() === NUSD_ADDRESS.toLowerCase()
        ? token1Metadata
        : token0Metadata;
      return {
        token0,
        token1,
        token0Metadata,
        token1Metadata,
        displayTokenMetadata,
        pairId,
        poolData,
        metadataReady: token0Result.decimalsResolved && token1Result.decimalsResolved,
        label: `${token0Metadata.symbol} / ${token1Metadata.symbol}`,
      };
    });
  }, [allPools, tokenMetadataByAddress]);
  const rankedPools = useMemo(
    () => [...poolOptions].sort((poolA, poolB) => {
      if (poolA.poolData[5] !== poolB.poolData[5]) {
        return poolA.poolData[5] > poolB.poolData[5] ? -1 : 1;
      }
      if (poolA.poolData[6] !== poolB.poolData[6]) {
        return poolA.poolData[6] > poolB.poolData[6] ? -1 : 1;
      }
      return poolA.pairId.localeCompare(poolB.pairId);
    }),
    [poolOptions],
  );

  const userLpContracts = useMemo(
    () => address
      ? (allPools ?? []).map((pool) => ({
          address: DEX_ADDRESS,
          abi: DEX_ABI,
          functionName: "userLP" as const,
          args: [pool.pairId, address] as const,
        }))
      : [],
    [address, allPools],
  );
  const {
    data: userLpResults,
    isPending: isUserLpPending,
    refetch: refetchUserLp,
  } = useReadContracts({
    contracts: userLpContracts,
    allowFailure: true,
    query: { enabled: userLpContracts.length > 0 },
  });
  const userLpByPairId = useMemo(() => {
    const balances = new Map<string, bigint>();
    allPools?.forEach((pool, index) => {
      const result = userLpResults?.[index];
      if (result?.status === "success") {
        balances.set(pool.pairId.toLowerCase(), result.result as bigint);
      }
    });
    return balances;
  }, [allPools, userLpResults]);

  const selectedPool = poolOptions[selectedPoolIndex];
  const tokenA = selectedPool?.token0Metadata ?? null;
  const tokenB = selectedPool?.token1Metadata ?? null;
  
  const removePairId = poolOptions[selectedRemovePool]?.pairId;
  const userLP = removePairId
    ? userLpByPairId.get(removePairId.toLowerCase())
    : undefined;
  const poolData = selectedPool?.poolData;
  const removePool = poolOptions[selectedRemovePool];
  const removeLpRisk = getLpRisk(
    userLP,
    removePool?.poolData[4] ?? 0n,
    isConnected,
    isUserLpPending,
  );
  
  // Balances
  const { data: balanceA } = useTokenBalance(address, tokenA);
  const { data: balanceB } = useTokenBalance(address, tokenB);
  
  // Allowance check
  const { data: allowanceA, refetch: refetchAllowanceA } = useReadContract({
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
    args: tokenA?.address !== NATIVE_TOKEN.address && address ? [address, DEX_ADDRESS] : undefined,
    query: { enabled: !!address && !!tokenA && tokenA.address !== NATIVE_TOKEN.address }
  });
  const { data: allowanceB, refetch: refetchAllowanceB } = useReadContract({
    address: tokenB?.address !== NATIVE_TOKEN.address ? tokenB?.address : undefined,
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
    args: tokenB?.address !== NATIVE_TOKEN.address && address ? [address, DEX_ADDRESS] : undefined,
    query: { enabled: !!address && !!tokenB && tokenB.address !== NATIVE_TOKEN.address }
  });
  
  const amountAParsed = useMemo(
    () => tokenA && amountA ? safeParseAmount(amountA, tokenA.decimals) : null,
    [amountA, tokenA],
  );
  const amountBParsed = useMemo(
    () => tokenB && amountB ? safeParseAmount(amountB, tokenB.decimals) : null,
    [amountB, tokenB],
  );
  const lpAmountParsed = useMemo(
    () => lpAmount ? safeParseAmount(lpAmount, 18) : null,
    [lpAmount],
  );
  const needsApprovalA = Boolean(
    tokenA &&
    tokenA.address !== NATIVE_TOKEN.address &&
    amountAParsed &&
    (allowanceA === undefined || allowanceA < amountAParsed)
  );
  const needsApprovalB = Boolean(
    tokenB &&
    tokenB.address !== NATIVE_TOKEN.address &&
    amountBParsed &&
    (allowanceB === undefined || allowanceB < amountBParsed)
  );
  const needsApproval = needsApprovalA || needsApprovalB;
  const approvalToken = needsApprovalA ? tokenA : needsApprovalB ? tokenB : null;
  const hasAllowance = !needsApproval;

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && isConnected && chainId !== LITVM_CHAIN_ID) {
      toast.warning("Wrong network", "Please switch to LitVM LiteForge");
    }
  }, [mounted, isConnected, chainId, toast]);

  const ensureCorrectChain = async () => {
    if (chainId === LITVM_CHAIN_ID) return true;
    try {
      await switchChainAsync({ chainId: LITVM_CHAIN_ID });
      return true;
    } catch (error) {
      toast.handleError(error, "Network switch failed");
      return false;
    }
  };

  const handleApprove = async () => {
    if (!approvalToken || !publicClient || busy) return;
    if (!(await ensureCorrectChain())) return;
    setBusy(true);
    try {
      toast.info("Approving", `Approving ${approvalToken.symbol}...`);
      const hash = await approveToken(approvalToken.address, DEX_ADDRESS);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Approval transaction reverted");
      await Promise.allSettled([refetchAllowanceA(), refetchAllowanceB()]);
      toast.show({
        title: "Approved",
        description: `${approvalToken.symbol} is ready`,
        kind: "success",
        href: getTransactionExplorerUrl(hash),
        hrefLabel: "View on Explorer",
      });
    } catch (error) {
      toast.handleError(error, "Approval failed");
    } finally {
      setBusy(false);
    }
  };
  
  const handleAddLiquidity = async () => {
    if (!selectedPool?.metadataReady) {
      toast.error("Token data unavailable", "Wait for token decimals before adding liquidity");
      return;
    }
    if (!tokenA || !tokenB || !amountAParsed || !amountBParsed || !publicClient || busy) {
      toast.error("Invalid input", "Please select tokens and enter amounts");
      return;
    }
    if (!(await ensureCorrectChain())) return;
    
    if (needsApproval && !hasAllowance) {
      toast.error("Approval required", "Please approve the token first");
      return;
    }
    
    setBusy(true);
    try {
      const hash = await addLiquidity(tokenA.address, tokenB.address, amountAParsed, amountBParsed);
      toast.info("Adding liquidity", "Please confirm the transaction...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Add liquidity transaction reverted");
      await Promise.allSettled([refetchAllPools(), refetchUserLp()]);
      toast.show({
        title: "Liquidity added",
        kind: "success",
        href: getTransactionExplorerUrl(hash),
        hrefLabel: "View on Explorer",
      });
    } catch (err) {
      toast.handleError(err, "Could not add liquidity");
    } finally {
      setBusy(false);
    }
  };
  
  const handleRemoveLiquidity = async () => {
    if (!removePairId || !lpAmountParsed || !publicClient || busy) {
      toast.error("Invalid input", "Please select a pool and enter amount");
      return;
    }
    if (!(await ensureCorrectChain())) return;
    if (userLP !== undefined && lpAmountParsed > userLP) {
      toast.error("Invalid input", "LP amount exceeds your balance");
      return;
    }

    setBusy(true);
    try {
      const hash = await removeLiquidity(removePairId, lpAmountParsed);
      toast.info("Removing liquidity", "Please confirm the transaction...");
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Remove liquidity transaction reverted");
      await Promise.allSettled([refetchAllPools(), refetchUserLp()]);
      toast.show({
        title: "Liquidity removed",
        kind: "success",
        href: getTransactionExplorerUrl(hash),
        hrefLabel: "View on Explorer",
      });
    } catch (error) {
      toast.handleError(error, "Could not remove liquidity");
    } finally {
      setBusy(false);
    }
  };
  
  const isValidAdd = Boolean(selectedPool?.metadataReady && tokenA && tokenB && amountAParsed && amountBParsed && hasAllowance && !busy);

  return (
    <div className="min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="max-w-7xl mx-auto px-5 py-3.5 flex items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="w-9 h-9 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] font-bold">
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
                    ? "bg-[#8888ff]/20 text-[#8888ff] border border-[#8888ff]/40"
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
            <p className="text-[#64748B] text-sm">Earn Liquidity Mining rewards by providing liquidity</p>
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
              {rankedPools.map((pool, i) => (
                <PoolTopCard
                  key={pool.pairId}
                  index={i}
                  token0Symbol={pool.token0Metadata.symbol}
                  token1Symbol={pool.token1Metadata.symbol}
                  displayTokenAddress={pool.displayTokenMetadata.address}
                  displayTokenSymbol={pool.displayTokenMetadata.symbol}
                  poolData={pool.poolData}
                  userLP={userLpByPairId.get(pool.pairId.toLowerCase())}
                  isConnected={isConnected}
                  isUserLpLoading={isUserLpPending}
                />
              ))}
            </div>
          </div>
        )}

        {/* Tab Switcher */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setActiveTab("add")}
            className={`flex-1 py-3 font-bold text-sm transition-all pixel-btn-soft ${
              activeTab === "add"
                ? "pixel-btn-soft-indigo"
                : "pixel-btn-soft-secondary"
            }`}
          >
            ADD LIQUIDITY
          </button>
          <button
            onClick={() => setActiveTab("remove")}
            className={`flex-1 py-3 font-bold text-sm transition-all pixel-btn-soft ${
              activeTab === "remove"
                ? "pixel-btn-soft-emerald"
                : "pixel-btn-soft-secondary"
            }`}
          >
            REMOVE LIQUIDITY
          </button>
        </div>

        {activeTab === "add" ? (
          <div className="relative">
            <div className="absolute inset-0 bg-[#8888ff]/5 rounded-2xl blur-xl" />
            
            <div className="relative bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5 backdrop-blur-sm">
              <h2 className="text-lg font-bold text-white mb-4" style={{ fontFamily: "var(--font-departure)" }}>
                Add Liquidity
              </h2>
              
              <div className="mb-4">
                <label className="block text-xs text-[#64748B] uppercase tracking-wider mb-2">
                  Select Pool
                </label>
                <select
                  value={selectedPoolIndex}
                  onChange={(e) => setSelectedPoolIndex(parseInt(e.target.value))}
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
                  {!!balanceA && !!tokenA && (
                    <button
                      onClick={() => setAmountA(formatUnits(balanceA, tokenA.decimals).slice(0, 8))}
                      className="text-xs text-[#8888ff] hover:text-[#AAAADD]"
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
                    className="min-w-0 flex-1 bg-[#13131F] p-4 rounded-lg text-xl font-bold text-white outline-none border border-[#2D2D44] focus:border-indigo-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  <div className="min-w-0 w-20 shrink-0 bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] text-center truncate sm:w-24">
                    {tokenA?.symbol || "—"}
                  </div>
                </div>
              </div>
              
              {/* Plus Divider */}
              <div className="relative h-0 flex justify-center my-2">
                <div className="relative -mt-4 w-10 h-10 rounded-full bg-[#1A1A2E] border-4 border-[#0F0F23] flex items-center justify-center text-lg font-bold text-[#8888ff]">
                  +
                </div>
              </div>
              
              {/* Token B */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-[#64748B] uppercase tracking-wider">
                    Token B (NUSD)
                  </label>
                  {!!balanceB && !!tokenB && (
                    <button
                      onClick={() => setAmountB(formatUnits(balanceB, tokenB.decimals).slice(0, 8))}
                      className="text-xs text-[#8888ff] hover:text-[#AAAADD]"
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
                    className="min-w-0 flex-1 bg-[#13131F] p-4 rounded-lg text-xl font-bold text-white outline-none border border-[#2D2D44] focus:border-indigo-500 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  />
                  <div className="min-w-0 w-20 shrink-0 bg-[#13131F] p-4 rounded-lg text-white border border-[#2D2D44] text-center truncate sm:w-24">
                    {tokenB?.symbol || "—"}
                  </div>
                </div>
              </div>
              
              {/* Approval Warning */}
              {needsApproval && !hasAllowance && (
                <div className="mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                  <p className="text-xs text-amber-400 mb-3">
                    You need to approve {approvalToken?.symbol} before adding liquidity
                  </p>
                  <button
                    onClick={handleApprove}
                    className="w-full py-2 pixel-btn-soft pixel-btn-soft-amber"
                  >
                    APPROVE {approvalToken?.symbol}
                  </button>
                </div>
              )}
              
              {/* Add Button */}
              <button
                onClick={handleAddLiquidity}
                disabled={!isValidAdd || !mounted || !isConnected}
                className={`w-full py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                  isValidAdd && mounted && isConnected ? "pixel-btn-soft-indigo" : "pixel-btn-soft-secondary"
                }`}
              >
                {!mounted || !isConnected
                  ? "CONNECT WALLET"
                  : !selectedPool
                    ? "Pool Not Available"
                    : !selectedPool.metadataReady
                      ? isTokenMetadataPending ? "Loading Token Data" : "Token Data Unavailable"
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
                {removePool && (
                  <div className="mt-2 flex items-center justify-between gap-3 border-t border-[#2D2D44] pt-2 text-xs">
                    <div>
                      <div className="text-[#64748B]">LP Risk</div>
                      <div className="text-[10px] text-[#64748B]">{removeLpRisk.share}</div>
                    </div>
                    <span className={`border px-2 py-1 text-[10px] font-bold ${removeLpRisk.className}`}>
                      {removeLpRisk.label}
                    </span>
                  </div>
                )}
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
                disabled={!lpAmountParsed || !mounted || !isConnected || !removePairId || busy}
                className={`w-full py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                  lpAmount && mounted && isConnected ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"
                }`}
              >
                {!mounted || !isConnected
                  ? "CONNECT WALLET"
                  : !lpAmount
                    ? "ENTER LP AMOUNT"
                    : "REMOVE LIQUIDITY"}
              </button>
            </div>
          </div>
        )}

        {/* Info Card */}
        <div className="mt-6 p-4 rounded-xl bg-[#1A1A2E]/50 border border-[#2D2D44]">
          <h3 className="text-sm font-bold text-white mb-3" style={{ fontFamily: "var(--font-departure)" }}>
            How Liquidity Mining Works
          </h3>
          <ul className="space-y-2 text-xs text-[#64748B]">
            <li className="flex items-start gap-2">
              <span className="text-[#8888ff]">1.</span>
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

function PoolTopCard({
  index,
  token0Symbol,
  token1Symbol,
  displayTokenAddress,
  displayTokenSymbol,
  poolData,
  userLP,
  isConnected,
  isUserLpLoading,
}: {
  index: number;
  token0Symbol: string;
  token1Symbol: string;
  displayTokenAddress: `0x${string}`;
  displayTokenSymbol: string;
  poolData: readonly [`0x${string}`, `0x${string}`, bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  userLP: bigint | undefined;
  isConnected: boolean;
  isUserLpLoading: boolean;
}) {
  const lpRisk = getLpRisk(userLP, poolData[4], isConnected, isUserLpLoading);
  const isDisplayTokenNative = displayTokenAddress.toLowerCase() === NATIVE_ADDRESS.toLowerCase();
  const explorerUrl = isDisplayTokenNative
    ? getAddressExplorerUrl(DEX_ADDRESS)
    : getTokenExplorerUrl(displayTokenAddress);
  const explorerLabel = isDisplayTokenNative
    ? `${token0Symbol}/${token1Symbol} pool contract`
    : `${displayTokenSymbol} token`;

  return (
    <div className="p-4 rounded-xl bg-[#13131F] border border-[#2D2D44]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-[#64748B]">#{index + 1}</span>
        <div className="w-6 h-6 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] text-xs font-bold">
          {token0Symbol[0]}{token1Symbol[0]}
        </div>
        <span className="font-medium text-white text-sm" style={{ fontFamily: "var(--font-departure)" }}>
          {token0Symbol}/{token1Symbol}
        </span>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-[#2D2D44] bg-[#1A1A2E] text-[#94A3B8] transition-colors hover:border-[#8888ff]/50 hover:text-white"
          title={`View ${explorerLabel} on explorer`}
          aria-label={`View ${explorerLabel} on explorer`}
        >
          <ExternalLinkIcon />
        </a>
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <div className="text-[#64748B]">Vol 24h</div>
            <div className="text-emerald-400 font-medium" style={{ fontFamily: "var(--font-departure)" }}>
              {formatUSD(poolData[5] as bigint)}
            </div>
          </div>
          <div>
            <div className="text-[#64748B]">Total Vol</div>
            <div className="text-white font-medium" style={{ fontFamily: "var(--font-departure)" }}>
              {formatUSD(poolData[6] as bigint)}
            </div>
          </div>
          <div
            className="col-span-2 mt-1 flex items-center justify-between gap-3 border-t border-[#2D2D44] pt-2"
            title={isConnected
              ? `Wallet owns ${lpRisk.share.replace(" share", "")} of total LP supply`
              : "Connect wallet to calculate your LP share"}
          >
            <div>
              <div className="text-[#64748B]">LP Risk</div>
              <div className="text-[10px] text-[#64748B]">{lpRisk.share}</div>
            </div>
            <span className={`border px-2 py-1 text-[10px] font-bold ${lpRisk.className}`}>
              {lpRisk.label}
            </span>
          </div>
        </div>
    </div>
  );
}

function ExternalLinkIcon() {
  return (
    <svg
      aria-hidden="true"
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}
