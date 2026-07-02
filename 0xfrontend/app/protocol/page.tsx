import type { Metadata } from "next";
import Link from "next/link";

const CONTRACTS = {
  pixel: process.env.NEXT_PUBLIC_PIXEL_NFT_ADDRESS || "0x33A32b9b2BEe864f9e42BFa39cA7BDC72f655988",
  marketplace: process.env.NEXT_PUBLIC_PIXEL_MARKETPLACE_ADDRESS || "0x13337cadA78d53C90E3c0EcE44C17c467C1a86F4",
  dex: process.env.NEXT_PUBLIC_DEX_ADDRESS || "0x873cb0402F0e74Db66663255e6B3535ca134C818",
  reward: process.env.NEXT_PUBLIC_REWARD_MANAGER_ADDRESS || "0xCEBbeE6CeAe309E647Be85600dA455C7B15C0de9",
  nusd: process.env.NEXT_PUBLIC_NUSD_ADDRESS || "0xF2d0fd65d9f62D57255AF6350f807E6c11A4CFdb",
  factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "0x93F9d4cF10cB785B47BFaD64ecccEA4D66C73508",
};

export const metadata: Metadata = {
  title: "Protocol — 0xNothing",
  description: "Technical documentation for 0xPixel NFT platform and 0xDex decentralized exchange on LitVM LiteForge.",
};

function AddressRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
      <span className="text-white/40 text-xs w-24 shrink-0">{label}:</span>
      <code className="text-indigo-400 text-xs font-mono break-all">{value}</code>
    </div>
  );
}

