"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { useWriteContract, useReadContract, useWaitForTransactionReceipt } from "wagmi";
import { formatUnits } from "viem";
import { LITVM_CHAIN_ID } from "@/lib/chainSwitch";
import { useToast } from "@/components/Toast";

const FACTORY_ADDRESS = "0x0704A6F0ddE78Dd3879f8Cc2ed1d47713f3291b8";

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
  const toast = useToast();
  const [mounted, setMounted] = useState(false);

  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [totalSupply, setTotalSupply] = useState("");
  const [devWallet, setDevWallet] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  // Auto-switch to LitVM when connected to wrong network
  useEffect(() => {
    if (!mounted || !isConnected || !chainId) return;
    if (chainId !== LITVM_CHAIN_ID && switchChain) {
      switchChain({ chainId: LITVM_CHAIN_ID });
    }
  }, [mounted, isConnected, chainId, switchChain]);

  const { data: totalTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "totalTokensCreated",
    query: { enabled: mounted }
  });

  const { data: allTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getAllTokens",
    query: { enabled: mounted }
  });

  const { data: myTokens } = useReadContract({
    address: FACTORY_ADDRESS as `0x${string}`,
    abi: FACTORY_ABI,
    functionName: "getTokensByCreator",
    args: [address as `0x${string}`],
    query: { enabled: mounted && !!address }
  });

  const { writeContract, data: txHash } = useWriteContract();
  const { isLoading: isWaitingTx, isSuccess: txSuccess } = useWaitForTransactionReceipt({ hash: txHash });

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
      writeContract({
        address: FACTORY_ADDRESS as `0x${string}`,
        abi: FACTORY_ABI,
        functionName: "createToken",
        args: [tokenName, tokenSymbol, BigInt(totalSupply), devWallet as `0x${string}`],
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create token");
      setIsCreating(false);
    }
  };

  useEffect(() => {
    if (txSuccess && !isWaitingTx) {
      setIsCreating(false);
      setSuccessMsg("Token created successfully!");
      setTokenName("");
      setTokenSymbol("");
      setTotalSupply("");
      setDevWallet("");
      setTimeout(() => setSuccessMsg(null), 8000);
    }
  }, [txSuccess, isWaitingTx]);

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
    <div className="min-h-screen bg-[#0F0F23]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
        <div className="max-w-6xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5 group">
            <Image
              src="/0xFactory_logo.jpg"
              alt="0xFactory Logo"
              width={36}
              height={36}
              priority
              className="w-9 h-9 rounded-full object-cover"
            />
            <span
              className="text-white font-bold text-lg tracking-tight"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              0xFactory
            </span>
          </Link>
          <div className="flex items-center gap-2">
            {mounted && isConnected && chainId && chainId !== LITVM_CHAIN_ID && (
              <button
                onClick={() => switchChain?.({ chainId: LITVM_CHAIN_ID })}
                disabled={isSwitching}
                className="pixel-btn pixel-btn-amber px-3 py-2 text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {isSwitching ? "Switching..." : "Switch to LitVM"}
              </button>
            )}
            {!isConnected ? (
              <button
                onClick={() => connect({ connector: connectors[0] })}
                disabled={isConnecting}
                className="pixel-btn pixel-btn-indigo px-4 py-2 text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {isConnecting ? "Connecting..." : "Connect Wallet"}
              </button>
            ) : (
              <button
                onClick={() => disconnect()}
                className="pixel-btn pixel-btn-red px-4 py-2 text-xs"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                Disconnect
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Hero */}
        <div className="text-center mb-10 animate-fadeInUp">
          <h1 className="text-3xl font-bold text-white mb-3" style={{ fontFamily: "var(--font-departure)" }}>
            ◈ Token Factory
          </h1>
          <p className="text-[#64748B] text-sm" style={{ fontFamily: "var(--font-departure)" }}>
            Deploy your own ERC-20 token on LitVM in seconds
          </p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-8 stagger-children">
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
        <div className="bg-[#1A1A2E] p-6 border border-[#2D2D44] mb-8 animate-fadeInUp-delay-2" style={{ clipPath: "polygon(0 8px, 8px 8px, 8px 0, calc(100% - 8px) 0, calc(100% - 8px) 8px, 100% 8px, 100% calc(100% - 8px), calc(100% - 8px) calc(100% - 8px), calc(100% - 8px) 100%, 8px 100%, 8px calc(100% - 8px), 0 calc(100% - 8px))" }}>
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
              disabled={!isConnected || isCreating || isWaitingTx}
              className="pixel-btn pixel-btn-amber w-full py-3 text-sm"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {!isConnected ? "Connect Wallet to Create" : isCreating || isWaitingTx ? "◈ Creating Token..." : "◈ Deploy Token"}
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
      setTimeout(() => setCopied(false), 2000);
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
          href={`https://liteforge.explorer.caldera.xyz/token/${token}`}
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
