import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PREDICTION_ADDRESS } from "@/lib/0xPredictionAbi";
import { ZEROXN_ADDRESS } from "@/lib/0xNAbi";

const CONTRACTS = {
  pixel: process.env.NEXT_PUBLIC_PIXEL_NFT_ADDRESS || "0x33A32b9b2BEe864f9e42BFa39cA7BDC72f655988",
  marketplace: process.env.NEXT_PUBLIC_PIXEL_MARKETPLACE_ADDRESS || "0x13337cadA78d53C90E3c0EcE44C17c467C1a86F4",
  dex: process.env.NEXT_PUBLIC_DEX_ADDRESS || "0x873cb0402F0e74Db66663255e6B3535ca134C818",
  reward: process.env.NEXT_PUBLIC_REWARD_MANAGER_ADDRESS || "0xCEBbeE6CeAe309E647Be85600dA455C7B15C0de9",
  nusd: process.env.NEXT_PUBLIC_NUSD_ADDRESS || "0xF2d0fd65d9f62D57255AF6350f807E6c11A4CFdb",
  factory: process.env.NEXT_PUBLIC_FACTORY_ADDRESS || "0x93F9d4cF10cB785B47BFaD64ecccEA4D66C73508",
  prediction: PREDICTION_ADDRESS,
  zeroxn: ZEROXN_ADDRESS,
};

const MEDIA_ASSETS = [
  {
    name: "0xNothing",
    description: "Primary network mark",
    src: "/0xNothing.jpg",
    file: "0xNothing.jpg",
    dimensions: "400 x 400",
    width: 400,
    height: 400,
  },
  {
    name: "0x",
    description: "Social identity mark",
    src: "/0x.jpg",
    file: "0x.jpg",
    dimensions: "1024 x 1024",
    width: 1024,
    height: 1024,
  },
  {
    name: "0xFactory",
    description: "Token factory mark",
    src: "/0xFactory_logo.jpg",
    file: "0xFactory_logo.jpg",
    dimensions: "1024 x 1024",
    width: 1024,
    height: 1024,
  },
  {
    name: "NUSD",
    description: "Stablecoin mark",
    src: "/NUSD_LOGO.jpg",
    file: "NUSD_LOGO.jpg",
    dimensions: "1024 x 1024",
    width: 1024,
    height: 1024,
  },
] as const;

