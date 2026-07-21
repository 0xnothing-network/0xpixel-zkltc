"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useWriteContract, useReadContract, usePublicClient } from "wagmi";
import { formatUnits } from "viem";
import { LITVM_CHAIN_ID } from "@/lib/chainSwitch";
import { FACTORY_ADDRESS } from "@/lib/publicConfig";
import { getTokenExplorerUrl } from "@/lib/explorer";
import { useToast } from "@/components/Toast";

const FACTORY_ABI = [
  {
    "anonymous": false,
    "inputs": [
      { "indexed": true, "internalType": "address", "name": "tokenAddress", "type": "address" },
      { "indexed": true, "internalType": "address", "name": "creator", "type": "address" },
      { "indexed": false, "internalType": "string", "name": "name", "type": "string" },
      { "indexed": false, "internalType": "string", "name": "symbol", "type": "string" },
      { "indexed": false, "internalType": "uint256", "name": "totalSupply", "type": "uint256" },
      { "indexed": false, "internalType": "address", "name": "devWallet", "type": "address" }
    ],
    "name": "TokenCreated",
    "type": "event"
  },
  {
    "inputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "name": "allTokens",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "string", "name": "name", "type": "string" },
      { "internalType": "string", "name": "symbol", "type": "string" },
      { "internalType": "uint256", "name": "totalSupply", "type": "uint256" },
      { "internalType": "address", "name": "devWallet", "type": "address" }
    ],
    "name": "createToken",
    "outputs": [{ "internalType": "address", "name": "tokenAddress", "type": "address" }],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "getAllTokens",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "creator", "type": "address" }],
    "name": "getTokensByCreator",
    "outputs": [{ "internalType": "address[]", "name": "", "type": "address[]" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "totalTokensCreated",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

const TOKEN_ABI = [
  { "inputs": [], "name": "name", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "symbol", "outputs": [{ "internalType": "string", "name": "", "type": "string" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "decimals", "outputs": [{ "internalType": "uint8", "name": "", "type": "uint8" }], "stateMutability": "view", "type": "function" },
  { "inputs": [], "name": "totalSupply", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
  { "inputs": [{ "internalType": "address", "name": "account", "type": "address" }], "name": "balanceOf", "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }], "stateMutability": "view", "type": "function" },
] as const;

export default function FactoryPage() {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const publicClient = usePublicClient();
  const [mounted, setMounted] = useState(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [totalSupply, setTotalSupply] = useState("");
  const [devWallet, setDevWallet] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
    };
  }, []);

  // Auto-switch to LitVM when connected to wrong network
  useEffect(() => {
    if (!mounted || !isConnected || !chainId) return;
    if (chainId !== LITVM_CHAIN_ID && switchChain) {
      switchChain({ chainId: LITVM_CHAIN_ID });
    }
  }, [mounted, isConnected, chainId, switchChain]);

  const { data: totalTokens, refetch: refetchTotalTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "totalTokensCreated",
    query: { enabled: mounted }
  });

  const { data: allTokens, refetch: refetchAllTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getAllTokens",
    query: { enabled: mounted }
  });

  const { data: myTokens, refetch: refetchMyTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getTokensByCreator",
    args: [address as `0x${string}`],
    query: { enabled: mounted && !!address }
  });

  const { writeContractAsync } = useWriteContract();

  const connectWallet = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  const handleCreate = async () => {
    if (!tokenName || !tokenSymbol || !totalSupply || !devWallet) {
      setError("All fields are required");
      return;
    }
    if (!/^0x[a-fA-F0-9]{40}$/.test(devWallet)) {
      setError("Invalid dev wallet address");
      return;
    }
    setError(null);
    setSuccessMsg(null);
    setIsCreating(true);
    try {
      if (!publicClient) throw new Error("RPC client is not ready");
      const supply = BigInt(totalSupply);
      if (supply <= 0n) throw new Error("Total supply must be greater than 0");

      const hash = await writeContractAsync({
        address: FACTORY_ADDRESS as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "createToken",
        args: [tokenName, tokenSymbol, supply, devWallet as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("Token creation transaction reverted");

      setSuccessMsg("Token created successfully!");
      setTokenName("");
      setTokenSymbol("");
      setTotalSupply("");
      setDevWallet("");
      await Promise.allSettled([
        refetchTotalTokens(),
        refetchAllTokens(),
        refetchMyTokens(),
      ]);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        setSuccessMsg(null);
      }, 8000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setIsCreating(false);
    }
  };

  if (!mounted) return (
    <div className="min-h-screen bg-[#0F0F23] flex flex-col items-center justify-center gap-5">
      <div className="relative">
        <span
          className="text-3xl animate-pulse"
          style={{ fontFamily: "var(--font-departure)", color: "#a78bfa" }}
        >
          ◈
        </span>
        <span
          className="text-3xl animate-pulse"
          style={{ fontFamily: "var(--font-departure)", color: "#818cf8", animationDelay: "0.2s" }}
        >
          ◈
        </span>
        <span
          className="text-3xl animate-pulse"
          style={{ fontFamily: "var(--font-departure)", color: "#6366f1", animationDelay: "0.4s" }}
        >
          ◈
        </span>
      </div>
      <div
        className="text-sm tracking-widest animate-pulse"
        style={{ fontFamily: "var(--font-departure)", color: "#64748B" }}
      >
        LOADING...
      </div>
    </div>
  );

  return (
    <div className="factory-page min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3.5 flex items-center justify-between gap-3">
          <Link href="/" className="min-w-0 flex items-center group">
            <span
              className="min-w-0 truncate text-white font-bold text-base sm:text-lg tracking-tight"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              0xFactory
            </span>
          </Link>
          <div className="hidden shrink-0 items-center gap-2 sm:flex">
            {mounted && isConnected && chainId && chainId !== LITVM_CHAIN_ID && (
              <button
                onClick={() => switchChain?.({ chainId: LITVM_CHAIN_ID })}
                disabled={isSwitching}
                className="pixel-btn pixel-btn-amber px-2.5 sm:px-3 py-2 text-[10px] sm:text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {isSwitching ? "..." : <><span className="sm:hidden">LitVM</span><span className="hidden sm:inline">Switch to LitVM</span></>}
              </button>
            )}
            {!isConnected ? (
              <button
                onClick={connectWallet}
                disabled={isConnecting || connectors.length === 0}
                className="pixel-btn pixel-btn-indigo px-2.5 sm:px-4 py-2 text-[10px] sm:text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {isConnecting ? "..." : <><span className="sm:hidden">Connect</span><span className="hidden sm:inline">Connect Wallet</span></>}
              </button>
            ) : (
              <button
                onClick={() => disconnect()}
                className="pixel-btn pixel-btn-red px-2.5 sm:px-4 py-2 text-[10px] sm:text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                <span className="sm:hidden">Exit</span><span className="hidden sm:inline">Disconnect</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="sm:hidden border-b border-[#2D2D44] bg-[#0F0F23] px-3 py-3">
        {mounted && isConnected && chainId && chainId !== LITVM_CHAIN_ID ? (
          <button
            onClick={() => switchChain?.({ chainId: LITVM_CHAIN_ID })}
            disabled={isSwitching}
            className="pixel-btn pixel-btn-amber w-full py-2 text-[10px]"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            {isSwitching ? "..." : "Switch to LitVM"}
          </button>
        ) : !isConnected ? (
          <button
            onClick={connectWallet}
            disabled={isConnecting || connectors.length === 0}
            className="pixel-btn pixel-btn-indigo w-full py-2 text-[10px]"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            {isConnecting ? "..." : "Connect Wallet"}
          </button>
        ) : (
          <button
            onClick={() => disconnect()}
            className="pixel-btn pixel-btn-red w-full py-2 text-[10px]"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Disconnect
          </button>
        )}
      </div>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-10 animate-fadeInUp">
          <h1 className="text-2xl sm:text-3xl font-bold text-white mb-3" style={{ fontFamily: "var(--font-departure)" }}>
            ◈ Token Factory
          </h1>
          <p className="text-[#64748B] text-sm" style={{ fontFamily: "var(--font-departure)" }}>
            Deploy your own ERC-20 token on LitVM in seconds
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-8 stagger-children">
          <div className="bg-[#1A1A2E] p-4 border border-[#2D2D44] animate-fadeInUp" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
            <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-departure)" }}>Total Tokens</div>
            <div className="text-2xl font-bold text-purple-400" style={{ fontFamily: "var(--font-departure)" }}>
              {totalTokens ? totalTokens.toString() : "0"}
            </div>
          </div>
          <div className="bg-[#1A1A2E] p-4 border border-[#2D2D44] animate-fadeInUp-delay-1" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
            <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-departure)" }}>Your Tokens</div>
            <div className="text-2xl font-bold text-indigo-400" style={{ fontFamily: "var(--font-departure)" }}>
              {myTokens ? myTokens.length.toString() : "0"}
            </div>
          </div>
          <div className="bg-[#1A1A2E] p-4 border border-[#2D2D44] animate-fadeInUp-delay-2" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
            <div className="text-[10px] text-[#64748B] uppercase tracking-widest mb-1" style={{ fontFamily: "var(--font-departure)" }}>Chain</div>
            <div className="text-2xl font-bold text-emerald-400" style={{ fontFamily: "var(--font-departure)" }}>LitVM</div>
          </div>
        </div>

        {/* Create Token Form */}
        <div className="bg-[#1A1A2E] p-4 sm:p-6 border border-[#2D2D44] mb-8 animate-fadeInUp-delay-2" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
          <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2" style={{ fontFamily: "var(--font-departure)" }}>
            <span className="text-purple-400">◆</span> Create New Token
          </h2>

          {successMsg && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-sm flex items-center gap-2" style={{ fontFamily: "var(--font-departure)" }}>
              <span>✓</span> {successMsg}
            </div>
          )}

          {error && (
            <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-sm flex items-center gap-2" style={{ fontFamily: "var(--font-departure)" }}>
              <span>✗</span> {error}
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] text-[#64748B] uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-departure)" }}>Token Name</label>
              <input
                type="text"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="My Token"
                className="w-full px-4 py-3 bg-[#0F0F23] border border-[#2D2D44] text-white placeholder:text-[#4A4A6A] focus:outline-none focus:border-purple-500 transition-colors"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#64748B] uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-departure)" }}>Symbol</label>
              <input
                type="text"
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value.toUpperCase())}
                placeholder="MTK"
                maxLength={8}
                className="w-full px-4 py-3 bg-[#0F0F23] border border-[#2D2D44] text-white placeholder:text-[#4A4A6A] focus:outline-none focus:border-purple-500 transition-colors uppercase"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#64748B] uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-departure)" }}>Total Supply</label>
              <input
                type="number"
                value={totalSupply}
                onChange={(e) => setTotalSupply(e.target.value)}
                placeholder="1000000"
                className="w-full px-4 py-3 bg-[#0F0F23] border border-[#2D2D44] text-white placeholder:text-[#4A4A6A] focus:outline-none focus:border-purple-500 transition-colors"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>
            <div>
              <label className="block text-[10px] text-[#64748B] uppercase tracking-widest mb-2" style={{ fontFamily: "var(--font-departure)" }}>Dev Wallet</label>
              <input
                type="text"
                value={devWallet}
                onChange={(e) => setDevWallet(e.target.value)}
                placeholder="0x..."
                className="w-full px-4 py-3 bg-[#0F0F23] border border-[#2D2D44] text-white placeholder:text-[#4A4A6A] focus:outline-none focus:border-purple-500 transition-colors"
                style={{ fontFamily: "var(--font-departure)" }}
              />
            </div>
          </div>

          <div className="mt-5">
            <button
              onClick={handleCreate}
              disabled={!isConnected || isCreating}
              className="pixel-btn pixel-btn-amber w-full py-3 text-sm"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {!isConnected ? "Connect Wallet to Create" : isCreating ? "◈ Creating Token..." : "◈ Deploy Token"}
            </button>
          </div>

          {!isConnected && (
            <p className="text-xs text-[#64748B] text-center mt-3" style={{ fontFamily: "var(--font-departure)" }}>
              Connect your wallet to create tokens
            </p>
          )}
        </div>

        {/* Your Tokens */}
        {mounted && isConnected && myTokens && myTokens.length > 0 && (
          <div className="bg-[#1A1A2E] p-6 border border-[#2D2D44] mb-8 animate-fadeInUp-delay-3" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
            <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2" style={{ fontFamily: "var(--font-departure)" }}>
              <span className="text-emerald-400">◆</span> Your Tokens
            </h2>
            <div className="space-y-2">
              {[...myTokens].reverse().map((token, i) => (
                <TokenRow key={token} token={token} index={i} />
              ))}
            </div>
          </div>
        )}

        {/* Recent Tokens */}
        {allTokens && allTokens.length > 0 && (
          <div className="bg-[#1A1A2E] p-6 border border-[#2D2D44] animate-fadeInUp-delay-3" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
            <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2" style={{ fontFamily: "var(--font-departure)" }}>
              <span className="text-indigo-400">◇</span> Recent Tokens
            </h2>
            <div className="space-y-2">
              {allTokens.slice(-8).reverse().map((token, i) => (
                <TokenRow key={token} token={token} index={i} />
              ))}
            </div>
          </div>
        )}

        {(!allTokens || allTokens.length === 0) && (
          <div className="text-center py-12 text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>
            <div className="text-4xl mb-3">◇</div>
            <p className="text-sm">No tokens created yet</p>
            <p className="text-xs mt-1">Be the first to deploy a token!</p>
          </div>
        )}
      </main>
    </div>
  );
}

function TokenRow({ token, index }: { token: string; index: number }) {
  const [copied, setCopied] = useState(false);
  const toast = useToast();
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const { data: name } = useReadContract({
    address: token as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "name",
    query: { enabled: true }
  });
  const { data: symbol } = useReadContract({
    address: token as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "symbol",
    query: { enabled: true }
  });
  const { data: totalSupply } = useReadContract({
    address: token as `0x${string}`,
    abi: TOKEN_ABI,
    functionName: "totalSupply",
    query: { enabled: true }
  });

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      toast.success("Copied", token.slice(0, 10) + "..." + token.slice(-8));
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => {
        copiedTimerRef.current = null;
        setCopied(false);
      }, 2000);
    } catch {
      toast.error("Failed", "Could not copy to clipboard");
    }
  };

  return (
    <div className="flex items-center justify-between p-3 bg-[#0F0F23] border border-[#2D2D44] transition-all hover:border-purple-500/30 group" style={{ clipPath: "polygon(0 4px, 4px 4px, 4px 0, calc(100% - 4px) 0, calc(100% - 4px) 4px, 100% 4px, 100% calc(100% - 4px), calc(100% - 4px) calc(100% - 4px), calc(100% - 4px) 100%, 4px 100%, 4px calc(100% - 4px), 0 calc(100% - 4px))" }}>
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 flex items-center justify-center text-[10px] font-bold text-purple-400 bg-purple-500/10" style={{ clipPath: "polygon(0 3px, 3px 3px, 3px 0, calc(100% - 3px) 0, calc(100% - 3px) 3px, 100% 3px, 100% calc(100% - 3px), calc(100% - 3px) calc(100% - 3px), calc(100% - 3px) 100%, 3px 100%, 3px calc(100% - 3px), 0 calc(100% - 3px))" }}>
          {index + 1}
        </div>
        <div>
          <div className="text-white font-medium text-sm" style={{ fontFamily: "var(--font-departure)" }}>{name || "..."}</div>
          <div className="text-[10px] text-[#64748B]" style={{ fontFamily: "var(--font-departure)" }}>{symbol || "..."}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="text-right hidden sm:block">
          <div className="text-[8px] text-[#64748B] uppercase">Supply</div>
          <div className="text-sm text-purple-400" style={{ fontFamily: "var(--font-departure)" }}>
            {totalSupply ? Number(formatUnits(totalSupply, 18)).toLocaleString() : "..."}
          </div>
        </div>
        <button
          onClick={handleCopy}
          className={`pixel-btn pixel-btn-sm pixel-btn-secondary ${copied ? "pixel-btn-emerald" : ""} transition-all`}
          title="Copy address"
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
          )}
        </button>
        <a
          href={getTokenExplorerUrl(token)}
          target="_blank"
          rel="noopener noreferrer"
          className="pixel-btn pixel-btn-sm pixel-btn-secondary opacity-0 group-hover:opacity-100 transition-opacity"
        >
          View
        </a>
      </div>
    </div>
  );
}
