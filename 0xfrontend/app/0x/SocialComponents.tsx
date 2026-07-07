"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useReadContract } from "wagmi";
import {
  ZEROXN_ABI,
  ZEROXN_ADDRESS,
  type ZeroxNComment,
  type ZeroxNPost,
  type ZeroxNProfile,
} from "@/lib/0xNAbi";

export type SocialTxRequest = {
  functionName: string;
  args?: readonly unknown[];
};

export type SocialTxRunner = (label: string, request: SocialTxRequest) => Promise<void>;

export type OwnedPixelOption = {
  tokenId: string;
  name: string;
  imageUrl: string;
};

type PixelMetadata = {
  tokenId: string;
  name: string;
  imageUrl: string;
};

const pixelMetadataCache = new Map<string, PixelMetadata | null>();
const pixelMetadataInflight = new Map<string, Promise<PixelMetadata | null>>();
const pixelMetadataResolvers = new Map<string, Array<(value: PixelMetadata | null) => void>>();
const pixelMetadataQueue = new Set<string>();
let pixelMetadataQueueTimer: ReturnType<typeof setTimeout> | null = null;
const SOCIAL_ROW_REFRESH_MS = 8_000;

function requestPixelMetadata(id: string): Promise<PixelMetadata | null> {
  const cached = pixelMetadataCache.get(id);
  if (cached !== undefined) return Promise.resolve(cached);

  const inflight = pixelMetadataInflight.get(id);
  if (inflight) return inflight;

  const promise = new Promise<PixelMetadata | null>((resolve) => {
    const resolvers = pixelMetadataResolvers.get(id) ?? [];
    resolvers.push(resolve);
    pixelMetadataResolvers.set(id, resolvers);
    pixelMetadataQueue.add(id);

    if (!pixelMetadataQueueTimer) {
      pixelMetadataQueueTimer = setTimeout(flushPixelMetadataQueue, 24);
    }
  }).finally(() => {
    pixelMetadataInflight.delete(id);
  });

  pixelMetadataInflight.set(id, promise);
  return promise;
}

function resolveQueuedPixelMetadata(id: string, value: PixelMetadata | null) {
  pixelMetadataCache.set(id, value);
  const resolvers = pixelMetadataResolvers.get(id) ?? [];
  pixelMetadataResolvers.delete(id);
  for (const resolve of resolvers) resolve(value);
}

function flushPixelMetadataQueue() {
  const ids = Array.from(pixelMetadataQueue).slice(0, 20);
  for (const id of ids) pixelMetadataQueue.delete(id);
  pixelMetadataQueueTimer = null;

  if (pixelMetadataQueue.size > 0) {
    pixelMetadataQueueTimer = setTimeout(flushPixelMetadataQueue, 24);
  }

  if (ids.length === 0) return;

  fetch(`/api/token-metadata?ids=${ids.join(",")}`)
    .then(async (response) => {
      if (!response.ok) throw new Error(await response.text());
      return response.json() as Promise<{ tokens?: Record<string, PixelMetadata | null> }>;
    })
    .then((body) => {
      for (const id of ids) {
        resolveQueuedPixelMetadata(id, body.tokens?.[id] ?? null);
      }
    })
    .catch(() => {
      for (const id of ids) {
        resolveQueuedPixelMetadata(id, null);
      }
    });
}

function usePixelMetadata(tokenId?: bigint | string | null) {
  const id = tokenId ? tokenId.toString() : "";
  const [metadata, setMetadata] = useState<PixelMetadata | null | undefined>(undefined);

  useEffect(() => {
    if (!id || id === "0") {
      setMetadata(null);
      return;
    }

    const cached = pixelMetadataCache.get(id);
    if (cached !== undefined) {
      setMetadata(cached);
      return;
    }

    let live = true;
    setMetadata(undefined);

    requestPixelMetadata(id)
      .then((next) => {
        if (live) setMetadata(next);
      })
      .catch(() => {
        if (live) setMetadata(null);
      });

    return () => {
      live = false;
    };
  }, [id]);

  return metadata;
}