export const metadata: Metadata = {
  title: "Protocol — 0xNothing",
  description: "Technical documentation and official media assets for the 0xNothing protocol on LitVM Testnet.",
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

          <nav aria-label="Protocol sections">
            <a
              href="#media-kit"
              className="inline-flex min-h-10 items-center border border-white/[0.1] bg-white/[0.03] px-4 text-[10px] font-semibold uppercase text-white/60 transition-colors hover:border-white/25 hover:bg-white hover:text-black"
            >
              Media kit
            </a>
          </nav>
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

          {/* 0xPrediction Section */}
          <section className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-emerald-400 text-black flex items-center justify-center" style={{ fontFamily: "var(--font-departure), monospace" }}>
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
                0xPrediction
              </h2>
            </div>

            <p className="text-white/60 mb-8 leading-relaxed">
              DIA oracle prediction rounds using NUSD. The first prediction starts a round,
              entry stays open for 10 minutes, and the result settles after a fixed 2-hour
              round duration.
            </p>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-none p-6 mb-6">
              <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Contract Address</h3>
              <AddressRow label="Prediction" value={CONTRACTS.prediction} />
            </div>

            <div className="grid gap-3 mb-8 sm:grid-cols-3">
              {[
                { label: "Entry", value: "10 minutes" },
                { label: "Round", value: "2 hours" },
                { label: "Fee", value: "0.5%" },
              ].map((item) => (
                <div key={item.label} className="bg-white/[0.03] border border-white/[0.08] p-4">
                  <p className="text-white/40 text-[10px] tracking-widest uppercase mb-2">{item.label}</p>
                  <p className="text-white text-sm">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <h3 className="text-white/80 text-xs tracking-widest uppercase">Key Functions</h3>

              {[
                {
                  name: "predict",
                  desc: "Stake NUSD on UP or DOWN. If there is no active round for the pair, this starts a new round and opens the 10-minute entry window.",
                  signature: "predict(symbol, side, amount) -> roundId",
                },
                {
                  name: "canBetNow",
                  desc: "Read whether a pair is accepting predictions, plus oracle price, entry deadline, and close time.",
                  signature: "canBetNow(symbol) -> (canBet, oracleRoundId, price, updatedAt, betDeadline, closeTime)",
                },
                {
                  name: "settleLatestRound",
                  desc: "Settle a closed round after the 2-hour duration using DIA latestRoundData.",
                  signature: "settleLatestRound(roundId)",
                },
                {
                  name: "claim",
                  desc: "Claim payout or refund after a round is settled or cancelled.",
                  signature: "claim(roundId) -> amount",
                },
                {
                  name: "cancelStaleRound",
                  desc: "Cancel and refund a stale round only if the oracle feed becomes unreadable after the stale window.",
                  signature: "cancelStaleRound(roundId)",
                },
                {
                  name: "setAssetDefault",
                  desc: "Owner function to add or update an oracle pair with the default 2-hour round duration and 10-minute entry window.",
                  signature: "setAssetDefault(symbol, feed, enabled)",
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

          {/* 0x Section */}
          <section className="mb-16">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-white text-black flex items-center justify-center text-xs" style={{ fontFamily: "var(--font-departure), monospace" }}>
                0x
              </div>
              <h2
                className="text-white"
                style={{
                  fontFamily: "var(--font-departure), monospace",
                  fontSize: "1.5rem",
                  fontWeight: 700,
                }}
              >
                0x
              </h2>
            </div>

            <p className="text-white/60 mb-8 leading-relaxed">
              Fully onchain social layer for 0xNothing. 0x contains profiles, global posts, joined public channels,
              private member rooms, encrypted message payloads, 0xPixel NFT identity, likes, comments,
              follows, and verification.
            </p>

            <div className="mb-6">
              <Link
                href="/0x"
                className="inline-flex border border-white/[0.12] bg-white text-black px-4 py-3 text-[10px] uppercase tracking-[0.18em] hover:bg-[#00ff8a] transition-colors"
              >
                Open 0x
              </Link>
            </div>

            <div className="bg-white/[0.03] border border-white/[0.08] rounded-none p-6 mb-6">
              <h3 className="text-white/80 text-xs tracking-widest uppercase mb-4">Contract Address</h3>
              <AddressRow label="0x" value={CONTRACTS.zeroxn} />
            </div>

            <div className="space-y-4">
              <h3 className="text-white/80 text-xs tracking-widest uppercase">Key Functions</h3>

              {[
                {
                  name: "registerProfile",
                  desc: "Create one onchain social profile per wallet. Usernames are unique and lowercase.",
                  signature: "registerProfile(username, displayName, bio, avatarEnabled, avatarTokenId)",
                },
                {
                  name: "createPost",
                  desc: "Publish a global post. Optional 0xPixel token attachment must be owned by the author.",
                  signature: "createPost(content, hasPixel, pixelTokenId) -> postId",
                },
                {
                  name: "commentOnPost",
                  desc: "Add an onchain comment to a post. Optional 0xPixel token attachment is supported.",
                  signature: "commentOnPost(postId, content, hasPixel, pixelTokenId) -> commentId",
                },
                {
                  name: "likePost / follow",
                  desc: "Social actions stored fully onchain and emitted as indexable events.",
                  signature: "likePost(postId), follow(target)",
                },
                {
                  name: "createChannel / joinChannel / postToChannel",
                  desc: "Create public topic feeds. Wallets must join before posting or interacting inside a channel.",
                  signature: "createChannel(slug, name, description), joinChannel(channelId), postToChannel(channelId, content, hasPixel, pixelTokenId)",
                },
                {
                  name: "createGroup / addGroupMember / setGroupOfficer",
                  desc: "Create private member rooms. Admins can add members; creators can assign a lower named rank.",
                  signature: "createGroup(name, description, creatorKeyEnvelope), addGroupMember(groupId, member, keyEnvelope), setGroupOfficer(groupId, officer, enabled, rankName)",
                },
                {
                  name: "sendEncryptedMessage",
                  desc: "Store ciphertext between two wallets. Encryption/decryption happens in the frontend or wallet tooling.",
                  signature: "sendEncryptedMessage(to, encryptedPayload)",
                },
                {
                  name: "isVerified",
                  desc: "Read verification status from admin override or automatic requirements: likes, followers, and NUSD balance.",
                  signature: "isVerified(user) -> bool",
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

          <section
            id="media-kit"
            aria-labelledby="media-kit-title"
            className="mt-20 scroll-mt-8 border-y border-white/[0.08] py-10"
          >
            <div className="mb-8 grid gap-5 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:items-end">
              <div>
                <p className="mb-3 text-[10px] font-semibold uppercase text-[#ff304b]">
                  Brand resources
                </p>
                <h2
                  id="media-kit-title"
                  className="text-3xl font-bold text-white sm:text-4xl"
                >
                  Media kit
                </h2>
              </div>
              <p className="max-w-xl text-sm leading-7 text-white/50 md:justify-self-end">
                Official 0xNothing ecosystem marks for editorial, community, and integration use.
                Keep the original proportions and colors when publishing.
              </p>
            </div>

            <div className="grid gap-px overflow-hidden border border-white/[0.1] bg-white/[0.1] sm:grid-cols-2">
              {MEDIA_ASSETS.map((asset) => (
                <article key={asset.file} className="group flex min-w-0 flex-col bg-[#080808]">
                  <div className="relative aspect-[16/10] overflow-hidden bg-black">
                    <Image
                      src={asset.src}
                      alt={`${asset.name} logo`}
                      width={asset.width}
                      height={asset.height}
                      sizes="(max-width: 640px) 100vw, 448px"
                      className="h-full w-full object-contain p-8 transition-transform duration-300 group-hover:scale-[1.02] sm:p-10"
                    />
                  </div>

                  <div className="flex flex-1 items-end justify-between gap-4 border-t border-white/[0.08] p-5">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-white">{asset.name}</h3>
                      <p className="mt-1 text-xs text-white/40">{asset.description}</p>
                      <p className="mt-3 font-mono text-[10px] uppercase text-white/25">
                        JPG / {asset.dimensions}
                      </p>
                    </div>
                    <a
                      href={asset.src}
                      download={asset.file}
                      aria-label={`Download ${asset.name} logo as JPG`}
                      className="inline-flex min-h-10 shrink-0 items-center border border-white/[0.12] px-3 text-[10px] font-semibold uppercase text-white/65 transition-colors hover:border-white hover:bg-white hover:text-black"
                    >
                      Download
                    </a>
                  </div>
                </article>
              ))}
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
