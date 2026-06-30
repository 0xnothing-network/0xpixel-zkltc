"use client";

import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useDexWrite, useSwapQuote, usePoolByTokens, useRealtimePrice, NATIVE_TOKEN, KNOWN_TOKENS, Token, useTokenBalance } from "@/lib/use0xDex";
import { formatUnits, parseUnits } from "viem";
import { useToast } from "@/components/Toast";
import { useChainId, useSwitchChain } from "wagmi";
import { LITVM_CHAIN_ID } from "@/lib/chainSwitch";

const DEX_NAV = [
  { href: "/0xdex", label: "Dashboard", icon: "◈" },
  { href: "/0xdex/swap", label: "Swap", icon: "⇄" },
  { href: "/0xdex/pools", label: "Pools", icon: "◫" },
] as const;

function TokenSelector({ 
  selected, 
  onSelect, 
  otherToken,
  label 
}: { 
  selected: Token | null; 
  onSelect: (token: Token) => void; 
  otherToken: Token | null;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  
  const availableTokens = KNOWN_TOKENS.filter(t => !otherToken || t.address !== otherToken.address);
  
  return (
    <div className="relative">
      <label className="block text-xs text-[#64748B] mb-2" style={{ fontFamily: "var(--font-departure)" }}>
        {label}
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 rounded-lg bg-[#13131F] border border-[#2D2D44] hover:border-[#3D3D54] transition-colors"
      >
        {selected ? (
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] text-xs font-bold">
              {selected.symbol[0]}
            </div>
            <span className="font-medium text-white" style={{ fontFamily: "var(--font-departure)" }}>
              {selected.symbol}
            </span>
          </div>
        ) : (
          <span className="text-[#64748B]">Select token</span>
        )}
        <svg className="w-4 h-4 text-[#64748B]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      
      {open && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 py-2 rounded-lg bg-[#1A1A2E] border border-[#2D2D44] shadow-xl max-h-60 overflow-auto">
          {availableTokens.map(token => (
            <button
              key={token.address}
              onClick={() => { onSelect(token); setOpen(false); }}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#2D2D44] transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-[#8888ff]/20 border border-[#8888ff]/40 flex items-center justify-center text-[#8888ff] text-xs font-bold">
                {token.symbol[0]}
              </div>
              <div className="text-left">
                <div className="text-sm font-medium text-white" style={{ fontFamily: "var(--font-departure)" }}>
                  {token.symbol}
                </div>
                <div className="text-xs text-[#64748B]">{token.name}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SwapPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const toast = useToast();
  
  const [tokenIn, setTokenIn] = useState<Token | null>(NATIVE_TOKEN);
  const [tokenOut, setTokenOut] = useState<Token | null>(null);
  const [amountIn, setAmountIn] = useState("");
  const [slippage, setSlippage] = useState(0.5);
  const [mounted, setMounted] = useState(false);
  
  const { swap } = useDexWrite();
  const { data: balanceIn } = useTokenBalance(address, tokenIn);
  const quote = useSwapQuote(tokenIn, tokenOut, amountIn);
  const { pool } = usePoolByTokens(tokenIn?.address, tokenOut?.address);

  // Realtime price from contract events — instant, no subgraph delay
  const { latestPrice: realtimePrice } = useRealtimePrice(
    tokenIn?.address,
    tokenOut?.address,
  );

  // Spot price from reserves (fallback / initial load)
  const spotRate = useMemo(() => {
    if (!pool || pool.reserve0 === 0n || pool.reserve1 === 0n) return 0;
    const isReversed = tokenIn?.address !== pool.token0;
    const reserveIn = isReversed ? pool.reserve1 : pool.reserve0;
    const reserveOut = isReversed ? pool.reserve0 : pool.reserve1;
    const scale = 10 ** ((tokenOut?.decimals ?? 18) - (tokenIn?.decimals ?? 18));
    return (Number(reserveIn) / Number(reserveOut)) * scale;
  }, [pool, tokenIn, tokenOut]);

  // Use realtime event price when available, otherwise spot price
  const displayRate = realtimePrice?.price ?? spotRate;
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Auto switch to LitVM
  useEffect(() => {
    if (mounted && isConnected && chainId !== LITVM_CHAIN_ID) {
      toast.warning("Wrong network", "Switching to LitVM LiteForge...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
    }
  }, [mounted, isConnected, chainId, toast, switchChain]);
  
  const handleSwapTokens = () => {
    const temp = tokenIn;
    setTokenIn(tokenOut);
    setTokenOut(temp);
    setAmountIn("");
  };
  
  const handleAmountInChange = (value: string) => {
    // Only allow numbers and decimal
    const filtered = value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
    setAmountIn(filtered);
  };
  
  const handleMax = () => {
    if (balanceIn) {
      const max = formatUnits(balanceIn, tokenIn?.decimals || 18);
      setAmountIn(String(parseFloat(max) * 0.99)); // Leave some for gas if native
    }
  };
  
  const handleSwap = async () => {
    if (!isConnected) {
      toast.error("Not connected", "Please connect your wallet first");
      return;
    }
    if (chainId !== LITVM_CHAIN_ID) {
      toast.warning("Wrong network", "Switching to LitVM...");
      switchChain?.({ chainId: LITVM_CHAIN_ID });
      return;
    }
    if (!tokenIn || !tokenOut || !amountIn) {
      toast.error("Invalid input", "Please select tokens and enter amount");
      return;
    }
    
    const amountInFormatted = parseUnits(amountIn, tokenIn.decimals);
    const minAmountOut = quote?.amountOut 
      ? (quote.amountOut * BigInt(Math.floor((100 - slippage) * 100))) / 10000n
      : 0n;
    
    try {
      swap(tokenIn.address, tokenOut.address, amountInFormatted, minAmountOut);
      toast.info("Swapping", `Swapping ${amountIn} ${tokenIn.symbol}...`);
    } catch {
      toast.error("Swap failed", "Transaction failed");
    }
  };
  
  const isValidSwap = tokenIn && tokenOut && amountIn && parseFloat(amountIn) > 0 && quote?.amountOut;

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
                  link.href === "/0xdex/swap"
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

      <main className="max-w-lg mx-auto px-5 py-8">
        <div className="mb-6">
          <h1 
            className="text-2xl font-bold text-white mb-1"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Swap
          </h1>
          <p className="text-[#64748B] text-sm">Exchange tokens at the best rate</p>
        </div>

        {/* Swap Card */}
        <div className="relative">
          {/* Glow effect */}
          <div className="absolute inset-0 bg-[#8888ff]/5 rounded-2xl blur-xl" />
          
          <div className="relative bg-[#1A1A2E]/90 border border-[#2D2D44] rounded-2xl p-5 backdrop-blur-sm">
            {/* Token In */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-[#64748B] uppercase tracking-wider">
                  You Pay
                </label>
                {balanceIn && tokenIn && (
                  <button
                    onClick={handleMax}
                    className="text-xs text-[#8888ff] hover:text-[#AAAADD]"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    Balance: {formatUnits(balanceIn, tokenIn.decimals).slice(0, 8)}
                  </button>
                )}
              </div>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={amountIn}
                  onChange={(e) => handleAmountInChange(e.target.value)}
                  placeholder="0.0"
                  className="flex-1 bg-transparent text-2xl font-bold text-white outline-none placeholder:text-[#3D3D54]"
                  style={{ fontFamily: "var(--font-departure)" }}
                />
                <TokenSelector
                  label=""
                  selected={tokenIn}
                  onSelect={setTokenIn}
                  otherToken={tokenOut}
                />
              </div>
            </div>

            {/* Swap Direction Button */}
            <div className="relative h-0 flex justify-center">
              <button
                onClick={handleSwapTokens}
                disabled={!tokenOut}
                className="relative -mt-6 -mb-6 w-12 h-12 rounded-full bg-[#1A1A2E] border-4 border-[#0F0F23] flex items-center justify-center text-lg hover:bg-[#2D2D44] transition-all hover:scale-110 disabled:opacity-50 disabled:cursor-not-allowed z-10"
              >
                ⇅
              </button>
            </div>

            {/* Token Out */}
            <div className="mt-6 mb-4">
              <label className="block text-xs text-[#64748B] uppercase tracking-wider mb-2">
                You Receive
              </label>
              <div className="flex gap-3">
                <div className="flex-1 bg-transparent text-2xl font-bold text-white flex items-center">
                  {quote?.amountOutFormatted ? parseFloat(quote.amountOutFormatted).toFixed(6) : "0.0"}
                </div>
                <TokenSelector
                  label=""
                  selected={tokenOut}
                  onSelect={setTokenOut}
                  otherToken={tokenIn}
                />
              </div>
            </div>

            {/* Swap Details */}
            {quote && parseFloat(amountIn) > 0 && (
              <div className="space-y-2 py-4 border-t border-[#2D2D44]">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">Rate</span>
                  <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>
                    1 {tokenIn?.symbol} ≈ {displayRate > 0 ? displayRate.toFixed(6) : "—"} {tokenOut?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">Price Impact</span>
                  <span className={quote.priceImpact > 5 ? "text-red-400" : "text-emerald-400"} style={{ fontFamily: "var(--font-departure)" }}>
                    {quote.priceImpact.toFixed(2)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">Fee (1%)</span>
                  <span className="text-white" style={{ fontFamily: "var(--font-departure)" }}>
                    {formatUnits(quote.fee, tokenIn?.decimals || 18).slice(0, 8)} {tokenIn?.symbol}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#64748B]">Slippage</span>
                  <div className="flex gap-1">
                    {[0.1, 0.5, 1.0].map(s => (
                      <button
                        key={s}
                        onClick={() => setSlippage(s)}
                        className={`px-2 py-1 text-xs pixel-btn-soft ${
                          slippage === s
                            ? "pixel-btn-soft-indigo"
                            : "pixel-btn-soft-secondary"
                        }`}
                      >
                        {s}%
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={!isValidSwap}
              className={`w-full py-4 font-bold text-white pixel-btn-soft pixel-btn-soft-full ${
                isValidSwap ? "pixel-btn-soft-indigo" : "pixel-btn-soft-secondary"
              }`}
            >
              {!mounted || !isConnected 
                ? "Connect Wallet"
                : !tokenIn || !tokenOut 
                  ? "Select Tokens"
                  : !amountIn || parseFloat(amountIn) === 0
                    ? "Enter Amount"
                    : "Swap"
              }
            </button>
          </div>
        </div>

        {/* Info */}
        <div className="mt-6 p-4 rounded-xl bg-[#1A1A2E]/50 border border-[#2D2D44]">
          <h3 className="text-sm font-bold text-white mb-3" style={{ fontFamily: "var(--font-departure)" }}>
            How it works
          </h3>
          <ul className="space-y-2 text-xs text-[#64748B]">
            <li className="flex items-start gap-2">
              <span className="text-[#8888ff]">1.</span>
              Select the token you want to swap from and to
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#8888ff]">2.</span>
              Enter the amount you want to swap
            </li>
            <li className="flex items-start gap-2">
              <span className="text-[#8888ff]">3.</span>
              Approve the token if needed, then confirm the swap
            </li>
          </ul>
        </div>
      </main>
    </div>
  );
}