function PixelImage({
  imageUrl,
  alt,
  className,
}: {
  imageUrl?: string;
  alt: string;
  className: string;
}) {
  if (!imageUrl) {
    return <span className={`${className} grid place-items-center bg-black text-[10px] text-white/30`}>0x</span>;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={imageUrl}
      alt={alt}
      className={className}
      style={{ imageRendering: "pixelated" }}
      loading="lazy"
    />
  );
}

export function PixelNftAvatar({
  tokenId,
  fallback,
  dense = false,
}: {
  tokenId?: bigint | string | null;
  fallback: string;
  dense?: boolean;
}) {
  const metadata = usePixelMetadata(tokenId);
  const sizeClass = dense ? "h-8 w-8" : "h-10 w-10";

  if (!tokenId || tokenId.toString() === "0") {
    return (
      <span className={`grid ${sizeClass} shrink-0 place-items-center border border-white/20 bg-black text-[11px] text-white`}>
        {fallback}
      </span>
    );
  }

  return (
    <span
      className={`grid ${sizeClass} shrink-0 place-items-center overflow-hidden border border-[var(--pixel-amber)]/45 bg-black p-0.5`}
      title={metadata ? `${metadata.name} #${metadata.tokenId}` : `0xPixel #${tokenId.toString()}`}
    >
      <PixelImage
        imageUrl={metadata?.imageUrl}
        alt={metadata ? `${metadata.name} #${metadata.tokenId}` : `0xPixel #${tokenId.toString()}`}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

export function PixelNftAttachment({
  tokenId,
  compact = false,
}: {
  tokenId: bigint | string;
  compact?: boolean;
}) {
  const metadata = usePixelMetadata(tokenId);
  const id = tokenId.toString();

  return (
    <Link
      href={`/0xpixel/marketplace?token=${id}`}
      className={`zeroxn-nft-attachment group flex items-center border border-[var(--pixel-amber)]/42 bg-[rgba(255,226,92,0.06)] hover:border-[var(--pixel-amber)] ${
        compact ? "gap-3 p-2" : "gap-4 p-3"
      }`}
    >
      <span className={`block shrink-0 overflow-hidden border border-white/10 bg-black p-1 ${compact ? "h-14 w-14" : "h-20 w-20 sm:h-24 sm:w-24"}`}>
        {metadata?.imageUrl ? (
          <PixelImage
            imageUrl={metadata.imageUrl}
            alt={`${metadata.name} #${metadata.tokenId}`}
            className="h-full w-full object-contain"
          />
        ) : (
          <span className="zeroxn-pixel-fallback grid h-full w-full place-items-center text-center text-[10px] leading-tight text-white/70">
            #{id}
          </span>
        )}
      </span>
      <span className="min-w-0 self-center">
        <span className="block text-[10px] uppercase tracking-[0.16em] text-[var(--pixel-amber)]">0xPixel NFT</span>
        <span className="mt-1 block truncate text-base font-bold text-white">
          {metadata?.name || `Token #${id}`}
        </span>
        <span className="mt-1 block text-xs text-white/70">#{id}</span>
      </span>
    </Link>
  );
}

export function shortAddress(address?: string) {
  if (!address) return "0x0000...0000";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatCount(value?: bigint | number) {
  const num = Number(value ?? 0);
  if (!Number.isFinite(num)) return "0";
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(2)}K`;
  return new Intl.NumberFormat("en-US").format(num);
}

export function formatDate(timestamp?: number | bigint) {
  const seconds = Number(timestamp ?? 0);
  if (!seconds) return "--";
  return new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ");
}

export function isProfileReady(profile?: ZeroxNProfile | null) {
  return Boolean(profile?.[5]);
}

export function displayName(profile?: ZeroxNProfile | null, fallback?: string) {
  if (profile?.[1]) return profile[1];
  if (profile?.[0]) return `@${profile[0]}`;
  return shortAddress(fallback);
}

export function usernameLabel(profile?: ZeroxNProfile | null, fallback?: string) {
  if (profile?.[0]) return `@${profile[0]}`;
  return shortAddress(fallback);
}

export function PixelPanel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`zeroxn-panel border border-white/12 bg-[#050505] shadow-[6px_6px_0_#000] ${className}`}>
      {children}
    </section>
  );
}

export function PanelTitle({
  title,
  right,
}: {
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="zeroxn-panel-title flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
      <h2 className="text-lg font-bold text-white sm:text-xl">{title}</h2>
      {right}
    </div>
  );
}

export function PixelNftPicker({
  label,
  value,
  onChange,
  ownedPixels,
  loading,
  compact = false,
  collapsible = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  ownedPixels: OwnedPixelOption[];
  loading?: boolean;
  compact?: boolean;
  collapsible?: boolean;
}) {
  const selected = ownedPixels.find((nft) => nft.tokenId === value);
  const [expanded, setExpanded] = useState(!collapsible);
  const showBody = !collapsible || expanded;

  return (
    <div className="zeroxn-nft-picker border border-white/10 bg-white/[0.02] p-3">
      <div className={`${showBody ? "mb-2" : ""} flex items-center justify-between gap-3`}>
        {collapsible ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <span className="truncate text-[10px] uppercase tracking-[0.16em] text-white/58">{label}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-[0.12em] text-[var(--pixel-green)]">
              {selected ? `#${selected.tokenId}` : loading ? "Loading" : `${ownedPixels.length} NFTs`}
            </span>
          </button>
        ) : (
          <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">{label}</span>
        )}
        <div className="flex shrink-0 items-center gap-2">
          {value ? (
            <button
              type="button"
              className="text-[10px] uppercase tracking-[0.12em] text-white/42 hover:text-white"
              onClick={() => onChange("")}
            >
              Clear
            </button>
          ) : null}
          {collapsible ? (
            <button
              type="button"
              className="border border-white/10 bg-black px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-white/55 hover:border-[var(--pixel-green)] hover:text-white"
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? "Hide" : "Open"}
            </button>
          ) : null}
        </div>
      </div>

      {!showBody ? (
        <button
          type="button"
          className="mt-2 flex w-full items-center gap-3 border border-white/8 bg-black px-3 py-2 text-left hover:border-white/25"
          onClick={() => setExpanded(true)}
        >
          {selected?.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={selected.imageUrl}
              alt={`${selected.name} #${selected.tokenId}`}
              className="h-9 w-9 border border-white/10 object-contain"
              style={{ imageRendering: "pixelated" }}
              loading="lazy"
            />
          ) : (
            <span className="grid h-9 w-9 place-items-center border border-white/10 bg-[#080808] text-sm text-white/40">+</span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-xs text-white">
              {selected ? `${selected.name || "0xPixel"} #${selected.tokenId}` : "Attach 0xPixel NFT"}
            </span>
            <span className="mt-1 block truncate text-[10px] text-white/38">
              {selected ? "Click to change or clear" : "Optional"}
            </span>
          </span>
        </button>
      ) : loading ? (
        <div className="grid h-20 place-items-center border border-white/8 bg-black text-xs text-white/42">
          Loading 0xPixel NFTs
        </div>
      ) : ownedPixels.length > 0 ? (
        <div className={`grid gap-2 ${compact ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-3 sm:grid-cols-5"}`}>
          {ownedPixels.slice(0, compact ? 12 : 20).map((nft) => {
            const active = nft.tokenId === value;
            return (
              <button
                key={nft.tokenId}
                type="button"
                className={`group border bg-black p-1 text-left transition-transform active:translate-y-px ${
                  active ? "border-[var(--pixel-green)] shadow-[3px_3px_0_#10492f]" : "border-white/10 hover:border-white/35"
                }`}
                onClick={() => {
                  onChange(active ? "" : nft.tokenId);
                  if (collapsible && !active) setExpanded(false);
                }}
                title={`${nft.name} #${nft.tokenId}`}
              >
                <span className="block aspect-square overflow-hidden bg-[#080808]">
                  {nft.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={nft.imageUrl}
                      alt={`${nft.name} #${nft.tokenId}`}
                      className="h-full w-full object-contain"
                      style={{ imageRendering: "pixelated" }}
                      loading="lazy"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-[10px] text-white/30">#{nft.tokenId}</span>
                  )}
                </span>
                <span className="mt-1 block truncate text-[9px] text-white/55">#{nft.tokenId}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid min-h-20 place-items-center border border-white/8 bg-black px-3 py-5 text-center text-xs leading-relaxed text-white/42">
          No 0xPixel NFT in this wallet. You can still use 0x without an NFT avatar.
        </div>
      )}

      {selected ? (
        <p className="mt-2 truncate text-[10px] text-[var(--pixel-green)]">
          Selected {selected.name || "0xPixel"} #{selected.tokenId}
        </p>
      ) : null}
    </div>
  );
}

export function ProfileBadge({
  address,
  dense = false,
}: {
  address?: `0x${string}`;
  dense?: boolean;
}) {
  const { data: profile } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "profiles",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });
  const { data: verified } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });

  const typedProfile = profile as ZeroxNProfile | undefined;
  const fallback = (typedProfile?.[0] || address || "N").slice(0, 1).toUpperCase();
  const avatarTokenId = typedProfile?.[4] && typedProfile[3] > 0n ? typedProfile[3] : null;

  return (
    <div className="zeroxn-profile-badge flex min-w-0 items-center gap-2">
      <PixelNftAvatar tokenId={avatarTokenId} fallback={fallback} dense={dense} />
      <span className="min-w-0">
        <span className={`flex min-w-0 items-center gap-1.5 font-bold text-white ${dense ? "text-xs" : "text-sm"}`}>
          <span className="truncate">{displayName(typedProfile, address)}</span>
          {verified ? <span className="zeroxn-verified-badge ml-1" aria-label="Verified" title="Verified" /> : null}
        </span>
        <span className="block truncate text-[10px] text-white/50">
          {usernameLabel(typedProfile, address)}
        </span>
      </span>
    </div>
  );
}