export default function DocsPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "var(--font-departure)" }}>
      <div className="fixed inset-0 bg-[#080808] -z-10" />

      <header className="relative z-10 px-6 py-5 border-b border-white/[0.04]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/0xNothing.jpg"
              alt="0xNothing"
              className="w-8 h-8 object-cover"
            />
            <span className="text-white/80 text-xs tracking-widest uppercase">
              0xNothing
            </span>
          </Link>
        </div>
      </header>

      <main className="relative z-10 flex-1 px-6 py-16">
        <div className="max-w-4xl mx-auto">
          <h1
            className="text-white mb-12"
            style={{
              fontFamily: "var(--font-departure), monospace",
              fontSize: "clamp(2rem, 5vw, 3.5rem)",
              fontWeight: 700,
              letterSpacing: "0.02em",
            }}
          >
            Documentation
          </h1>

          {/* 0xPixel Section */}
          <section className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white text-black flex items-center justify-center" style={{ fontFamily: "var(--font-departure), monospace" }}>
                P
              </div>
              <h2
                className="text-white"
                style={{
                  fontFamily: "var(--font-departure), monospace",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                }}
              >
                0xPixel
              </h2>
            </div>

            <p className="text-white/60 mb-8 leading-relaxed">
              Pixel art NFT marketplace on LitVM LiteForge. Create, collect, and trade unique pixel art NFTs.
            </p>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-none p-6 mb-6">
              <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Contract Addresses</h3>
              <div className="space-y-3">
                <AddressRow label="0xPixel" value={CONTRACTS.pixel} />
                <AddressRow label="Marketplace" value={CONTRACTS.marketplace} />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-white/80 text-xs tracking-widest uppercase">Key Functions</h3>

              {[
                {
                  name: "mint",
                  desc: "Mint a new pixel art NFT with name, grid size, and pixel data.",
                  signature: "mint(name, grid, px) → tokenId",
                },
                {
                  name: "checkOriginal",
                  desc: "Check if pixel art is original (not yet minted). Prevents duplicate mints.",
                  signature: "checkOriginal(px, grid) → bool",
                },
                {
                  name: "tokenData",
                  desc: "Get NFT metadata: name, gridSize, pixelData, creator, mintedAt, artworkHash.",
                  signature: "tokenData(tokenId) → (name, gridSize, px, creator, mintedAt, hash)",
                },
                {
                  name: "getCreator",
                  desc: "Get the wallet address of the pixel art creator.",
                  signature: "getCreator(px, grid) → address",
                },
              ].map((fn) => (
                <div key={fn.name} className="bg-white/[0.03] border border-white/[0.08] p-5">
                  <div className="flex items-start gap-4">
                    <span className="text-indigo-400 text-xs font-mono mt-0.5 shrink-0">{fn.name}</span>
                    <div>
                      <p className="text-white/60 text-sm mb-2">{fn.desc}</p>
                      <code className="text-white/40 text-xs font-mono block">{fn.signature}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* 0xDex Section */}
          <section className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-indigo-600 text-white flex items-center justify-center" style={{ fontFamily: "var(--font-departure), monospace" }}>
                D
              </div>
              <h2
                className="text-white"
                style={{
                  fontFamily: "var(--font-departure), monospace",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                }}
              >
                0xDex
              </h2>
            </div>

            <p className="text-white/60 mb-8 leading-relaxed">
              AMM decentralized exchange on LitVM LiteForge. Swap tokens, add/remove liquidity, and earn rewards.
            </p>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-none p-6 mb-6">
              <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Contract Addresses</h3>
              <div className="space-y-3">
                <AddressRow label="DEX" value={CONTRACTS.dex} />
                <AddressRow label="Reward" value={CONTRACTS.reward} />
                <AddressRow label="NUSD" value={CONTRACTS.nusd} />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-white/80 text-xs tracking-widest uppercase">Key Functions</h3>

              {[
                {
                  name: "swap",
                  desc: "Swap token A for token B. Pay zkLTC for native → ERC20 swaps.",
                  signature: "swap(tokenIn, tokenOut, amountIn, minAmountOut) → amountOut",
                },
                {
                  name: "addLiquidity",
                  desc: "Add liquidity to a pool. Receives LP tokens. Pool auto-creates if not exists.",
                  signature: "addLiquidity(tokenA, tokenB, amountA, amountB) → lpMinted",
                },
                {
                  name: "removeLiquidity",
                  desc: "Remove liquidity from pool. Only pool owner can remove. Burns LP tokens, receives token A & B back.",
                  signature: "removeLiquidity(pairId, lpAmount)",
                },
                {
                  name: "claimReward",
                  desc: "Claim accumulated rewards from RewardManager after providing liquidity to NUSD base pools.",
                  signature: "RewardManager.claimReward()",
                },
                {
                  name: "getPoolPriceInfo",
                  desc: "Get pool price, reserves, and total LP for chart/UI.",
                  signature: "getPoolPriceInfo(pairId) → (price, reserve0, reserve1, totalLP)",
                },
                {
                  name: "getUserPendingReward",
                  desc: "View pending claimable rewards for a user.",
                  signature: "RewardManager.getUserPendingReward(user) → uint256",
                },
                {
                  name: "rewardManager",
                  desc: "Read the RewardManager linked to the DEX.",
                  signature: "rewardManager() → address",
                },
              ].map((fn) => (
                <div key={fn.name} className="bg-white/[0.03] border border-white/[0.08] p-5">
                  <div className="flex items-start gap-4">
                    <span className="text-indigo-400 text-xs font-mono mt-0.5 shrink-0">{fn.name}</span>
                    <div>
                      <p className="text-white/60 text-sm mb-2">{fn.desc}</p>
                      <code className="text-white/40 text-xs font-mono block">{fn.signature}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* NUSD Info */}
            <div className="mt-8 p-5 bg-[#8888ff]/10 border border-[#8888ff]/20">
              <h4 className="text-white/80 text-xs tracking-widest uppercase mb-3">NUSD Token</h4>
              <p className="text-white/50 text-sm mb-3">
                USDC-benchmarked stablecoin used as base currency for swaps and reward calculations.
              </p>
              <AddressRow label="CA" value={CONTRACTS.nusd} />
            </div>
          </section>

          {/* Divider */}
          <div className="border-t border-white/[0.04] my-12" />

          {/* 0xFactory Section */}
          <section className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-amber-500 text-black flex items-center justify-center" style={{ fontFamily: "var(--font-departure), monospace" }}>
                F
              </div>
              <h2
                className="text-white"
                style={{
                  fontFamily: "var(--font-departure), monospace",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                }}
              >
                0xFactory
              </h2>
            </div>

            <p className="text-white/60 mb-8 leading-relaxed">
              ERC-20 token factory on LitVM LiteForge. Deploy custom ERC-20 tokens with Clone pattern for gas efficiency.
            </p>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-none p-6 mb-6">
              <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Contract Address</h3>
              <AddressRow label="Factory" value={CONTRACTS.factory} />
            </div>

            <div className="space-y-4">
              <h3 className="text-white/80 text-xs tracking-widest uppercase">Key Functions</h3>

              {[
                {
                  name: "createToken",
                  desc: "Create a new ERC-20 token using Clone pattern. Total supply is automatically multiplied by 10^18 (decimals).",
                  signature: "createToken(name, symbol, totalSupply, devWallet) → tokenAddress",
                },
                {
                  name: "getAllTokens",
                  desc: "Get all tokens created through this factory.",
                  signature: "getAllTokens() → address[]",
                },
                {
                  name: "getTokensByCreator",
                  desc: "Get all tokens created by a specific creator address.",
                  signature: "getTokensByCreator(creator) → address[]",
                },
                {
                  name: "totalTokensCreated",
                  desc: "Get the total number of tokens created.",
                  signature: "totalTokensCreated() → uint256",
                },
              ].map((fn) => (
                <div key={fn.name} className="bg-white/[0.03] border border-white/[0.08] p-5">
                  <div className="flex items-start gap-4">
                    <span className="text-indigo-400 text-xs font-mono mt-0.5 shrink-0">{fn.name}</span>
                    <div>
                      <p className="text-white/60 text-sm mb-2">{fn.desc}</p>
                      <code className="text-white/40 text-xs font-mono block">{fn.signature}</code>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Network Info */}
          <section className="border-t border-white/[0.04] pt-12">
            <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Network</h3>
            <div className="bg-white/[0.03] border border-white/[0.08] p-5">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-white/60 text-sm">LitVM LiteForge</span>
              </div>
            </div>
          </section>
        </div>
      </main>

      <footer className="relative z-10 px-6 py-8 border-t border-white/[0.04]">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <Link href="/" className="text-white/[0.06] uppercase hover:text-white/20 transition-colors" style={{ fontFamily: "var(--font-departure), monospace", fontSize: "9px", letterSpacing: "0.4em" }}>
            0xNothing
          </Link>
          <span className="text-white/[0.06] uppercase" style={{ fontFamily: "var(--font-departure), monospace", fontSize: "9px", letterSpacing: "0.4em" }}>
            2026
          </span>
        </div>
      </footer>
    </div>
  );
}