function isSameAddress(a?: string, b?: string) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}

export function FollowButton({
  viewer,
  target,
  runTx,
  compact = false,
}: {
  viewer?: `0x${string}`;
  target?: `0x${string}`;
  runTx: SocialTxRunner;
  compact?: boolean;
}) {
  const enabled = Boolean(viewer && target && !isSameAddress(viewer, target));
  const { data: isFollowing, refetch } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "following",
    args: viewer && target ? [viewer, target] : undefined,
    query: { enabled, refetchInterval: enabled ? SOCIAL_ROW_REFRESH_MS : false },
  });

  if (!enabled || !target) return null;

  const toggleFollow = async () => {
    const following = Boolean(isFollowing);
    await runTx(following ? "Unfollow" : "Follow", {
      functionName: following ? "unfollow" : "follow",
      args: [target],
    });
    void refetch();
  };

  return (
    <button
      type="button"
      className={`zeroxn-follow-btn pixel-btn-soft ${
        isFollowing ? "pixel-btn-soft-secondary" : "pixel-btn-soft-emerald"
      } ${compact ? "pixel-btn-soft-sm" : ""}`}
      onClick={toggleFollow}
    >
      {isFollowing ? "Following" : "Follow"}
    </button>
  );
}

export function GroupRoleBadge({
  groupId,
  address,
  creator,
}: {
  groupId?: bigint | string;
  address?: `0x${string}`;
  creator?: `0x${string}`;
}) {
  const groupIdText = groupId?.toString() ?? "";
  const enabled = Boolean(groupIdText && address);
  const parsedGroupId = enabled ? BigInt(groupIdText) : 0n;
  const isCreator = Boolean(
    address && creator && address.toLowerCase() === creator.toLowerCase(),
  );

  const { data: isAdmin } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupAdmin",
    args: enabled && address ? [parsedGroupId, address] : undefined,
    query: { enabled: enabled && !isCreator, refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });
  const { data: isOfficer } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupOfficer",
    args: enabled && address ? [parsedGroupId, address] : undefined,
    query: { enabled: enabled && !isCreator && !isAdmin, refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });
  const { data: rankName } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupRankName",
    args: enabled && address ? [parsedGroupId, address] : undefined,
    query: { enabled: enabled && !isCreator && Boolean(isOfficer), refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });

  const label = isCreator
    ? "OWNER"
    : isAdmin
      ? "ADMIN"
      : isOfficer
        ? String(rankName || "ROLE").trim() || "ROLE"
        : "";

  if (!label) return null;

  return (
    <span className={`zeroxn-group-role-badge ${isCreator ? "is-owner" : isAdmin ? "is-admin" : "is-role"}`}>
      {label}
    </span>
  );
}

export function CommentRow({ commentId }: { commentId: bigint }) {
  const { data } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "comments",
    args: [commentId],
    query: { refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });

  const comment = data as ZeroxNComment | undefined;
  if (!comment || comment[6]) return null;

  return (
    <div className="border-t border-white/8 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <ProfileBadge address={comment[1]} dense />
        <span className="text-[10px] text-white/35">{formatDate(comment[4])}</span>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-white/78">{comment[3]}</p>
      {comment[5] ? (
        <div className="mt-2">
          <PixelNftAttachment tokenId={comment[2]} compact />
        </div>
      ) : null}
    </div>
  );
}

function CommentPreviewRow({ commentId }: { commentId: bigint }) {
  const { data } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "comments",
    args: [commentId],
    query: { refetchInterval: SOCIAL_ROW_REFRESH_MS },
  });

  const comment = data as ZeroxNComment | undefined;
  if (!comment || comment[6]) return null;

  return (
    <div className="zeroxn-comment-preview-row flex min-w-0 items-start gap-2 border-t border-white/8 px-1 py-2">
      <ProfileBadge address={comment[1]} dense />
      <p className="min-w-0 flex-1 truncate text-xs leading-5 text-white/78">{comment[3]}</p>
    </div>
  );
}

export function PostCard({
  postId,
  post,
  viewer,
  runTx,
  detailed = false,
  ownedPixels = [],
  ownedPixelsLoading = false,
}: {
  postId: bigint;
  post: ZeroxNPost;
  viewer?: `0x${string}`;
  runTx: SocialTxRunner;
  detailed?: boolean;
  ownedPixels?: OwnedPixelOption[];
  ownedPixelsLoading?: boolean;
}) {
  const [comment, setComment] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const [pixelToken, setPixelToken] = useState("");

  const { data: liked, refetch: refetchLiked } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "likedPost",
    args: viewer ? [postId, viewer] : undefined,
    query: { enabled: Boolean(viewer), refetchInterval: viewer ? SOCIAL_ROW_REFRESH_MS : false },
  });
  const commentOffset = detailed ? 0n : BigInt(Math.max(Number(post[6] ?? 0) - 3, 0));
  const commentLimit = detailed ? 80n : 3n;
  const { data: commentIds, refetch: refetchComments } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getPostComments",
    args: [postId, commentOffset, commentLimit],
    query: {
      enabled: !post[8] && (detailed || Number(post[6] ?? 0) > 0),
      refetchInterval: !post[8] ? SOCIAL_ROW_REFRESH_MS : false,
    },
  });

  const previewComments = useMemo(() => {
    const ids = (commentIds || []) as readonly bigint[];
    return detailed ? ids : ids.slice(-3);
  }, [commentIds, detailed]);

  const canComment = comment.trim().length > 0;
  const hasPixelComment = pixelToken.trim().length > 0;

  const handleLike = async () => {
    await runTx("Like", { functionName: "likePost", args: [postId] });
    void refetchLiked();
  };

  const handleComment = async () => {
    if (!canComment) return;
    await runTx("Comment", {
      functionName: "commentOnPost",
      args: [postId, comment.trim(), hasPixelComment, hasPixelComment ? BigInt(pixelToken) : 0n],
    });
    setComment("");
    setPixelToken("");
    void refetchComments();
  };

  const handleShareLink = async () => {
    const path = `/0x/p/${postId.toString()}`;
    const url = typeof window === "undefined" ? path : new URL(path, window.location.origin).toString();

    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({
          title: `0x post #${postId.toString()}`,
          url,
        });
      } else if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      }
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1400);
    } catch {
      setShareCopied(false);
    }
  };

  return (
    <article className="zeroxn-post-card zeroxn-feed-post overflow-hidden border border-white/12 bg-black shadow-[4px_4px_0_#000]">
      <div className="zeroxn-feed-post-head flex flex-wrap items-start justify-between gap-3 border-b border-white/10 px-3 py-3 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <ProfileBadge address={post[0]} />
          <FollowButton viewer={viewer} target={post[0]} runTx={runTx} compact />
        </div>
        <div className="text-right text-[10px] uppercase tracking-[0.12em] text-white/38">
          <Link href={`/0x/p/${postId.toString()}`} className="text-white hover:text-[var(--pixel-green)]">
            #{postId.toString()}
          </Link>
          <div>{formatDate(post[4])}</div>
        </div>
      </div>

      <div className="space-y-3 px-3 py-3 sm:px-4">
        {post[8] ? (
          <p className="border border-[var(--pixel-red)]/50 bg-[rgba(255,154,169,0.08)] p-3 text-xs text-[var(--pixel-red)]">
            This post was deleted.
          </p>
        ) : (
          <>
            <p className="zeroxn-post-copy whitespace-pre-wrap break-words text-[15px] leading-7 text-white">{post[3]}</p>
            {post[7] ? (
              <PixelNftAttachment tokenId={post[2]} />
            ) : null}
          </>
        )}

        <div className="zeroxn-post-actions grid grid-cols-3 gap-1.5 pt-1 sm:gap-2">
          <button
            type="button"
            className={`pixel-btn-soft ${liked ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"}`}
            disabled={!viewer || post[8] || Boolean(liked)}
            onClick={handleLike}
            title={liked ? "Liked" : "Like"}
            aria-label={liked ? "Liked" : "Like"}
          >
            <span className="zeroxn-action-icon" aria-hidden="true">{liked ? "\u2665" : "\u2661"}</span>
            <span>{formatCount(post[5])}</span>
          </button>
          {detailed ? (
            <a href="#comment-box" className="pixel-btn-soft pixel-btn-soft-indigo text-center" title="Comment" aria-label="Comment">
              <span className="zeroxn-action-icon" aria-hidden="true">{"\u25a3"}</span>
              <span>{formatCount(post[6])}</span>
            </a>
          ) : (
            <Link href={`/0x/p/${postId.toString()}`} className="pixel-btn-soft pixel-btn-soft-indigo text-center" title="Comment" aria-label="Comment">
              <span className="zeroxn-action-icon" aria-hidden="true">{"\u25a3"}</span>
              <span>{formatCount(post[6])}</span>
            </Link>
          )}
          <button
            type="button"
            className="pixel-btn-soft pixel-btn-soft-amber"
            disabled={post[8]}
            onClick={handleShareLink}
            title="Share"
            aria-label="Share"
          >
            <span className="zeroxn-action-icon" aria-hidden="true">{shareCopied ? "\u2713" : "\u2197"}</span>
          </button>
        </div>

        {!detailed && previewComments.length > 0 ? (
          <div className="zeroxn-comment-preview">
            {previewComments.map((id) => <CommentPreviewRow key={id.toString()} commentId={id} />)}
          </div>
        ) : null}

        {detailed ? (
          <div className="border-t border-white/10 pt-3">
            <div className="space-y-1">
              {previewComments.length > 0 ? (
                previewComments.map((id) => <CommentRow key={id.toString()} commentId={id} />)
              ) : (
                <p className="py-2 text-xs text-white/35">No comments yet.</p>
              )}
            </div>

            <div id="comment-box" className="mt-3 grid gap-2 scroll-mt-24">
              <textarea
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                maxLength={360}
                rows={3}
                placeholder="Write a comment"
                className="w-full resize-none border border-white/10 bg-[#050505] px-3 py-2 text-xs leading-relaxed text-white outline-none placeholder:text-white/28 focus:border-white/30"
              />
              <div className="grid gap-2">
                <PixelNftPicker
                  label="Attach 0xPixel"
                  value={pixelToken}
                  onChange={setPixelToken}
                  ownedPixels={ownedPixels}
                  loading={ownedPixelsLoading}
                  compact
                  collapsible
                />
                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-indigo justify-self-start px-8"
                  disabled={!viewer || !canComment || post[8]}
                  onClick={handleComment}
                >
                  Send comment
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
