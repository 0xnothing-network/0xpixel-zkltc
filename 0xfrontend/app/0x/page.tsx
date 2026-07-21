"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useReadContracts,
  useSwitchChain,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { hexToString, isAddress, keccak256, stringToHex } from "viem";
import { litvm } from "@/config/wagmi";
import { useToast } from "@/components/Toast";
import { useDocumentVisibility } from "@/app/hooks/useDocumentVisibility";
import {
  ZEROXN_ABI,
  ZEROXN_ADDRESS,
  type ZeroxNChannel,
  type ZeroxNGroup,
  type ZeroxNMessage,
  type ZeroxNPost,
  type ZeroxNProfile,
} from "@/lib/0xNAbi";
import {
  formatCount,
  formatDate,
  GroupRoleBadge,
  isProfileReady,
  PanelTitle,
  PixelPanel,
  PixelNftPicker,
  PostCard,
  ProfileBadge,
  shortAddress,
  type OwnedPixelOption,
  type SocialTxRequest,
} from "./SocialComponents";

const GLOBAL_FEED_LIMIT = 24;
const POST_SCAN_LIMIT = 72;
const PROFILE_POST_PAGE_SIZE = 12;
const NOTIFICATION_PAGE_SIZE = 20;
const CHANNEL_LIMIT = 12;
const GROUP_LIMIT = 12;
const MESSAGE_SCAN_LIMIT = 96;
const DM_SCAN_LIMIT = 24;
const LIVE_FAST_MS = 4_000;
const LIVE_NORMAL_MS = 8_000;
const LIVE_SLOW_MS = 15_000;
const DM_KEY_PREFIX = "0xN_DM_KEY_V1:";
const DM_ENVELOPE_KIND = "0xN_DM_ECDH_P256_AESGCM";
const GROUP_LEGACY_ENVELOPE_KIND = "0xN_GROUP_LOCAL_AESGCM_V1";
const GROUP_MESSAGE_ENVELOPE_KIND = "0xN_GROUP_AESGCM_V1";
const GROUP_KEY_ENVELOPE_KIND = "0xN_GROUP_KEY_ECDH_P256_AESGCM_V1";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type Tab = "feed" | "channels" | "groups" | "chat" | "dm" | "profile" | "notifications";
type DmBox = "inbox" | "sent";
type FeedMode = "newest" | "following";

type SocialNotification = {
  id: string;
  kind: "like" | "comment" | "follow";
  actor: `0x${string}`;
  postId?: string;
  timestamp: number;
  transactionHash: `0x${string}`;
};

type SocialNotificationResponse = {
  notifications: SocialNotification[];
  generatedAt: number;
};

type StoredDmKeyPair = {
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
  publicKey: string;
};

type DmEnvelope = {
  v: 1;
  kind: typeof DM_ENVELOPE_KIND;
  from: string;
  to: string;
  fromPub: string;
  toPub: string;
  iv: string;
  data: string;
};

type LocalGroupEnvelope = {
  v: 1;
  kind: typeof GROUP_LEGACY_ENVELOPE_KIND;
  text: string;
};

type GroupMessageEnvelope = {
  v: 1;
  kind: typeof GROUP_MESSAGE_ENVELOPE_KIND;
  groupId: string;
  sender: string;
  iv: string;
  data: string;
};

type GroupKeyEnvelope = {
  v: 1;
  kind: typeof GROUP_KEY_ENVELOPE_KIND;
  groupId: string;
  from: string;
  to: string;
  fromPub: string;
  toPub: string;
  iv: string;
  data: string;
};

function inputClass(className = "") {
  return `w-full border border-white/10 bg-black px-3 py-2.5 text-sm text-white outline-none placeholder:text-white/28 focus:border-white/30 ${className}`;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24);
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encodeJson(value: unknown) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function decodeJson<T>(value: string) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(value))) as T;
}

function dmStorageKey(address: string) {
  return `0xn:dm-key:${address.toLowerCase()}`;
}

function groupStorageKey(address: string, groupId: string) {
  return `0xn:group-key:${address.toLowerCase()}:${groupId}`;
}

function parseDmEnvelope(payload?: `0x${string}`) {
  if (!payload || payload === "0x") return null;
  try {
    const parsed = JSON.parse(hexToString(payload)) as Partial<DmEnvelope>;
    if (parsed.kind !== DM_ENVELOPE_KIND || parsed.v !== 1 || !parsed.from || !parsed.to || !parsed.fromPub || !parsed.toPub || !parsed.iv || !parsed.data) {
      return null;
    }
    return parsed as DmEnvelope;
  } catch {
    return null;
  }
}

function decodeMaybeTextPayload(payload?: `0x${string}`) {
  if (parseDmEnvelope(payload)) return "";
  if (!payload || payload === "0x") return "";
  try {
    const text = hexToString(payload);
    if (!text || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) return "";
    return text;
  } catch {
    return "";
  }
}

function decodeLegacyGroupPayload(payload?: `0x${string}`) {
  if (!payload || payload === "0x") return "";
  try {
    const parsed = JSON.parse(hexToString(payload)) as Partial<LocalGroupEnvelope>;
    if (parsed.kind === GROUP_LEGACY_ENVELOPE_KIND && parsed.v === 1 && typeof parsed.text === "string") {
      return parsed.text;
    }
  } catch {
  }
  return decodeMaybeTextPayload(payload);
}

function parseGroupMessageEnvelope(payload?: `0x${string}`) {
  if (!payload || payload === "0x") return null;
  try {
    const parsed = JSON.parse(hexToString(payload)) as Partial<GroupMessageEnvelope>;
    if (parsed.kind !== GROUP_MESSAGE_ENVELOPE_KIND || parsed.v !== 1 || !parsed.groupId || !parsed.sender || !parsed.iv || !parsed.data) {
      return null;
    }
    return parsed as GroupMessageEnvelope;
  } catch {
    return null;
  }
}

function parseGroupKeyEnvelope(payload?: `0x${string}`) {
  if (!payload || payload === "0x") return null;
  try {
    const parsed = JSON.parse(hexToString(payload)) as Partial<GroupKeyEnvelope>;
    if (parsed.kind !== GROUP_KEY_ENVELOPE_KIND || parsed.v !== 1 || !parsed.groupId || !parsed.from || !parsed.to || !parsed.fromPub || !parsed.toPub || !parsed.iv || !parsed.data) {
      return null;
    }
    return parsed as GroupKeyEnvelope;
  } catch {
    return null;
  }
}

function loadStoredGroupKey(address?: string, groupId?: string) {
  if (!address || !groupId || typeof window === "undefined") return "";
  try {
    return window.localStorage.getItem(groupStorageKey(address, groupId)) || "";
  } catch {
    return "";
  }
}

function storeGroupKey(address: string, groupId: string, rawKey: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(groupStorageKey(address, groupId), rawKey);
  } catch {
    // The on-chain key envelope remains authoritative when storage is blocked.
  }
}

function createGroupRawKey() {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function importGroupAesKey(rawKey: string) {
  return crypto.subtle.importKey(
    "raw",
    base64UrlToBytes(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function importDmPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}

async function importDmPublicKey(encoded: string) {
  return crypto.subtle.importKey("jwk", decodeJson<JsonWebKey>(encoded), { name: "ECDH", namedCurve: "P-256" }, true, []);
}

async function loadStoredDmKeyPair(address?: string) {
  if (!address || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(dmStorageKey(address));
    if (!raw) return null;
    return JSON.parse(raw) as StoredDmKeyPair;
  } catch {
    return null;
  }
}

async function createStoredDmKeyPair(address: string) {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const stored: StoredDmKeyPair = {
    publicJwk,
    privateJwk,
    publicKey: encodeJson(publicJwk),
  };
  try {
    window.localStorage.setItem(dmStorageKey(address), JSON.stringify(stored));
  } catch {
    throw new Error("Encrypted DM keys cannot be saved in this browser");
  }
  return stored;
}

async function deriveDmAesKey(privateJwk: JsonWebKey, peerPublicKey: string) {
  const privateKey = await importDmPrivateKey(privateJwk);
  const publicKey = await importDmPublicKey(peerPublicKey);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptDmText({
  text,
  from,
  to,
  localKey,
  receiverPublicKey,
}: {
  text: string;
  from: string;
  to: string;
  localKey: StoredDmKeyPair;
  receiverPublicKey: string;
}) {
  const aesKey = await deriveDmAesKey(localKey.privateJwk, receiverPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(text),
  );
  const envelope: DmEnvelope = {
    v: 1,
    kind: DM_ENVELOPE_KIND,
    from,
    to,
    fromPub: localKey.publicKey,
    toPub: receiverPublicKey,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(cipher)),
  };
  return stringToHex(JSON.stringify(envelope));
}

async function encryptGroupKeyEnvelope({
  rawKey,
  groupId,
  from,
  to,
  localKey,
  receiverPublicKey,
}: {
  rawKey: string;
  groupId: string;
  from: string;
  to: string;
  localKey: StoredDmKeyPair;
  receiverPublicKey: string;
}) {
  const aesKey = await deriveDmAesKey(localKey.privateJwk, receiverPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    base64UrlToBytes(rawKey),
  );
  const envelope: GroupKeyEnvelope = {
    v: 1,
    kind: GROUP_KEY_ENVELOPE_KIND,
    groupId,
    from,
    to,
    fromPub: localKey.publicKey,
    toPub: receiverPublicKey,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(cipher)),
  };
  return stringToHex(JSON.stringify(envelope));
}

async function decryptGroupKeyEnvelope(envelope: GroupKeyEnvelope, currentAddress: string, localKey: StoredDmKeyPair) {
  const current = currentAddress.toLowerCase();
  const from = envelope.from.toLowerCase();
  const to = envelope.to.toLowerCase();
  if (current !== from && current !== to) throw new Error("Not a group key participant");
  const peerPublicKey = current === to ? envelope.fromPub : envelope.toPub;
  const aesKey = await deriveDmAesKey(localKey.privateJwk, peerPublicKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    aesKey,
    base64UrlToBytes(envelope.data),
  );
  return bytesToBase64Url(new Uint8Array(plain));
}

async function encryptGroupText({
  text,
  groupId,
  sender,
  rawKey,
}: {
  text: string;
  groupId: string;
  sender: string;
  rawKey: string;
}) {
  const aesKey = await importGroupAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(text),
  );
  const envelope: GroupMessageEnvelope = {
    v: 1,
    kind: GROUP_MESSAGE_ENVELOPE_KIND,
    groupId,
    sender,
    iv: bytesToBase64Url(iv),
    data: bytesToBase64Url(new Uint8Array(cipher)),
  };
  return stringToHex(JSON.stringify(envelope));
}

async function decryptGroupText(payload: `0x${string}`, rawKey: string) {
  const envelope = parseGroupMessageEnvelope(payload);
  if (!envelope) return "";
  const aesKey = await importGroupAesKey(rawKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    aesKey,
    base64UrlToBytes(envelope.data),
  );
  return new TextDecoder().decode(plain);
}

async function decryptDmEnvelope(envelope: DmEnvelope, currentAddress: string, localKey: StoredDmKeyPair) {
  const current = currentAddress.toLowerCase();
  const from = envelope.from.toLowerCase();
  const to = envelope.to.toLowerCase();
  if (current !== from && current !== to) throw new Error("Not a participant");
  const peerPublicKey = current === to ? envelope.fromPub : envelope.toPub;
  const aesKey = await deriveDmAesKey(localKey.privateJwk, peerPublicKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64UrlToBytes(envelope.iv) },
    aesKey,
    base64UrlToBytes(envelope.data),
  );
  return new TextDecoder().decode(plain);
}

export default function ZeroxSocialPage() {
  const isDocumentVisible = useDocumentVisibility();
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<Tab>("feed");
  const [profileForm, setProfileForm] = useState({
    username: "",
    displayName: "",
    bio: "",
    avatarEnabled: false,
    avatarTokenId: "",
  });
  const [postContent, setPostContent] = useState("");
  const [postPixelToken, setPostPixelToken] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [feedMode, setFeedMode] = useState<FeedMode>("newest");
  const [visibleProfilePostCount, setVisibleProfilePostCount] = useState(PROFILE_POST_PAGE_SIZE);
  const [visibleNotificationCount, setVisibleNotificationCount] = useState(NOTIFICATION_PAGE_SIZE);
  const [notificationsSeenAt, setNotificationsSeenAt] = useState<number | null>(null);
  const [channelTarget, setChannelTarget] = useState("");
  const [channelSearch, setChannelSearch] = useState("");
  const [channelCreateOpen, setChannelCreateOpen] = useState(false);
  const [channelPostContent, setChannelPostContent] = useState("");
  const [channelPostPixelToken, setChannelPostPixelToken] = useState("");
  const [channelForm, setChannelForm] = useState({ slug: "", name: "", description: "" });
  const [groupForm, setGroupForm] = useState({ name: "", description: "" });
  const [groupComposerOpen, setGroupComposerOpen] = useState(false);
  const [groupManage, setGroupManage] = useState({ member: "", officer: "", rank: "mod" });
  const [publicMessage, setPublicMessage] = useState("");
  const [groupMessage, setGroupMessage] = useState({ groupId: "", content: "" });
  const [dmForm, setDmForm] = useState({
    to: "",
    payload: "",
  });
  const [dmBox, setDmBox] = useState<DmBox>("inbox");
  const [localDmPublicKey, setLocalDmPublicKey] = useState("");
  const [dmDecryptions, setDmDecryptions] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [groupKeys, setGroupKeys] = useState<Record<string, string>>({});
  const [groupDecryptions, setGroupDecryptions] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [ownedPixels, setOwnedPixels] = useState<OwnedPixelOption[]>([]);
  const [ownedPixelsLoading, setOwnedPixelsLoading] = useState(false);
  const [ownedPixelsError, setOwnedPixelsError] = useState("");
  const liveRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLiveRefetchAtRef = useRef(0);
  const tabsRef = useRef<HTMLElement | null>(null);

  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: litvm.id });
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    loadStoredDmKeyPair(address).then((stored) => {
      if (!cancelled) setLocalDmPublicKey(stored?.publicKey ?? "");
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  useEffect(() => {
    if (!address) {
      setOwnedPixels([]);
      setOwnedPixelsError("");
      return;
    }

    const controller = new AbortController();
    setOwnedPixelsLoading(true);
    setOwnedPixelsError("");

    fetch(`/api/user-nfts?address=${address}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text());
        return response.json() as Promise<{ tokens?: OwnedPixelOption[] }>;
      })
      .then((body) => setOwnedPixels(body.tokens ?? []))
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setOwnedPixels([]);
        setOwnedPixelsError("Could not load 0xPixel NFTs from this wallet.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setOwnedPixelsLoading(false);
      });

    return () => controller.abort();
  }, [address]);

  const { data: profileData, refetch: refetchProfile } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "profiles",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: LIVE_SLOW_MS },
  });
  const { data: isVerified } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: LIVE_SLOW_MS },
  });
  const { data: followers } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "followerCount",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: LIVE_SLOW_MS },
  });
  const { data: following } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "followingCount",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: LIVE_SLOW_MS },
  });
  const { data: maxLikes } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "maxPostLikes",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address), refetchInterval: LIVE_SLOW_MS },
  });
  const { data: postCount, refetch: refetchPostCount, isLoading: postCountLoading } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "postCount",
    query: {
      enabled: tab === "feed" || tab === "profile",
      refetchInterval: tab === "feed" || tab === "profile" ? LIVE_NORMAL_MS : false,
    },
  });
  const { data: channelCount, refetch: refetchChannelCount } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "channelCount",
    query: { enabled: tab === "channels", refetchInterval: tab === "channels" ? LIVE_SLOW_MS : false },
  });
  const { data: groupCount, refetch: refetchGroupCount } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupCount",
    query: { enabled: tab === "groups", refetchInterval: tab === "groups" ? LIVE_SLOW_MS : false },
  });
  const { data: messageCount, refetch: refetchMessageCount } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "messageCount",
    query: { enabled: tab === "chat" || tab === "dm", refetchInterval: tab === "chat" || tab === "dm" ? LIVE_FAST_MS : false },
  });

  const profile = profileData as ZeroxNProfile | undefined;
  const hasProfile = isProfileReady(profile);
  const canUseSocial = mounted && hasProfile;

  const {
    data: notificationData,
    error: notificationsError,
    isLoading: notificationsLoading,
    isFetching: notificationsFetching,
    refetch: refetchNotifications,
  } = useQuery<SocialNotificationResponse>({
    queryKey: ["0x-notifications", address],
    enabled: canUseSocial && Boolean(address),
    staleTime: 5_000,
    refetchInterval: tab === "notifications" ? LIVE_NORMAL_MS : 60_000,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/social/notifications?address=${address}`, { signal });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || "Could not load notifications.");
      }
      return response.json() as Promise<SocialNotificationResponse>;
    },
  });

  const notifications = useMemo(
    () => notificationData?.notifications ?? [],
    [notificationData?.notifications],
  );
  const unreadNotificationCount = useMemo(() => {
    if (notificationsSeenAt === null) return 0;
    return notifications.filter((notification) => notification.timestamp > notificationsSeenAt).length;
  }, [notifications, notificationsSeenAt]);
  const visibleNotifications = useMemo(
    () => notifications.slice(0, visibleNotificationCount),
    [notifications, visibleNotificationCount],
  );

  useEffect(() => {
    setVisibleProfilePostCount(PROFILE_POST_PAGE_SIZE);
    setVisibleNotificationCount(NOTIFICATION_PAGE_SIZE);
    if (!address) {
      setNotificationsSeenAt(null);
      return;
    }

    const stored = window.localStorage.getItem(`0x-notifications-seen:${address.toLowerCase()}`);
    const parsed = stored ? Number(stored) : 0;
    setNotificationsSeenAt(Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }, [address]);

  useEffect(() => {
    if (tab !== "notifications" || !address || notificationsSeenAt === null || notifications.length === 0) return;
    const latestTimestamp = notifications.reduce(
      (latest, notification) => Math.max(latest, notification.timestamp),
      notificationsSeenAt,
    );
    if (latestTimestamp <= notificationsSeenAt) return;
    window.localStorage.setItem(`0x-notifications-seen:${address.toLowerCase()}`, latestTimestamp.toString());
    setNotificationsSeenAt(latestTimestamp);
  }, [address, notifications, notificationsSeenAt, tab]);

  useEffect(() => {
    const activeTab = tabsRef.current?.querySelector<HTMLElement>("[aria-current='page']");
    activeTab?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [tab]);

  useEffect(() => {
    if (profile && profile[5]) {
      setProfileForm({
        username: profile[0],
        displayName: profile[1],
        bio: profile[2],
        avatarEnabled: profile[4],
        avatarTokenId: profile[3] > 0n ? profile[3].toString() : "",
      });
      return;
    }

    setProfileForm({
      username: "",
      displayName: "",
      bio: "",
      avatarEnabled: false,
      avatarTokenId: "",
    });
  }, [address, profile]);

  const recentPostIds = useMemo(() => {
    const count = (postCount as bigint | undefined) ?? 0n;
    if (count <= 0n) return [];
    const ids: bigint[] = [];
    for (let id = count; id >= 1n && ids.length < POST_SCAN_LIMIT; id -= 1n) {
      ids.push(id);
    }
    return ids;
  }, [postCount]);

  const feedContracts = useMemo(
    () =>
      recentPostIds.map((postId) => ({
        address: ZEROXN_ADDRESS,
        abi: ZEROXN_ABI,
        functionName: "posts" as const,
        args: [postId],
      })),
    [recentPostIds],
  );

  const { data: feedData, refetch: refetchFeed } = useReadContracts({
    contracts: feedContracts,
    allowFailure: true,
    query: { enabled: tab === "feed" && feedContracts.length > 0, refetchInterval: tab === "feed" && canUseSocial ? LIVE_NORMAL_MS : false },
  });

  const globalPosts = useMemo(() => {
    return recentPostIds
      .map((postId, index) => {
        const result = feedData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const post = result.result as ZeroxNPost;
        if (!post[0] || post[0] === "0x0000000000000000000000000000000000000000") return null;
        if (post[1] !== 0n) return null;
        return { postId, post };
      })
      .filter((item): item is { postId: bigint; post: ZeroxNPost } => Boolean(item));
  }, [feedData, recentPostIds]);

  const { data: followingFeedData } = useReadContracts({
    contracts: globalPosts.map(({ post }) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "following" as const,
      args: [address ?? "0x0000000000000000000000000000000000000000", post[0]],
    })),
    allowFailure: true,
    query: {
      enabled: tab === "feed" && feedMode === "following" && Boolean(address) && globalPosts.length > 0,
      refetchInterval: tab === "feed" && feedMode === "following" ? LIVE_NORMAL_MS : false,
    },
  });

  const feedPosts = useMemo(() => {
    if (feedMode === "following") {
      return globalPosts
        .filter((_, index) => {
          const result = followingFeedData?.[index];
          return result?.status === "success" && Boolean(result.result);
        })
        .slice(0, GLOBAL_FEED_LIMIT);
    }

    return globalPosts.slice(0, GLOBAL_FEED_LIMIT);
  }, [feedMode, followingFeedData, globalPosts]);

  const totalPostCount = (postCount as bigint | undefined) ?? 0n;
  const {
    data: profilePostIdsData,
    error: profilePostIdsError,
    isLoading: profilePostIdsLoading,
    refetch: refetchProfilePostIds,
  } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getUserPosts",
    args: address && totalPostCount > 0n ? [address, 0n, totalPostCount] : undefined,
    query: {
      enabled: tab === "profile" && Boolean(address) && totalPostCount > 0n,
      refetchInterval: tab === "profile" ? LIVE_NORMAL_MS : false,
    },
  });

  const profilePostIds = useMemo(
    () => [...((profilePostIdsData ?? []) as readonly bigint[])].reverse(),
    [profilePostIdsData],
  );
  const visibleProfilePostIds = useMemo(
    () => profilePostIds.slice(0, visibleProfilePostCount),
    [profilePostIds, visibleProfilePostCount],
  );
  const {
    data: profilePostData,
    error: profilePostDataError,
    isLoading: profilePostDataLoading,
    refetch: refetchProfilePostData,
  } = useReadContracts({
    contracts: visibleProfilePostIds.map((postId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "posts" as const,
      args: [postId],
    })),
    allowFailure: true,
    query: {
      enabled: tab === "profile" && visibleProfilePostIds.length > 0,
      refetchInterval: tab === "profile" && visibleProfilePostIds.length > 0 ? LIVE_NORMAL_MS : false,
    },
  });

  const profilePosts = useMemo(
    () => visibleProfilePostIds
      .map((postId, index) => {
        const result = profilePostData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        return { postId, post: result.result as ZeroxNPost };
      })
      .filter((item): item is { postId: bigint; post: ZeroxNPost } => Boolean(item)),
    [profilePostData, visibleProfilePostIds],
  );
  const profilePostsLoading = postCountLoading
    || profilePostIdsLoading
    || (visibleProfilePostIds.length > 0 && profilePostDataLoading);
  const profilePostReadFailures = profilePostData?.filter((result) => result.status === "failure").length ?? 0;
  const profilePostsError = profilePostIdsError || profilePostDataError || profilePostReadFailures > 0;

  const recentMessageIds = useMemo(() => {
    const count = (messageCount as bigint | undefined) ?? 0n;
    if (count <= 0n) return [];
    const ids: bigint[] = [];
    for (let id = count; id >= 1n && ids.length < MESSAGE_SCAN_LIMIT; id -= 1n) {
      ids.push(id);
    }
    return ids;
  }, [messageCount]);

  const { data: messageData, refetch: refetchMessages } = useReadContracts({
    contracts: recentMessageIds.map((messageId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "messages" as const,
      args: [messageId],
    })),
    allowFailure: true,
    query: { enabled: (tab === "chat" || tab === "dm") && recentMessageIds.length > 0, refetchInterval: (tab === "chat" || tab === "dm") && canUseSocial ? LIVE_FAST_MS : false },
  });

  const publicMessages = useMemo(() => {
    return recentMessageIds
      .map((messageId, index) => {
        const result = messageData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const message = result.result as ZeroxNMessage;
        if (message[7] || Number(message[6]) !== 1) return null;
        if (message[3].startsWith(DM_KEY_PREFIX)) return null;
        return { messageId, message };
      })
      .filter((item): item is { messageId: bigint; message: ZeroxNMessage } => Boolean(item))
      .slice(0, 12);
  }, [messageData, recentMessageIds]);

  const dmPublicKeys = useMemo(() => {
    const keys = new Map<string, string>();
    recentMessageIds.forEach((_, index) => {
      const result = messageData?.[index];
      if (!result || result.status !== "success" || !result.result) return;
      const message = result.result as ZeroxNMessage;
      if (message[7] || Number(message[6]) !== 1 || !message[3].startsWith(DM_KEY_PREFIX)) return;
      const owner = message[0].toLowerCase();
      if (!keys.has(owner)) keys.set(owner, message[3].slice(DM_KEY_PREFIX.length));
    });
    return keys;
  }, [messageData, recentMessageIds]);

  const recentChannelIds = useMemo(() => {
    const count = (channelCount as bigint | undefined) ?? 0n;
    if (count <= 0n) return [];
    const ids: bigint[] = [];
    for (let id = count; id >= 1n && ids.length < CHANNEL_LIMIT; id -= 1n) {
      ids.push(id);
    }
    return ids;
  }, [channelCount]);

  const { data: channelData, refetch: refetchChannels } = useReadContracts({
    contracts: recentChannelIds.map((channelId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "channels" as const,
      args: [channelId],
    })),
    allowFailure: true,
    query: { enabled: tab === "channels" && recentChannelIds.length > 0, refetchInterval: tab === "channels" && canUseSocial ? LIVE_SLOW_MS : false },
  });

  const channels = useMemo(() => {
    return recentChannelIds
      .map((channelId, index) => {
        const result = channelData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const channel = result.result as ZeroxNChannel;
        if (!channel[6]) return null;
        return { channelId, channel };
      })
      .filter((item): item is { channelId: bigint; channel: ZeroxNChannel } => Boolean(item));
  }, [channelData, recentChannelIds]);

  const filteredChannels = useMemo(() => {
    const query = channelSearch.trim().toLowerCase();
    if (!query) return channels;
    return channels.filter(({ channel }) => (
      channel[1].toLowerCase().includes(query) ||
      channel[2].toLowerCase().includes(query) ||
      channel[3].toLowerCase().includes(query)
    ));
  }, [channelSearch, channels]);

  const channelsLoading = recentChannelIds.length > 0 && channelData === undefined;

  useEffect(() => {
    if (tab !== "channels" || channels.length === 0) return;
    setChannelTarget((current) => (
      channels.some(({ channelId }) => channelId.toString() === current)
        ? current
        : channels[0].channelId.toString()
    ));
  }, [channels, tab]);

  const selectedChannel = useMemo(() => {
    if (!channelTarget) return null;
    return channels.find((item) => item.channelId.toString() === channelTarget) ?? null;
  }, [channelTarget, channels]);

  const {
    data: selectedChannelMember,
    isPending: selectedChannelMemberPending,
    refetch: refetchSelectedChannelMember,
  } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "channelMember",
    args: selectedChannel && address ? [selectedChannel.channelId, address] : undefined,
    query: { enabled: tab === "channels" && Boolean(selectedChannel && address), refetchInterval: tab === "channels" && selectedChannel ? LIVE_NORMAL_MS : false },
  });

  const {
    data: selectedChannelPostIdsData,
    isPending: selectedChannelPostIdsPending,
    refetch: refetchSelectedChannelPosts,
  } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getChannelPosts",
    args: [selectedChannel?.channelId ?? 0n, 0n, 24n],
    query: { enabled: tab === "channels" && Boolean(selectedChannel), refetchInterval: tab === "channels" && selectedChannel ? LIVE_NORMAL_MS : false },
  });

  const selectedChannelPostIds = useMemo(() => {
    const ids = (selectedChannelPostIdsData || []) as readonly bigint[];
    return [...ids].reverse().slice(0, 12);
  }, [selectedChannelPostIdsData]);

  const { data: selectedChannelPostData, refetch: refetchSelectedChannelPostData } = useReadContracts({
    contracts: selectedChannelPostIds.map((postId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "posts" as const,
      args: [postId],
    })),
    allowFailure: true,
    query: { enabled: tab === "channels" && selectedChannelPostIds.length > 0, refetchInterval: tab === "channels" && selectedChannelPostIds.length > 0 ? LIVE_NORMAL_MS : false },
  });

  const selectedChannelPosts = useMemo(() => {
    return selectedChannelPostIds
      .map((postId, index) => {
        const result = selectedChannelPostData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const post = result.result as ZeroxNPost;
        if (post[8]) return null;
        return { postId, post };
      })
      .filter((item): item is { postId: bigint; post: ZeroxNPost } => Boolean(item));
  }, [selectedChannelPostData, selectedChannelPostIds]);

  const selectedChannelPostsLoading = Boolean(
    selectedChannel && (
      selectedChannelPostIdsPending ||
      (selectedChannelPostIds.length > 0 && selectedChannelPostData === undefined)
    ),
  );

  const recentGroupIds = useMemo(() => {
    const count = (groupCount as bigint | undefined) ?? 0n;
    if (count <= 0n) return [];
    const ids: bigint[] = [];
    for (let id = count; id >= 1n && ids.length < GROUP_LIMIT; id -= 1n) {
      ids.push(id);
    }
    return ids;
  }, [groupCount]);

  const { data: groupData, refetch: refetchGroups } = useReadContracts({
    contracts: recentGroupIds.map((groupId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "groups" as const,
      args: [groupId],
    })),
    allowFailure: true,
    query: { enabled: tab === "groups" && recentGroupIds.length > 0, refetchInterval: tab === "groups" && canUseSocial ? LIVE_NORMAL_MS : false },
  });

  const { data: groupMembershipData, refetch: refetchGroupMembership } = useReadContracts({
    contracts: recentGroupIds.map((groupId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "groupMember" as const,
      args: [groupId, address ?? "0x0000000000000000000000000000000000000000"],
    })),
    allowFailure: true,
    query: {
      enabled: tab === "groups" && Boolean(address) && recentGroupIds.length > 0,
      refetchInterval: tab === "groups" && canUseSocial ? LIVE_NORMAL_MS : false,
    },
  });

  const groupMembershipLoading = Boolean(canUseSocial && recentGroupIds.length > 0 && !groupMembershipData);

  const groups = useMemo(() => {
    if (!address) return [];
    return recentGroupIds
      .map((groupId, index) => {
        const result = groupData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const membership = groupMembershipData?.[index];
        if (!membership || membership.status !== "success" || !membership.result) return null;
        const group = result.result as ZeroxNGroup;
        if (!group[6]) return null;
        return { groupId, group };
      })
      .filter((item): item is { groupId: bigint; group: ZeroxNGroup } => Boolean(item));
  }, [address, groupData, groupMembershipData, recentGroupIds]);

  const selectedGroup = useMemo(() => {
    if (!groupMessage.groupId) return null;
    return groups.find((item) => item.groupId.toString() === groupMessage.groupId) ?? null;
  }, [groupMessage.groupId, groups]);

  useEffect(() => {
    if (!canUseSocial) return;

    setGroupMessage((value) => {
      if (groups.length === 0) {
        return value.groupId ? { ...value, groupId: "" } : value;
      }
      if (value.groupId && groups.some((item) => item.groupId.toString() === value.groupId)) {
        return value;
      }
      return { ...value, groupId: groups[0].groupId.toString() };
    });
  }, [canUseSocial, groups]);

  const { data: selectedGroupMember, refetch: refetchSelectedGroupMember } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupMember",
    args: selectedGroup && address ? [selectedGroup.groupId, address] : undefined,
    query: { enabled: tab === "groups" && Boolean(selectedGroup && address), refetchInterval: tab === "groups" && selectedGroup ? LIVE_FAST_MS : false },
  });

  const { data: selectedGroupAdmin, refetch: refetchSelectedGroupAdmin } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupAdmin",
    args: selectedGroup && address ? [selectedGroup.groupId, address] : undefined,
    query: { enabled: tab === "groups" && Boolean(selectedGroup && address), refetchInterval: tab === "groups" && selectedGroup ? LIVE_NORMAL_MS : false },
  });

  const { data: managedGroupMember } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupMember",
    args: selectedGroup && isAddress(groupManage.member) ? [selectedGroup.groupId, groupManage.member] : undefined,
    query: { enabled: tab === "groups" && Boolean(selectedGroup && isAddress(groupManage.member)), refetchInterval: tab === "groups" && selectedGroup ? LIVE_NORMAL_MS : false },
  });

  const { data: selectedGroupKeyEnvelope, refetch: refetchSelectedGroupKeyEnvelope } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "groupKeyEnvelope",
    args: selectedGroup && address ? [selectedGroup.groupId, address] : undefined,
    query: { enabled: tab === "groups" && Boolean(selectedGroup && address), refetchInterval: tab === "groups" && selectedGroup ? LIVE_NORMAL_MS : false },
  });

  const selectedGroupIdText = selectedGroup?.groupId.toString() ?? "";
  const selectedGroupKey = selectedGroupIdText ? groupKeys[selectedGroupIdText] ?? "" : "";
  const selectedGroupKeyEnvelopeHex = selectedGroupKeyEnvelope as `0x${string}` | undefined;

  const selectedGroupMessageOffset = useMemo(() => {
    const total = BigInt(selectedGroup?.group[5] ?? 0);
    return total > 24n ? total - 24n : 0n;
  }, [selectedGroup]);

  const { data: selectedGroupMessageIdsData, refetch: refetchSelectedGroupMessages } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getGroupMessages",
    args: selectedGroup && address ? [selectedGroup.groupId, selectedGroupMessageOffset, 24n] : undefined,
    account: address,
    query: {
      enabled: tab === "groups" && Boolean(selectedGroup && selectedGroupMember && address),
      refetchInterval: tab === "groups" && selectedGroup && selectedGroupMember ? LIVE_FAST_MS : false,
    },
  });

  const selectedGroupMessageIds = useMemo(() => {
    const ids = (selectedGroupMessageIdsData || []) as readonly bigint[];
    return [...ids].reverse().slice(0, 12);
  }, [selectedGroupMessageIdsData]);

  const { data: selectedGroupMessageData, refetch: refetchSelectedGroupMessageData } = useReadContracts({
    contracts: selectedGroupMessageIds.map((messageId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "messages" as const,
      args: [messageId],
    })),
    allowFailure: true,
    query: { enabled: tab === "groups" && selectedGroupMessageIds.length > 0, refetchInterval: tab === "groups" && selectedGroupMessageIds.length > 0 ? LIVE_FAST_MS : false },
  });

  const selectedGroupMessages = useMemo(() => {
    return selectedGroupMessageIds
      .map((messageId, index) => {
        const result = selectedGroupMessageData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const message = result.result as ZeroxNMessage;
        if (message[7] || Number(message[6]) !== 2) return null;
        return { messageId, message };
      })
      .filter((item): item is { messageId: bigint; message: ZeroxNMessage } => Boolean(item));
  }, [selectedGroupMessageData, selectedGroupMessageIds]);

  useEffect(() => {
    let cancelled = false;

    async function unlockGroupKey() {
      if (!address || !selectedGroupIdText) return;

      const storedGroupKey = loadStoredGroupKey(address, selectedGroupIdText);
      if (storedGroupKey) {
        if (!cancelled) {
          setGroupKeys((value) => ({ ...value, [selectedGroupIdText]: storedGroupKey }));
        }
        return;
      }

      const envelope = parseGroupKeyEnvelope(selectedGroupKeyEnvelopeHex);
      if (!envelope) return;

      const localKey = await loadStoredDmKeyPair(address);
      if (!localKey) return;

      try {
        const rawKey = await decryptGroupKeyEnvelope(envelope, address, localKey);
        if (cancelled) return;
        storeGroupKey(address, selectedGroupIdText, rawKey);
        setGroupKeys((value) => ({ ...value, [selectedGroupIdText]: rawKey }));
      } catch {
      }
    }

    void unlockGroupKey();
    return () => {
      cancelled = true;
    };
  }, [address, localDmPublicKey, selectedGroupIdText, selectedGroupKeyEnvelopeHex]);

  useEffect(() => {
    let cancelled = false;

    async function decryptGroupMessages() {
      const next: Record<string, { ok: boolean; text: string }> = {};

      await Promise.all(selectedGroupMessages.map(async ({ messageId, message }) => {
        const key = messageId.toString();
        const legacyText = decodeLegacyGroupPayload(message[4]);
        if (legacyText && !parseGroupMessageEnvelope(message[4])) {
          next[key] = { ok: true, text: legacyText };
          return;
        }

        if (!selectedGroupKey) {
          next[key] = { ok: false, text: "Locked message. This wallet has no group key in this browser." };
          return;
        }

        try {
          const text = await decryptGroupText(message[4], selectedGroupKey);
          next[key] = { ok: true, text: text || "Empty encrypted message." };
        } catch {
          next[key] = { ok: false, text: "Could not decrypt this group message." };
        }
      }));

      if (!cancelled) setGroupDecryptions(next);
    }

    void decryptGroupMessages();
    return () => {
      cancelled = true;
    };
  }, [selectedGroupKey, selectedGroupMessages]);

  const { data: inboxIdsData, refetch: refetchInbox } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getInbox",
    args: address ? [address, 0n, BigInt(DM_SCAN_LIMIT)] : undefined,
    query: { enabled: tab === "dm" && Boolean(address), refetchInterval: tab === "dm" && address ? LIVE_FAST_MS : false },
  });

  const { data: sentIdsData, refetch: refetchSent } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "getSent",
    args: address ? [address, 0n, BigInt(DM_SCAN_LIMIT)] : undefined,
    query: { enabled: tab === "dm" && Boolean(address), refetchInterval: tab === "dm" && address ? LIVE_FAST_MS : false },
  });

  const inboxIds = useMemo(() => {
    const ids = (inboxIdsData || []) as readonly bigint[];
    return [...ids].reverse().slice(0, DM_SCAN_LIMIT);
  }, [inboxIdsData]);

  const sentIds = useMemo(() => {
    const ids = (sentIdsData || []) as readonly bigint[];
    return [...ids].reverse().slice(0, DM_SCAN_LIMIT);
  }, [sentIdsData]);

  const activeDmIds = dmBox === "inbox" ? inboxIds : sentIds;

  const { data: dmData, refetch: refetchDmMessages } = useReadContracts({
    contracts: activeDmIds.map((messageId) => ({
      address: ZEROXN_ADDRESS,
      abi: ZEROXN_ABI,
      functionName: "messages" as const,
      args: [messageId],
    })),
    allowFailure: true,
    query: { enabled: tab === "dm" && activeDmIds.length > 0, refetchInterval: tab === "dm" && activeDmIds.length > 0 ? LIVE_FAST_MS : false },
  });

  const dmMessages = useMemo(() => {
    return activeDmIds
      .map((messageId, index) => {
        const result = dmData?.[index];
        if (!result || result.status !== "success" || !result.result) return null;
        const message = result.result as ZeroxNMessage;
        if (message[7] || Number(message[6]) !== 3) return null;
        return { messageId, message };
      })
      .filter((item): item is { messageId: bigint; message: ZeroxNMessage } => Boolean(item));
  }, [activeDmIds, dmData]);

  const dmReceiverInput = dmForm.to.trim();
  const dmReceiverUsername = useMemo(() => {
    if (!dmReceiverInput || isAddress(dmReceiverInput)) return "";
    return normalizeUsername(dmReceiverInput.startsWith("@") ? dmReceiverInput.slice(1) : dmReceiverInput);
  }, [dmReceiverInput]);
  const dmReceiverUsernameHash = useMemo(
    () => (dmReceiverUsername ? keccak256(stringToHex(dmReceiverUsername)) : undefined),
    [dmReceiverUsername],
  );
  const { data: dmReceiverOwnerData } = useReadContract({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    functionName: "usernameOwner",
    args: dmReceiverUsernameHash ? [dmReceiverUsernameHash] : undefined,
    query: { enabled: Boolean(dmReceiverUsernameHash), staleTime: LIVE_FAST_MS },
  });
  const dmResolvedTo = useMemo(() => {
    if (isAddress(dmReceiverInput)) return dmReceiverInput as `0x${string}`;
    const owner = dmReceiverOwnerData as `0x${string}` | undefined;
    if (owner && owner !== ZERO_ADDRESS) return owner;
    return "";
  }, [dmReceiverInput, dmReceiverOwnerData]);

  const receiverDmPublicKey = useMemo(() => {
    if (!dmResolvedTo) return "";
    return dmPublicKeys.get(dmResolvedTo.toLowerCase()) ?? "";
  }, [dmPublicKeys, dmResolvedTo]);

  const groupMemberDmPublicKey = useMemo(() => {
    if (!isAddress(groupManage.member)) return "";
    return dmPublicKeys.get(groupManage.member.toLowerCase()) ?? "";
  }, [dmPublicKeys, groupManage.member]);

  const isOwnDmKeyPublished = Boolean(address && localDmPublicKey && dmPublicKeys.get(address.toLowerCase()) === localDmPublicKey);

  useEffect(() => {
    let cancelled = false;

    async function decryptMessages() {
      const stored = await loadStoredDmKeyPair(address);
      if (!stored || !address || dmMessages.length === 0) {
        if (!cancelled) setDmDecryptions({});
        return;
      }

      const next: Record<string, { ok: boolean; text: string }> = {};
      await Promise.all(dmMessages.map(async ({ messageId, message }) => {
        const envelope = parseDmEnvelope(message[4]);
        if (!envelope) return;
        const key = messageId.toString();
        if (envelope.from.toLowerCase() !== message[0].toLowerCase() || envelope.to.toLowerCase() !== message[1].toLowerCase()) {
          next[key] = { ok: false, text: "Envelope does not match this message." };
          return;
        }
        try {
          next[key] = { ok: true, text: await decryptDmEnvelope(envelope, address, stored) };
        } catch {
          next[key] = { ok: false, text: "Cannot decrypt with this browser key." };
        }
      }));

      if (!cancelled) setDmDecryptions(next);
    }

    void decryptMessages();
    return () => {
      cancelled = true;
    };
  }, [address, dmMessages, localDmPublicKey]);

  const refetchLiveSocial = useCallback(() => {
    void refetchProfile();
    if (tab === "feed") {
      void refetchPostCount();
      void refetchFeed();
    } else if (tab === "channels") {
      void refetchChannelCount();
      void refetchChannels();
      void refetchSelectedChannelPosts();
      void refetchSelectedChannelPostData();
      void refetchSelectedChannelMember();
    } else if (tab === "groups") {
      void refetchGroupCount();
      void refetchGroups();
      void refetchGroupMembership();
      void refetchSelectedGroupMember();
      void refetchSelectedGroupAdmin();
      void refetchSelectedGroupKeyEnvelope();
      void refetchSelectedGroupMessages();
      void refetchSelectedGroupMessageData();
    } else if (tab === "chat") {
      void refetchMessageCount();
      void refetchMessages();
    } else if (tab === "dm") {
      void refetchMessageCount();
      void refetchMessages();
      void refetchInbox();
      void refetchSent();
      void refetchDmMessages();
    } else if (tab === "profile") {
      void refetchPostCount();
      void refetchProfilePostIds();
      void refetchProfilePostData();
    } else if (tab === "notifications") {
      void refetchNotifications();
    }
  }, [
    refetchChannelCount,
    refetchChannels,
    refetchDmMessages,
    refetchFeed,
    refetchGroupCount,
    refetchGroupMembership,
    refetchGroups,
    refetchInbox,
    refetchMessageCount,
    refetchMessages,
    refetchPostCount,
    refetchProfile,
    refetchProfilePostData,
    refetchProfilePostIds,
    refetchNotifications,
    refetchSelectedChannelMember,
    refetchSelectedChannelPostData,
    refetchSelectedChannelPosts,
    refetchSelectedGroupMember,
    refetchSelectedGroupAdmin,
    refetchSelectedGroupKeyEnvelope,
    refetchSelectedGroupMessageData,
    refetchSelectedGroupMessages,
    refetchSent,
    tab,
  ]);

  const scheduleLiveSocialRefetch = useCallback(() => {
    const now = Date.now();
    const elapsed = now - lastLiveRefetchAtRef.current;

    if (elapsed >= 1_500) {
      lastLiveRefetchAtRef.current = now;
      refetchLiveSocial();
      return;
    }

    if (liveRefetchTimerRef.current) return;
    liveRefetchTimerRef.current = setTimeout(() => {
      liveRefetchTimerRef.current = null;
      lastLiveRefetchAtRef.current = Date.now();
      refetchLiveSocial();
    }, 1_500 - elapsed);
  }, [refetchLiveSocial]);

  useEffect(() => () => {
    if (liveRefetchTimerRef.current) {
      clearTimeout(liveRefetchTimerRef.current);
      liveRefetchTimerRef.current = null;
    }
  }, []);

  useWatchContractEvent({
    address: ZEROXN_ADDRESS,
    abi: ZEROXN_ABI,
    onLogs: scheduleLiveSocialRefetch,
    enabled: canUseSocial && isDocumentVisible,
  });

  async function runTx(label: string, request: SocialTxRequest) {
    if (!mounted || !isConnected) {
      toast.warning("Connect wallet", "Connect your wallet to use 0x.");
      return false;
    }
    if (!publicClient) {
      toast.error("RPC unavailable", "Please refresh and try again.");
      return false;
    }
    try {
      if (chainId !== litvm.id) {
        await switchChainAsync({ chainId: litvm.id });
      }
      const hash = await writeContractAsync({
        address: ZEROXN_ADDRESS,
        abi: ZEROXN_ABI,
        functionName: request.functionName as never,
        args: (request.args ?? []) as never,
      });
      toast.info(`${label} sent`, shortAddress(hash));
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error(`${label} transaction reverted`);
      toast.success(`${label} confirmed`);
      refetchLiveSocial();
      return true;
    } catch (error) {
      toast.handleError(error, `${label} failed`);
      return false;
    }
  }

  const connectWallet = () => {
    const connector = connectors[0];
    if (connector) connect({ connector });
  };

  const submitProfile = async () => {
    const username = normalizeUsername(profileForm.username);
    if (!username) {
      toast.warning("Username needed", "Use lowercase letters, numbers, dot, or underscore.");
      return;
    }
    const avatarToken = profileForm.avatarEnabled && profileForm.avatarTokenId
      ? BigInt(profileForm.avatarTokenId)
      : 0n;
    await runTx(hasProfile ? "Update profile" : "Create profile", {
      functionName: hasProfile ? "updateProfile" : "registerProfile",
      args: hasProfile
        ? [profileForm.displayName.trim(), profileForm.bio.trim(), profileForm.avatarEnabled, avatarToken]
        : [username, profileForm.displayName.trim(), profileForm.bio.trim(), profileForm.avatarEnabled, avatarToken],
    });
  };

  const changeUsername = async () => {
    const username = normalizeUsername(profileForm.username);
    if (!username) return;
    await runTx("Change username", {
      functionName: "changeUsername",
      args: [username],
    });
  };

  const submitPost = async () => {
    const content = postContent.trim();
    if (!content) return;
    const hasPixel = postPixelToken.trim().length > 0;
    const succeeded = await runTx("Post", {
      functionName: "createPost",
      args: [content, hasPixel, hasPixel ? BigInt(postPixelToken) : 0n],
    });
    if (!succeeded) return;
    setPostContent("");
    setPostPixelToken("");
    setComposerOpen(false);
  };

  const submitChannelPost = async () => {
    const channelId = BigInt(channelTarget || "0");
    const content = channelPostContent.trim();
    if (channelId <= 0n || !content) return;
    const hasPixel = channelPostPixelToken.trim().length > 0;
    const succeeded = await runTx("Channel post", {
      functionName: "postToChannel",
      args: [channelId, content, hasPixel, hasPixel ? BigInt(channelPostPixelToken) : 0n],
    });
    if (!succeeded) return;
    setChannelPostContent("");
    setChannelPostPixelToken("");
  };

  const submitChannel = async () => {
    const slug = channelForm.slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
    if (!slug || !channelForm.name.trim()) return;
    const succeeded = await runTx("Create channel", {
      functionName: "createChannel",
      args: [slug, channelForm.name.trim(), channelForm.description.trim()],
    });
    if (!succeeded) return;
    setChannelForm({ slug: "", name: "", description: "" });
    setChannelCreateOpen(false);
  };

  const joinSelectedChannel = async () => {
    if (!selectedChannel) return;
    const succeeded = await runTx("Join channel", {
      functionName: "joinChannel",
      args: [selectedChannel.channelId],
    });
    if (succeeded) void refetchSelectedChannelMember();
  };

  const submitGroup = async () => {
    if (!groupForm.name.trim()) return;

    if (!address) {
      toast.warning("Connect wallet", "Connect your wallet first.");
      return;
    }

    const localKey = await ensureLocalDmKey();
    if (!localKey) return;

    const nextGroupId = ((groupCount ?? 0n) + 1n).toString();
    const rawKey = createGroupRawKey();
    let creatorKeyEnvelope: `0x${string}`;

    try {
      creatorKeyEnvelope = await encryptGroupKeyEnvelope({
        rawKey,
        groupId: nextGroupId,
        from: address,
        to: address,
        localKey,
        receiverPublicKey: localKey.publicKey,
      });
    } catch {
      toast.error("Key encryption failed", "Could not prepare this room key.");
      return;
    }

    const succeeded = await runTx("Create group", {
      functionName: "createGroup",
      args: [
        groupForm.name.trim(),
        groupForm.description.trim(),
        creatorKeyEnvelope,
      ],
    });
    if (!succeeded) return;
    storeGroupKey(address, nextGroupId, rawKey);
    setGroupKeys((value) => ({ ...value, [nextGroupId]: rawKey }));
    setGroupForm({ name: "", description: "" });
    setGroupComposerOpen(false);
  };

  const repairSelectedGroupKey = async () => {
    if (!selectedGroup || !address) return;

    const localKey = await ensureLocalDmKey();
    if (!localKey) return;

    const rawKey = selectedGroupKey || createGroupRawKey();
    let keyEnvelope: `0x${string}`;
    try {
      keyEnvelope = await encryptGroupKeyEnvelope({
        rawKey,
        groupId: selectedGroup.groupId.toString(),
        from: address,
        to: address,
        localKey,
        receiverPublicKey: localKey.publicKey,
      });
    } catch {
      toast.error("Key encryption failed", "Could not repair this room key.");
      return;
    }

    const succeeded = await runTx(selectedGroupKey ? "Repair room key" : "Create room key", {
      functionName: "setGroupKeyEnvelope",
      args: [selectedGroup.groupId, address, keyEnvelope],
    });
    if (!succeeded) return;
    storeGroupKey(address, selectedGroup.groupId.toString(), rawKey);
    setGroupKeys((value) => ({ ...value, [selectedGroup.groupId.toString()]: rawKey }));
  };

  const submitPublicMessage = async () => {
    const content = publicMessage.trim();
    if (!content) return;
    const succeeded = await runTx("Public message", {
      functionName: "sendPublicMessage",
      args: [content],
    });
    if (!succeeded) return;
    setPublicMessage("");
  };

  const ensureLocalDmKey = async () => {
    if (!address) {
      toast.warning("Connect wallet", "Connect your wallet first.");
      return null;
    }
    if (typeof crypto === "undefined" || !crypto.subtle) {
      toast.error("Crypto unavailable", "This browser does not support WebCrypto.");
      return null;
    }

    try {
      const stored = await loadStoredDmKeyPair(address);
      if (stored) {
        setLocalDmPublicKey(stored.publicKey);
        return stored;
      }

      const created = await createStoredDmKeyPair(address);
      setLocalDmPublicKey(created.publicKey);
      return created;
    } catch (error) {
      toast.handleError(error, "Could not save encrypted DM keys");
      return null;
    }
  };

  const setupEncryptedDm = async () => {
    const stored = await ensureLocalDmKey();
    if (!stored) return;
    await runTx("Publish DM key", {
      functionName: "sendPublicMessage",
      args: [`${DM_KEY_PREFIX}${stored.publicKey}`],
    });
  };

  const submitGroupMessage = async () => {
    const groupId = BigInt(groupMessage.groupId || "0");
    const content = groupMessage.content.trim();
    if (groupId <= 0n || !content) return;

    if (!address) {
      toast.warning("Connect wallet", "Connect your wallet first.");
      return;
    }
    if (!selectedGroupKey) {
      toast.warning("Group key missing", "This browser cannot encrypt for this room. Ask an admin to add your key again.");
      return;
    }

    let encryptedPayload: `0x${string}`;
    try {
      encryptedPayload = await encryptGroupText({
        text: content,
        groupId: groupId.toString(),
        sender: address,
        rawKey: selectedGroupKey,
      });
    } catch {
      toast.error("Encryption failed", "Could not encrypt this group message.");
      return;
    }

    const succeeded = await runTx("Group message", {
      functionName: "sendGroupMessage",
      args: [groupId, encryptedPayload],
    });
    if (!succeeded) return;
    setGroupMessage({ groupId: groupMessage.groupId, content: "" });
  };

  const addGroupMember = async () => {
    if (!selectedGroup || !isAddress(groupManage.member)) {
      toast.warning("Bad member", "Use a valid wallet address.");
      return;
    }
    if (!address) {
      toast.warning("Connect wallet", "Connect your wallet first.");
      return;
    }
    if (!selectedGroupKey) {
      toast.warning("Group key missing", "Unlock or repair this room key before adding a member.");
      return;
    }
    if (!groupMemberDmPublicKey) {
      toast.warning("Member key missing", "That wallet must open 0x and setup encrypted DM first.");
      return;
    }

    const localKey = await ensureLocalDmKey();
    if (!localKey) return;

    let keyEnvelope: `0x${string}`;
    try {
      keyEnvelope = await encryptGroupKeyEnvelope({
        rawKey: selectedGroupKey,
        groupId: selectedGroup.groupId.toString(),
        from: address,
        to: groupManage.member,
        localKey,
        receiverPublicKey: groupMemberDmPublicKey,
      });
    } catch {
      toast.error("Key encryption failed", "Could not encrypt the room key for that member.");
      return;
    }

    const alreadyMember = Boolean(managedGroupMember);
    const succeeded = await runTx(alreadyMember ? "Share room key" : "Add member", {
      functionName: alreadyMember ? "setGroupKeyEnvelope" : "addGroupMember",
      args: [
        selectedGroup.groupId,
        groupManage.member,
        keyEnvelope,
      ],
    });
    if (!succeeded) return;
    setGroupManage((value) => ({ ...value, member: "" }));
  };

  const setGroupOfficer = async (enabled: boolean) => {
    if (!selectedGroup || !isAddress(groupManage.officer)) {
      toast.warning("Bad officer", "Use a valid wallet address.");
      return;
    }
    const succeeded = await runTx(enabled ? "Set role" : "Remove role", {
      functionName: "setGroupOfficer",
      args: [selectedGroup.groupId, groupManage.officer, enabled, groupManage.rank.trim() || "mod"],
    });
    if (succeeded && !enabled) setGroupManage((value) => ({ ...value, officer: "" }));
  };

  const submitEncryptedMessage = async () => {
    if (!dmResolvedTo) {
      toast.warning("Bad receiver", "Use a valid username or wallet address.");
      return;
    }

    const payload = dmForm.payload.trim();
    if (!payload) return;

    const stored = await loadStoredDmKeyPair(address);
    if (!address || !stored) {
      toast.warning("Setup needed", "Create and publish this wallet's DM key first.");
      return;
    }
    if (!receiverDmPublicKey) {
      toast.warning("Receiver key missing", "The receiver must open 0x and publish an encrypted DM key first.");
      return;
    }

    let encodedPayload: `0x${string}`;
    try {
      encodedPayload = await encryptDmText({
        text: payload,
        from: address,
        to: dmResolvedTo,
        localKey: stored,
        receiverPublicKey: receiverDmPublicKey,
      });
    } catch {
      toast.error("Encryption failed", "Could not encrypt this message. Ask the receiver to republish their DM key.");
      return;
    }

    const succeeded = await runTx("Encrypted DM", {
      functionName: "sendEncryptedMessage",
      args: [dmResolvedTo, encodedPayload],
    });
    if (!succeeded) return;
    setDmForm((value) => ({ ...value, payload: "" }));
  };

  const tabs: Array<{ key: Tab; label: string; meta: string; tone: string }> = [
    { key: "feed", label: "Global posts", meta: mounted ? formatCount(postCount) : "--", tone: "text-white" },
    { key: "channels", label: "Channels", meta: mounted ? formatCount(channelCount) : "--", tone: "text-[var(--pixel-amber)]" },
    { key: "groups", label: "Groups", meta: mounted ? formatCount(groups.length) : "--", tone: "text-[var(--pixel-green)]" },
    { key: "chat", label: "Global chat", meta: mounted ? formatCount(publicMessages.length) : "--", tone: "text-white" },
    { key: "dm", label: "Encrypted DM", meta: mounted ? formatCount(inboxIds.length + sentIds.length) : "--", tone: "text-[var(--pixel-green)]" },
    { key: "profile", label: "Profile", meta: isVerified ? "VERIFIED" : "ID", tone: isVerified ? "text-[var(--pixel-green)]" : "text-white/60" },
  ];

  return (
    <div className="pixel-shell pixel-app-shell zeroxn-social min-h-screen bg-black text-white">
      <header className="zeroxn-topbar zeroxn-app-header sticky top-0 z-30 border-b border-white/10 bg-black px-4 py-4">
        <div className="zeroxn-app-header-inner mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link href="/" className="zeroxn-app-brand flex items-center gap-3">
            <span className="grid h-8 w-8 place-items-center border border-white/15 bg-black text-xs font-bold">0x</span>
            <span className="text-lg font-bold">0x</span>
          </Link>
          <div className="zeroxn-app-actions flex flex-wrap items-center gap-2">
            {canUseSocial ? (
              <button
                type="button"
                className={`zeroxn-alerts-trigger pixel-btn-soft pixel-btn-soft-sm ${
                  tab === "notifications" || unreadNotificationCount > 0
                    ? "pixel-btn-soft-amber"
                    : "pixel-btn-soft-secondary"
                }`}
                onClick={() => setTab("notifications")}
                aria-pressed={tab === "notifications"}
                aria-label={`${unreadNotificationCount} unread notifications`}
              >
                <span>Alerts</span>
                <span className="zeroxn-alert-count" aria-hidden="true">
                  {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                </span>
              </button>
            ) : null}
            {mounted && isConnected ? (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-sm"
                onClick={() => disconnect()}
              >
                {shortAddress(address)}
              </button>
            ) : (
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                onClick={connectWallet}
                disabled={!mounted || isConnecting}
              >
                {isConnecting ? "Connecting" : "Connect"}
              </button>
            )}
          </div>
        </div>
      </header>

      <main className="zeroxn-main mx-auto grid max-w-7xl gap-6 px-4 py-6 sm:py-8">
        {!canUseSocial ? (
          <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <PixelPanel>
              <PanelTitle
                title="Create 0x account"
                right={<span className="text-[10px] uppercase tracking-[0.14em] text-[var(--pixel-amber)]">Required</span>}
              />
              <div className="grid gap-3 p-4">
                {!mounted || !isConnected ? (
                  <div className="border border-white/10 bg-white/[0.02] p-4">
                    <p className="mb-4 text-sm leading-relaxed text-white/62">
                      Connect wallet first. 0x requires one onchain profile before posting, liking, commenting,
                      joining channels, or sending messages.
                    </p>
                    <button
                      type="button"
                      className="pixel-btn-soft pixel-btn-soft-indigo w-full"
                      onClick={connectWallet}
                      disabled={!mounted || isConnecting}
                    >
                      {isConnecting ? "Connecting" : "Connect wallet"}
                    </button>
                  </div>
                ) : null}

                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Username</span>
                  <input
                    value={profileForm.username}
                    onChange={(event) => setProfileForm((value) => ({ ...value, username: normalizeUsername(event.target.value) }))}
                    placeholder="username"
                    className={inputClass()}
                    disabled={!mounted || !isConnected}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Display name</span>
                  <input
                    value={profileForm.displayName}
                    onChange={(event) => setProfileForm((value) => ({ ...value, displayName: event.target.value.slice(0, 48) }))}
                    placeholder="Display name"
                    className={inputClass()}
                    disabled={!mounted || !isConnected}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Bio</span>
                  <textarea
                    value={profileForm.bio}
                    onChange={(event) => setProfileForm((value) => ({ ...value, bio: event.target.value.slice(0, 240) }))}
                    placeholder="Bio"
                    rows={4}
                    className={`${inputClass()} resize-none`}
                    disabled={!mounted || !isConnected}
                  />
                </label>

                <label className="flex items-center justify-between gap-3 border border-white/10 bg-white/[0.02] p-3 text-xs text-white">
                  <span>Use 0xPixel NFT avatar</span>
                  <input
                    type="checkbox"
                    checked={profileForm.avatarEnabled}
                    onChange={(event) => {
                      const enabled = event.target.checked;
                      setProfileForm((value) => ({
                        ...value,
                        avatarEnabled: enabled,
                        avatarTokenId: enabled ? value.avatarTokenId : "",
                      }));
                    }}
                    disabled={!mounted || !isConnected || ownedPixels.length === 0}
                  />
                </label>

                {profileForm.avatarEnabled ? (
                  <PixelNftPicker
                    label="Choose avatar"
                    value={profileForm.avatarTokenId}
                    onChange={(tokenId) => setProfileForm((value) => ({ ...value, avatarTokenId: tokenId }))}
                    ownedPixels={ownedPixels}
                    loading={ownedPixelsLoading}
                  />
                ) : null}

                {ownedPixelsError ? (
                  <p className="border border-[var(--pixel-red)]/45 bg-[rgba(255,154,169,0.08)] p-3 text-xs text-[var(--pixel-red)]">
                    {ownedPixelsError}
                  </p>
                ) : null}

                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-indigo mt-2"
                  disabled={
                    !mounted ||
                    !isConnected ||
                    !profileForm.username ||
                    (profileForm.avatarEnabled && !profileForm.avatarTokenId)
                  }
                  onClick={submitProfile}
                >
                  Create account
                </button>
              </div>
            </PixelPanel>

            <PixelPanel>
              <PanelTitle title="Before entering 0x" />
              <div className="grid gap-4 p-4">
                <div className="border border-[var(--pixel-green)]/35 bg-[rgba(155,231,189,0.06)] p-4">
                  <p className="text-lg font-bold text-white">Account first. Social after.</p>
                  <p className="mt-2 text-sm leading-relaxed text-white/58">
                    Username is unique onchain. NFT avatar is optional. If this wallet owns 0xPixel NFTs,
                    they appear here automatically for avatar and post attachments.
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="border border-white/10 bg-black p-3">
                    <p className="text-[10px] text-white/45">Detected NFTs</p>
                    <p className="mt-2 text-2xl text-[var(--pixel-green)]">{ownedPixelsLoading ? "--" : ownedPixels.length}</p>
                  </div>
                  <div className="border border-white/10 bg-black p-3">
                    <p className="text-[10px] text-white/45">Wallet</p>
                    <p className="mt-2 truncate text-sm text-white">{shortAddress(mounted ? address : undefined)}</p>
                  </div>
                </div>
                <PixelNftPicker
                  label="Detected 0xPixel NFTs"
                  value={profileForm.avatarTokenId}
                  onChange={(tokenId) => setProfileForm((value) => ({ ...value, avatarEnabled: Boolean(tokenId), avatarTokenId: tokenId }))}
                  ownedPixels={ownedPixels}
                  loading={ownedPixelsLoading}
                  compact
                />
              </div>
            </PixelPanel>
          </section>
        ) : (
          <nav ref={tabsRef} className="zeroxn-tabs flex gap-2 overflow-x-auto">
            {tabs.map((item) => (
              <button
                key={item.key}
                type="button"
                className={`pixel-btn-soft flex items-center justify-between ${tab === item.key ? "pixel-btn-soft-indigo" : "pixel-btn-soft-secondary"}`}
                onClick={() => setTab(item.key)}
                aria-current={tab === item.key ? "page" : undefined}
              >
                <span>{item.label}</span>
                <span className={`ml-2 ${item.tone}`}>{item.meta}</span>
              </button>
            ))}
          </nav>
        )}

        {canUseSocial && tab === "feed" ? (
          <section
            className={`zeroxn-feed-layout relative grid items-start gap-6 ${
              composerOpen
                ? "lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_430px]"
                : "lg:grid-cols-1"
            }`}
          >
            {composerOpen ? (
              <aside className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
                <PixelPanel className="zeroxn-composer">
                    <PanelTitle
                      title="Create post"
                      right={
                        <button
                          type="button"
                          className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                          onClick={() => setComposerOpen(false)}
                        >
                          Close
                        </button>
                      }
                    />
                    <div className="grid gap-3 p-4">
                      <div className="flex items-center justify-between gap-3 border border-white/10 bg-black p-3">
                        <ProfileBadge address={address} dense />
                        <span className="text-[10px] uppercase tracking-[0.16em] text-[var(--pixel-green)]">
                          Global
                        </span>
                      </div>
                      <textarea
                        value={postContent}
                        onChange={(event) => setPostContent(event.target.value)}
                        maxLength={720}
                        rows={6}
                        placeholder="Post to the global 0x feed"
                        className={`${inputClass()} resize-none leading-relaxed`}
                      />
                      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.14em] text-white/42">
                        <span>Onchain post</span>
                        <span>{postContent.length}/720</span>
                      </div>
                      <PixelNftPicker
                        label="Attach 0xPixel NFT"
                        value={postPixelToken}
                        onChange={setPostPixelToken}
                        ownedPixels={ownedPixels}
                        loading={ownedPixelsLoading}
                        compact
                        collapsible
                      />
                      <button
                        type="button"
                        className="pixel-btn-soft pixel-btn-soft-indigo"
                        disabled={!hasProfile || !postContent.trim()}
                        onClick={submitPost}
                      >
                        Post
                      </button>
                    </div>
                </PixelPanel>
              </aside>
            ) : null}

            <div className="zeroxn-feed-column order-2 flex min-w-0 flex-col items-start gap-4 lg:order-1">
              <div className="zeroxn-feed-toolbar flex w-full items-center justify-between gap-3">
                <div className="zeroxn-feed-filter flex w-fit items-center gap-1 border border-white/10 bg-black p-1 shadow-[3px_3px_0_#000]">
                  {([
                    ["newest", "Newest"],
                    ["following", "Following"],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`pixel-btn-soft pixel-btn-soft-sm ${feedMode === mode ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"}`}
                      onClick={() => setFeedMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="zeroxn-compose-toggle zeroxn-feed-compose-button"
                  onClick={() => setComposerOpen(true)}
                  aria-label="Create post"
                  title="Create post"
                >
                  <span className="zeroxn-compose-plus">+</span>
                </button>
              </div>
              {feedPosts.length > 0 ? (
                <div className="grid w-full gap-4">
                  {feedPosts.map(({ postId, post }) => (
                    <PostCard
                      key={postId.toString()}
                      postId={postId}
                      post={post}
                      viewer={address}
                      runTx={runTx}
                      ownedPixels={ownedPixels}
                      ownedPixelsLoading={ownedPixelsLoading}
                    />
                  ))}
                </div>
              ) : (
                <div className="zeroxn-empty zeroxn-feed-empty w-full border border-white/12 bg-black p-8 text-sm text-white/58">
                  <p className="text-lg font-bold text-white">
                    {feedMode === "following" ? "No following posts yet" : "No posts yet"}
                  </p>
                  <p className="mt-2 max-w-md leading-7">
                    {feedMode === "following"
                      ? "Follow accounts to build this feed."
                      : "Write the first global 0x post from the composer."}
                  </p>
                </div>
              )}
            </div>
          </section>
        ) : null}

        {canUseSocial && tab === "notifications" ? (
          <section className="zeroxn-notifications mx-auto grid w-full gap-4" aria-live="polite">
            <div className="zeroxn-section-head flex flex-wrap items-center justify-between gap-3 border-b border-white/12 pb-3">
              <div>
                <h2 className="text-xl font-bold text-white">Notifications</h2>
                <p className="mt-1 text-xs text-white/48">
                  Showing {formatCount(visibleNotifications.length)} of {formatCount(notifications.length)}
                </p>
              </div>
              <button
                type="button"
                className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                onClick={() => void refetchNotifications()}
                disabled={notificationsFetching}
              >
                {notificationsFetching ? "Refreshing" : "Refresh"}
              </button>
            </div>

            {notificationsLoading ? (
              <div className="grid gap-2" aria-label="Loading notifications">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="zeroxn-notification-skeleton h-20 border border-white/10 bg-white/[0.025]" />
                ))}
              </div>
            ) : notificationsError ? (
              <div className="zeroxn-empty border border-[var(--pixel-red)]/45 bg-black p-5 text-sm text-white/65">
                <p className="font-bold text-[var(--pixel-red)]">Notifications unavailable</p>
                <p className="mt-2">{notificationsError instanceof Error ? notificationsError.message : "Try again shortly."}</p>
              </div>
            ) : notifications.length > 0 ? (
              <div className="grid gap-4">
                <div className="zeroxn-notification-list border-t border-white/10">
                  {visibleNotifications.map((notification) => {
                    const action = notification.kind === "like"
                      ? "liked your post"
                      : notification.kind === "comment"
                        ? "commented on your post"
                        : "followed you";
                    return (
                      <article key={notification.id} className="zeroxn-notification-row grid gap-3 border-b border-white/10 py-4 sm:grid-cols-[7rem_minmax(0,1fr)_auto] sm:items-center">
                        <span className={`zeroxn-notification-kind is-${notification.kind}`}>
                          {notification.kind}
                        </span>
                        <div className="grid min-w-0 gap-2">
                          <ProfileBadge address={notification.actor} dense />
                          <p className="text-xs text-white/68">{action}</p>
                        </div>
                        <div className="flex items-center justify-between gap-3 sm:grid sm:justify-items-end">
                          <span className="text-[10px] text-white/38">{formatDate(notification.timestamp)}</span>
                          {notification.postId ? (
                            <Link
                              href={`/0x/p/${notification.postId}`}
                              className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                            >
                              Open post #{notification.postId}
                            </Link>
                          ) : null}
                        </div>
                      </article>
                    );
                  })}
                </div>
                {visibleNotificationCount < notifications.length ? (
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-secondary justify-self-center"
                    onClick={() => setVisibleNotificationCount((count) => count + NOTIFICATION_PAGE_SIZE)}
                  >
                    Load more notifications
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="zeroxn-empty border border-white/12 bg-black p-8 text-sm text-white/58">
                <p className="text-lg font-bold text-white">No notifications yet</p>
                <p className="mt-2">Likes, comments, and new followers will appear here.</p>
              </div>
            )}
          </section>
        ) : null}

        {canUseSocial && tab === "profile" ? (
          <>
            <section className="zeroxn-profile-posts mx-auto grid w-full gap-4">
              <div className="zeroxn-section-head flex flex-wrap items-center justify-between gap-3 border-b border-white/12 pb-3">
                <div>
                  <h2 className="text-xl font-bold text-white">My posts</h2>
                  <p className="mt-1 text-xs text-white/48">
                    Showing {formatCount(profilePosts.length)} of {formatCount(profilePostIds.length)}
                  </p>
                </div>
                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-indigo pixel-btn-soft-sm"
                  onClick={() => {
                    setTab("feed");
                    setComposerOpen(true);
                  }}
                >
                  Create post
                </button>
              </div>

              {profilePostsLoading ? (
                <div className="grid gap-3" aria-label="Loading your posts">
                  {Array.from({ length: 3 }, (_, index) => (
                    <div key={index} className="zeroxn-profile-post-skeleton h-40 border border-white/10 bg-white/[0.025]" />
                  ))}
                </div>
              ) : profilePostsError ? (
                <div className="zeroxn-empty border border-[var(--pixel-red)]/45 bg-black p-5 text-sm text-white/65">
                  <p className="font-bold text-[var(--pixel-red)]">Could not load your posts</p>
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm mt-3"
                    onClick={() => {
                      void refetchPostCount();
                      void refetchProfilePostIds();
                      void refetchProfilePostData();
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : profilePosts.length > 0 ? (
                <div className="grid gap-4">
                  {profilePosts.map(({ postId, post }) => (
                    <PostCard
                      key={postId.toString()}
                      postId={postId}
                      post={post}
                      viewer={address}
                      runTx={runTx}
                      ownedPixels={ownedPixels}
                      ownedPixelsLoading={ownedPixelsLoading}
                    />
                  ))}
                </div>
              ) : (
                <div className="zeroxn-empty border border-white/12 bg-black p-8 text-sm text-white/58">
                  <p className="text-lg font-bold text-white">No posts yet</p>
                  <p className="mt-2">Your global and channel posts will appear here.</p>
                </div>
              )}

              {visibleProfilePostCount < profilePostIds.length ? (
                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-secondary justify-self-center"
                  onClick={() => setVisibleProfilePostCount((count) => count + PROFILE_POST_PAGE_SIZE)}
                >
                  Load more posts
                </button>
              ) : null}
            </section>

          <section className="zeroxn-profile-summary grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <PixelPanel>
              <PanelTitle title="Your profile" />
              <div className="grid gap-3 p-4">
                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Username</span>
                  <input
                    value={profileForm.username}
                    onChange={(event) => setProfileForm((value) => ({ ...value, username: normalizeUsername(event.target.value) }))}
                    placeholder="username"
                    className={inputClass()}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Display name</span>
                  <input
                    value={profileForm.displayName}
                    onChange={(event) => setProfileForm((value) => ({ ...value, displayName: event.target.value.slice(0, 48) }))}
                    placeholder="Display name"
                    className={inputClass()}
                  />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Bio</span>
                  <textarea
                    value={profileForm.bio}
                    onChange={(event) => setProfileForm((value) => ({ ...value, bio: event.target.value.slice(0, 240) }))}
                    placeholder="Bio"
                    rows={5}
                    className={`${inputClass()} resize-none`}
                  />
                </label>
                <div className="grid gap-2 border border-white/10 bg-white/[0.02] p-3">
                  <label className="flex items-center justify-between gap-3 text-xs text-white">
                    <span>Use 0xPixel NFT avatar</span>
                    <input
                      type="checkbox"
                      checked={profileForm.avatarEnabled}
                      onChange={(event) => {
                        const enabled = event.target.checked;
                        setProfileForm((value) => ({
                          ...value,
                          avatarEnabled: enabled,
                          avatarTokenId: enabled ? value.avatarTokenId : "",
                        }));
                      }}
                      disabled={ownedPixels.length === 0}
                    />
                  </label>
                  {profileForm.avatarEnabled ? (
                    <PixelNftPicker
                      label="Choose avatar"
                      value={profileForm.avatarTokenId}
                      onChange={(tokenId) => setProfileForm((value) => ({ ...value, avatarTokenId: tokenId }))}
                      ownedPixels={ownedPixels}
                      loading={ownedPixelsLoading}
                      compact
                    />
                  ) : (
                    <p className="border border-white/8 bg-black p-3 text-xs text-white/42">
                      Avatar is optional. Only detected 0xPixel NFTs from this wallet can be selected.
                    </p>
                  )}
                  <input
                    value={profileForm.avatarTokenId}
                    onChange={(event) => setProfileForm((value) => ({ ...value, avatarTokenId: event.target.value.replace(/[^\d]/g, "") }))}
                    placeholder="0xPixel tokenId"
                    className="hidden"
                    disabled
                  />
                </div>
                <button
                  type="button"
                  className="pixel-btn-soft pixel-btn-soft-indigo"
                  disabled={!mounted || !isConnected || (profileForm.avatarEnabled && !profileForm.avatarTokenId)}
                  onClick={submitProfile}
                >
                  Update profile
                </button>
                {hasProfile ? (
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-secondary"
                    onClick={changeUsername}
                    disabled={profileForm.username === profile?.[0]}
                  >
                    Change username
                  </button>
                ) : null}
              </div>
            </PixelPanel>

            <PixelPanel>
              <PanelTitle title="Identity" right={isVerified ? <span className="text-[var(--pixel-green)]">VERIFIED</span> : null} />
              <div className="grid gap-4 p-4">
                <ProfileBadge address={address} />
                <div className="grid grid-cols-3 gap-2">
                  <div className="border border-white/10 p-3">
                    <p className="text-[10px] text-white/45">Followers</p>
                    <p className="mt-2 text-xl text-[var(--pixel-green)]">{formatCount(followers)}</p>
                  </div>
                  <div className="border border-white/10 p-3">
                    <p className="text-[10px] text-white/45">Following</p>
                    <p className="mt-2 text-xl text-white">{formatCount(following)}</p>
                  </div>
                  <div className="border border-white/10 p-3">
                    <p className="text-[10px] text-white/45">Best likes</p>
                    <p className="mt-2 text-xl text-[var(--pixel-amber)]">{formatCount(maxLikes)}</p>
                  </div>
                </div>
                <p className="text-xs leading-relaxed text-white/55">
                  Auto verification requires one post with 10,000 likes, 1,000 followers, and 1,000 NUSD held.
                  Admin can verify a profile manually.
                </p>
              </div>
            </PixelPanel>
          </section>
          </>
        ) : null}

        {canUseSocial && tab === "channels" ? (
          <section className="zeroxn-channels-layout grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <PixelPanel className="zeroxn-channels-panel">
              <PanelTitle
                title="Channels"
                right={<span className="text-[10px] uppercase tracking-[0.14em] text-[var(--pixel-amber)]">{formatCount(channelCount)} total</span>}
              />
              <div className="zeroxn-channels-workspace">
                <div className="zeroxn-channel-directory">
                  {channels.length > 0 ? (
                    <>
                      <label className="block">
                        <span className="sr-only">Search channels</span>
                        <input
                          type="search"
                          value={channelSearch}
                          onChange={(event) => setChannelSearch(event.target.value.slice(0, 64))}
                          placeholder="Search channels"
                          className={inputClass("zeroxn-channel-search-input")}
                        />
                      </label>

                      {filteredChannels.length > 0 ? (
                        <nav className="zeroxn-channel-list" aria-label="Channels">
                          {filteredChannels.map(({ channelId, channel }) => {
                            const active = channelTarget === channelId.toString();
                            return (
                              <button
                                key={channelId.toString()}
                                type="button"
                                className={`zeroxn-group-room-card zeroxn-channel-room-card border text-left active:translate-y-px ${active ? "is-active" : ""}`}
                                onClick={() => setChannelTarget(channelId.toString())}
                                aria-pressed={active}
                                aria-controls="zeroxn-channel-feed"
                              >
                                <span className="zeroxn-channel-room-top">
                                  <span className="min-w-0">
                                    <span className="zeroxn-channel-slug">/{channel[1]}</span>
                                    <span className="zeroxn-channel-name">{channel[2] || channel[1]}</span>
                                  </span>
                                  <span className={`zeroxn-room-state ${active ? "is-active" : ""}`}>
                                    {active ? "ACTIVE" : "OPEN"}
                                  </span>
                                </span>
                                <span className="zeroxn-channel-room-meta">
                                  <span>#{channelId.toString()}</span>
                                  <span>{formatCount(channel[5])} members</span>
                                </span>
                                {channel[3] ? (
                                  <span className="zeroxn-channel-description">{channel[3]}</span>
                                ) : null}
                                <span className="zeroxn-channel-creator">
                                  Creator {shortAddress(channel[0])} <span aria-hidden="true">/</span> {formatDate(channel[4])}
                                </span>
                              </button>
                            );
                          })}
                        </nav>
                      ) : (
                        <div className="zeroxn-channel-empty border border-white/12 bg-black p-4 text-sm text-white/50">
                          No channels match this search.
                        </div>
                      )}
                    </>
                  ) : channelsLoading ? (
                    <div className="zeroxn-channel-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      Loading channels...
                    </div>
                  ) : (
                    <div className="zeroxn-empty border border-white/12 bg-black p-6 text-sm text-white/58">
                      <p className="text-lg font-bold text-white">No channels yet</p>
                      <p className="mt-2 leading-7">Create the first public topic on 0x.</p>
                    </div>
                  )}
                </div>

                <div
                  id="zeroxn-channel-feed"
                  className="zeroxn-group-stream zeroxn-channel-feed"
                  role="region"
                  aria-label={selectedChannel ? `${selectedChannel.channel[2] || selectedChannel.channel[1]} channel feed` : "Channel feed"}
                >
                  <div className="zeroxn-channel-feed-head mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-white/42">Channel feed</p>
                      <h3 className="mt-1 text-xl font-bold text-white">
                        {selectedChannel ? `/${selectedChannel.channel[1]}` : "Choose a channel"}
                      </h3>
                    </div>
                    {selectedChannel ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {selectedChannelMemberPending ? (
                          <span className="zeroxn-channel-access-state">Checking</span>
                        ) : !selectedChannelMember ? (
                          <button
                            type="button"
                            className="pixel-btn-soft pixel-btn-soft-emerald pixel-btn-soft-sm"
                            onClick={joinSelectedChannel}
                          >
                            Join
                          </button>
                        ) : (
                          <span className="border border-[var(--pixel-green)]/45 bg-[rgba(0,255,138,0.08)] px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-[var(--pixel-green)]">
                            Joined
                          </span>
                        )}
                        <button
                          type="button"
                          className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                          onClick={() => {
                            void refetchSelectedChannelPosts();
                            void refetchSelectedChannelPostData();
                            void refetchSelectedChannelMember();
                          }}
                        >
                          Refresh
                        </button>
                      </div>
                    ) : null}
                  </div>

                  {!selectedChannel ? (
                    <div className="zeroxn-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      Select a channel above to view its posts.
                    </div>
                  ) : selectedChannelPostsLoading ? (
                    <div className="zeroxn-channel-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      Loading channel posts...
                    </div>
                  ) : selectedChannelPosts.length > 0 ? (
                    <div className="grid gap-4">
                      {selectedChannelPosts.map(({ postId, post }) => (
                        <PostCard
                          key={postId.toString()}
                          postId={postId}
                          post={post}
                          viewer={address}
                          runTx={runTx}
                          ownedPixels={ownedPixels}
                          ownedPixelsLoading={ownedPixelsLoading}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="zeroxn-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      No posts in this channel yet.
                    </div>
                  )}
                </div>
              </div>
            </PixelPanel>

            <aside className="zeroxn-channel-tools grid gap-6 xl:sticky xl:top-24 xl:self-start">
              <PixelPanel>
                <PanelTitle
                  title="Post to channel"
                  right={selectedChannel ? <span className="text-[10px] text-[var(--pixel-green)]">/{selectedChannel.channel[1]}</span> : null}
                />
                <div className="grid gap-3 p-4">
                  <label className="grid gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Selected channel</span>
                    {channels.length > 0 ? (
                      <select
                        value={channelTarget}
                        onChange={(event) => setChannelTarget(event.target.value)}
                        className={inputClass()}
                      >
                        <option value="">Choose channel</option>
                        {channels.map(({ channelId, channel }) => (
                          <option key={channelId.toString()} value={channelId.toString()}>
                            #{channelId.toString()} · {channel[2] || channel[1]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value="" placeholder="Create a channel first" className={inputClass()} disabled />
                    )}
                  </label>

                  {!selectedChannel ? (
                    <div className="zeroxn-channel-empty border border-white/12 bg-black p-4 text-sm text-white/50">
                      Choose a channel to post.
                    </div>
                  ) : selectedChannelMemberPending ? (
                    <div className="zeroxn-channel-empty border border-white/12 bg-black p-4 text-sm text-white/50">
                      Checking channel access...
                    </div>
                  ) : !selectedChannelMember ? (
                    <div className="zeroxn-channel-join-prompt">
                      <p className="text-sm leading-6 text-white/65">Join /{selectedChannel.channel[1]} to publish in this channel.</p>
                      <button
                        type="button"
                        className="pixel-btn-soft pixel-btn-soft-emerald"
                        onClick={joinSelectedChannel}
                      >
                        Join channel
                      </button>
                    </div>
                  ) : (
                    <>
                      <textarea
                        value={channelPostContent}
                        onChange={(event) => setChannelPostContent(event.target.value.slice(0, 720))}
                        placeholder={`Post to /${selectedChannel.channel[1]}`}
                        rows={4}
                        className={`${inputClass()} resize-none`}
                      />
                      <PixelNftPicker
                        label="Attach 0xPixel NFT"
                        value={channelPostPixelToken}
                        onChange={setChannelPostPixelToken}
                        ownedPixels={ownedPixels}
                        loading={ownedPixelsLoading}
                        compact
                        collapsible
                      />
                      <button
                        type="button"
                        className="pixel-btn-soft pixel-btn-soft-indigo"
                        disabled={!hasProfile || !channelPostContent.trim()}
                        onClick={submitChannelPost}
                      >
                        Post to channel
                      </button>
                    </>
                  )}
                </div>
              </PixelPanel>

              <PixelPanel className="zeroxn-channel-create-panel">
                <PanelTitle
                  title="Create channel"
                  right={(
                    <button
                      type="button"
                      className="zeroxn-channel-create-toggle"
                      onClick={() => setChannelCreateOpen((open) => !open)}
                      aria-expanded={channelCreateOpen}
                      aria-label={channelCreateOpen ? "Close create channel form" : "Open create channel form"}
                      title={channelCreateOpen ? "Close create channel form" : "Open create channel form"}
                    >
                      {channelCreateOpen ? "-" : "+"}
                    </button>
                  )}
                />
                {channelCreateOpen ? (
                  <div className="grid gap-3 p-4">
                    <label className="grid gap-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Slug</span>
                      <input
                        value={channelForm.slug}
                        onChange={(event) => setChannelForm((value) => ({ ...value, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32) }))}
                        placeholder="art-market"
                        className={inputClass()}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Name</span>
                      <input
                        value={channelForm.name}
                        onChange={(event) => setChannelForm((value) => ({ ...value, name: event.target.value.slice(0, 48) }))}
                        placeholder="Art Market"
                        className={inputClass()}
                      />
                    </label>
                    <label className="grid gap-1">
                      <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Description</span>
                      <textarea
                        value={channelForm.description}
                        onChange={(event) => setChannelForm((value) => ({ ...value, description: event.target.value.slice(0, 240) }))}
                        placeholder="What is this channel about?"
                        rows={3}
                        className={`${inputClass()} resize-none`}
                      />
                    </label>
                    <button
                      type="button"
                      className="pixel-btn-soft pixel-btn-soft-amber"
                      disabled={!hasProfile || !channelForm.slug.trim() || !channelForm.name.trim()}
                      onClick={submitChannel}
                    >
                      Create channel
                    </button>
                  </div>
                ) : null}
              </PixelPanel>
            </aside>
          </section>
        ) : null}

        {canUseSocial && tab === "groups" ? (
          <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
            <PixelPanel>
              <PanelTitle
                title="Groups"
                right={<span className="text-[10px] uppercase tracking-[0.14em] text-[var(--pixel-green)]">{formatCount(groups.length)} joined</span>}
              />
              <div className="grid gap-4 p-4">
                {groupMembershipLoading ? (
                  <div className="zeroxn-empty border border-white/12 bg-black p-6 text-sm text-white/58">
                    <p className="text-lg font-bold text-white">Loading your groups</p>
                    <p className="mt-2 leading-7">Checking room membership for this wallet.</p>
                  </div>
                ) : groups.length > 0 ? (
                  <div className="zeroxn-group-room-grid grid gap-2 sm:grid-cols-2">
                    {groups.map(({ groupId, group }) => {
                      const active = groupMessage.groupId === groupId.toString();
                      return (
                        <button
                          key={groupId.toString()}
                          type="button"
                          className={`zeroxn-group-room-card border p-3 text-left transition-transform active:translate-y-px ${
                            active
                              ? "is-active border-[var(--pixel-green)] bg-[rgba(0,255,138,0.07)] shadow-[4px_4px_0_#082d20]"
                              : "border-white/12 bg-black hover:border-white/30"
                          }`}
                          onClick={() => setGroupMessage((value) => ({ ...value, groupId: groupId.toString() }))}
                        >
                          <span className="flex flex-wrap items-start justify-between gap-3">
                            <span>
                              <span className="block text-base font-bold text-white">
                                #{groupId.toString()} · {group[1]}
                              </span>
                              <span className="mt-1 block text-xs text-[var(--pixel-green)]">
                                {formatCount(group[5])} messages · {formatCount(group[4])} members
                              </span>
                            </span>
                            <span className={`zeroxn-room-state ${active ? "text-[var(--pixel-green)]" : "text-white/38"}`}>
                              {active ? "ON" : "OPEN"}
                            </span>
                          </span>
                          {group[2] ? (
                            <span className="mt-2 block truncate text-xs leading-5 text-white/58">{group[2]}</span>
                          ) : null}
                          <span className="mt-2 block text-[10px] uppercase tracking-[0.14em] text-white/35">
                            Creator {shortAddress(group[0])} · {formatDate(group[3])}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="zeroxn-empty border border-white/12 bg-black p-6 text-sm text-white/58">
                    <p className="text-lg font-bold text-white">No joined groups</p>
                    <p className="mt-2 leading-7">Create a private room or ask a room admin to add this wallet.</p>
                  </div>
                )}

                <div className="zeroxn-group-stream border-t border-white/10 pt-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-[var(--pixel-green)]">Room stream</p>
                      <h3 className="mt-1 text-2xl font-bold text-white">
                        {selectedGroup ? selectedGroup.group[1] : "Choose a group"}
                      </h3>
                      {selectedGroup ? (
                        <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-white/38">
                          #{selectedGroup.groupId.toString()} / {formatCount(selectedGroup.group[5])} messages / {formatCount(selectedGroup.group[4])} members / {selectedGroupKey ? "key ready" : "locked"}
                        </p>
                      ) : null}
                    </div>
                    {selectedGroup ? (
                      <button
                        type="button"
                        className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                        onClick={() => {
                          void refetchSelectedGroupMessages();
                          void refetchSelectedGroupMessageData();
                        }}
                      >
                        Refresh
                      </button>
                    ) : null}
                  </div>

                  {!selectedGroup ? (
                    <div className="zeroxn-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      Select a group above to view messages.
                    </div>
                  ) : !selectedGroupMember ? (
                    <div className="zeroxn-empty border border-[var(--pixel-red)]/45 bg-[rgba(255,76,111,0.08)] p-5 text-sm text-white/70">
                      This is a private member room. Ask a room admin to add this wallet.
                    </div>
                  ) : selectedGroupMessages.length > 0 ? (
                    <div className="zeroxn-group-message-list grid gap-2">
                      {selectedGroupMessages.map(({ messageId, message }) => (
                        <div key={messageId.toString()} className="zeroxn-group-message border border-white/10 bg-black p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <ProfileBadge address={message[0]} dense />
                              <GroupRoleBadge groupId={message[2]} address={message[0]} creator={selectedGroup.group[0]} />
                            </div>
                            <span className="text-[10px] text-white/35">#{messageId.toString()} · {formatDate(message[5])}</span>
                          </div>
                          <p className={`whitespace-pre-wrap break-words text-sm leading-6 ${groupDecryptions[messageId.toString()]?.ok === false ? "text-[var(--pixel-amber)]" : "text-white/82"}`}>
                            {groupDecryptions[messageId.toString()]?.text || "Encrypted payload"}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="zeroxn-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                      No messages in this group yet.
                    </div>
                  )}
                </div>
              </div>
            </PixelPanel>

            <aside className="grid gap-6 xl:sticky xl:top-24 xl:self-start">
              <PixelPanel className={`zeroxn-composer ${groupComposerOpen ? "" : "zeroxn-composer-collapsed"}`}>
                {groupComposerOpen ? (
                  <>
                    <PanelTitle
                      title="New room"
                      right={
                        <button
                          type="button"
                          className="pixel-btn-soft pixel-btn-soft-secondary pixel-btn-soft-sm"
                          onClick={() => setGroupComposerOpen(false)}
                        >
                          Close
                        </button>
                      }
                    />
                    <div className="grid gap-3 p-4">
                      <label className="grid gap-1">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Name</span>
                        <input
                          value={groupForm.name}
                          onChange={(event) => setGroupForm((value) => ({ ...value, name: event.target.value.slice(0, 48) }))}
                          placeholder="builders"
                          className={inputClass()}
                        />
                      </label>
                      <label className="grid gap-1">
                        <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Description</span>
                        <textarea
                          value={groupForm.description}
                          onChange={(event) => setGroupForm((value) => ({ ...value, description: event.target.value.slice(0, 240) }))}
                          placeholder="What is this room for?"
                          rows={3}
                          className={`${inputClass()} resize-none`}
                        />
                      </label>
                      <button
                        type="button"
                        className="pixel-btn-soft pixel-btn-soft-emerald"
                        disabled={!hasProfile || !groupForm.name.trim()}
                        onClick={submitGroup}
                      >
                        Create room
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="zeroxn-compose-toggle"
                    onClick={() => setGroupComposerOpen(true)}
                    aria-label="Create room"
                    title="Create room"
                  >
                    <span className="zeroxn-compose-plus">+</span>
                  </button>
                )}
              </PixelPanel>

              <PixelPanel>
                <PanelTitle
                  title="Message room"
                  right={selectedGroup ? <span className="text-[10px] text-[var(--pixel-green)]">#{selectedGroup.groupId.toString()}</span> : null}
                />
                <div className="grid gap-3 p-4">
                  <label className="grid gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Room</span>
                    {groups.length > 0 ? (
                      <select
                        value={groupMessage.groupId}
                        onChange={(event) => setGroupMessage((value) => ({ ...value, groupId: event.target.value }))}
                        className={inputClass()}
                      >
                        <option value="">Choose room</option>
                        {groups.map(({ groupId, group }) => (
                          <option key={groupId.toString()} value={groupId.toString()}>
                            #{groupId.toString()} · {group[1]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input value="" placeholder="Create a room first" className={inputClass()} disabled />
                    )}
                  </label>
                  <textarea
                    value={groupMessage.content}
                    onChange={(event) => setGroupMessage((value) => ({ ...value, content: event.target.value.slice(0, 720) }))}
                    placeholder={selectedGroup ? (selectedGroupMember ? (selectedGroupKey ? `Encrypted message ${selectedGroup.group[1]}` : "Unlock or repair this room key first") : "Only members can message this room") : "Choose a room first"}
                    rows={5}
                    className={`${inputClass()} resize-none`}
                    disabled={!selectedGroup || !selectedGroupMember || !selectedGroupKey}
                  />
                  {selectedGroup && selectedGroupMember ? (
                    <div className={`border p-3 text-xs leading-6 ${selectedGroupKey ? "border-[var(--pixel-green)]/45 bg-[rgba(0,255,138,0.06)] text-[var(--pixel-green)]" : "border-[var(--pixel-amber)]/45 bg-[rgba(255,226,92,0.06)] text-[var(--pixel-amber)]"}`}>
                      {selectedGroupKey
                        ? "Group encryption ready. New messages are AES-GCM ciphertext onchain."
                        : "No group key in this browser. Ask an admin to add your key, or repair it if you are an admin."}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-indigo"
                    disabled={!hasProfile || !groupMessage.groupId || !selectedGroupMember || !selectedGroupKey || !groupMessage.content.trim()}
                    onClick={submitGroupMessage}
                  >
                    Send encrypted
                  </button>
                </div>
              </PixelPanel>

              <PixelPanel>
                <PanelTitle
                  title="Manage room"
                  right={selectedGroup ? <span className="text-[10px] text-white/45">Members</span> : null}
                />
                <div className="grid gap-3 p-4">
                  <p className="text-xs leading-6 text-white/48">
                    Admin can add members and share the encrypted room key. Owner can give members a custom room role.
                  </p>
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-amber"
                    disabled={!selectedGroup || !selectedGroupAdmin}
                    onClick={repairSelectedGroupKey}
                  >
                    {selectedGroupKey ? "Repair my key" : "Create my key"}
                  </button>
                  <label className="grid gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Add member wallet</span>
                    <input
                      value={groupManage.member}
                      onChange={(event) => setGroupManage((value) => ({ ...value, member: event.target.value.trim() }))}
                      placeholder="0x..."
                      className={inputClass()}
                      disabled={!selectedGroup}
                    />
                  </label>
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-emerald"
                    disabled={!selectedGroup || !selectedGroupKey || !isAddress(groupManage.member) || !groupMemberDmPublicKey || (Boolean(managedGroupMember) && !selectedGroupAdmin)}
                    onClick={addGroupMember}
                  >
                    {managedGroupMember ? "Share key" : "Add member"}
                  </button>
                  {groupManage.member && isAddress(groupManage.member) && !groupMemberDmPublicKey ? (
                    <p className="border border-[var(--pixel-amber)]/45 bg-[rgba(255,226,92,0.06)] p-3 text-xs leading-6 text-[var(--pixel-amber)]">
                      This wallet has not published a DM key yet. They must setup encrypted DM before joining encrypted groups.
                    </p>
                  ) : null}

                  <div className="mt-2 border-t border-white/10 pt-3" />

                  <label className="grid gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Role wallet</span>
                    <input
                      value={groupManage.officer}
                      onChange={(event) => setGroupManage((value) => ({ ...value, officer: event.target.value.trim() }))}
                      placeholder="0x..."
                      className={inputClass()}
                      disabled={!selectedGroup}
                    />
                  </label>
                  <label className="grid gap-1">
                    <span className="text-[10px] uppercase tracking-[0.16em] text-white/48">Role name</span>
                    <input
                      value={groupManage.rank}
                      onChange={(event) => setGroupManage((value) => ({ ...value, rank: event.target.value.slice(0, 32) }))}
                      placeholder="mod"
                      className={inputClass()}
                      disabled={!selectedGroup}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      className="pixel-btn-soft pixel-btn-soft-amber"
                      disabled={!selectedGroup || !isAddress(groupManage.officer) || !groupManage.rank.trim()}
                      onClick={() => setGroupOfficer(true)}
                    >
                      Set role
                    </button>
                    <button
                      type="button"
                      className="pixel-btn-soft pixel-btn-soft-secondary"
                      disabled={!selectedGroup || !isAddress(groupManage.officer)}
                      onClick={() => setGroupOfficer(false)}
                    >
                      Remove role
                    </button>
                  </div>
                </div>
              </PixelPanel>
            </aside>
          </section>
        ) : null}

        {canUseSocial && tab === "chat" ? (
          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <PixelPanel>
              <PanelTitle title="Global chat" right={<span className="text-[10px] text-white/45">Public</span>} />
              <div className="grid gap-3 p-4">
                <textarea
                  value={publicMessage}
                  onChange={(event) => setPublicMessage(event.target.value.slice(0, 720))}
                  placeholder="Send a public onchain chat message"
                  rows={5}
                  className={`${inputClass()} resize-none`}
                />
                <button type="button" className="pixel-btn-soft pixel-btn-soft-indigo" disabled={!hasProfile || !publicMessage.trim()} onClick={submitPublicMessage}>
                  Send global chat
                </button>
              </div>
            </PixelPanel>

            <PixelPanel>
              <PanelTitle title="Global stream" right={<span className="text-[10px] text-white/45">Realtime</span>} />
              <div className="grid gap-3 p-4">
                {publicMessages.length > 0 ? (
                  publicMessages.map(({ messageId, message }) => (
                    <div key={messageId.toString()} className="border border-white/10 bg-black p-3">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <ProfileBadge address={message[0]} dense />
                        <span className="text-[10px] text-white/35">#{messageId.toString()} · {formatDate(message[5])}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-white/76">{message[3]}</p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-white/42">No global chat messages yet.</p>
                )}
              </div>
            </PixelPanel>
          </section>
        ) : null}

        {canUseSocial && tab === "dm" ? (
          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="grid gap-6 xl:sticky xl:top-24 xl:self-start">
              <PixelPanel>
                <PanelTitle
                  title="Encrypted DM setup"
                  right={<span className={isOwnDmKeyPublished ? "text-[var(--pixel-green)]" : "text-[var(--pixel-amber)]"}>
                    {isOwnDmKeyPublished ? "READY" : localDmPublicKey ? "LOCAL KEY" : "NEEDED"}
                  </span>}
                />
                <div className="grid gap-3 p-4">
                  <p className="border border-[var(--pixel-green)]/35 bg-[rgba(0,255,138,0.06)] p-3 text-[11px] leading-relaxed text-white/62">
                    Encrypted DM uses an app key stored in this browser. Publish your public key once, then other wallets can encrypt messages to you.
                  </p>
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-emerald"
                    disabled={!hasProfile}
                    onClick={setupEncryptedDm}
                  >
                    {localDmPublicKey ? "Republish DM key" : "Setup encrypted DM"}
                  </button>
                  {localDmPublicKey ? (
                    <p className="break-all border border-white/10 bg-black p-3 text-[10px] leading-relaxed text-white/42">
                      Local public key: {localDmPublicKey.slice(0, 42)}...
                    </p>
                  ) : null}
                </div>
              </PixelPanel>

              <PixelPanel>
                <PanelTitle title="Send encrypted DM" right={<span className="text-[10px] text-white/45">@username or wallet</span>} />
                <div className="grid gap-3 p-4">
                  <input
                    value={dmForm.to}
                    onChange={(event) => setDmForm((value) => ({ ...value, to: event.target.value }))}
                    placeholder="@username or receiver wallet"
                    className={inputClass()}
                  />
                  <textarea
                    value={dmForm.payload}
                    onChange={(event) => setDmForm((value) => ({ ...value, payload: event.target.value }))}
                    placeholder="Message encrypted before it goes onchain"
                    rows={5}
                    className={`${inputClass()} resize-none`}
                  />
                  <p className={`border p-3 text-[11px] leading-relaxed ${
                    receiverDmPublicKey
                      ? "border-[var(--pixel-green)]/35 bg-[rgba(0,255,138,0.06)] text-white/70"
                      : dmReceiverUsername && !dmResolvedTo
                      ? "border-[var(--pixel-red)]/45 bg-[rgba(255,83,112,0.08)] text-white/66"
                      : "border-[var(--pixel-amber)]/35 bg-[rgba(255,226,92,0.06)] text-white/60"
                  }`}>
                    {receiverDmPublicKey
                      ? `Receiver key found${dmReceiverUsername ? ` for @${dmReceiverUsername}` : ""}. Sending to ${shortAddress(dmResolvedTo)}.`
                      : dmReceiverUsername && !dmResolvedTo
                      ? `@${dmReceiverUsername} not found.`
                      : dmResolvedTo
                      ? `Receiver resolved to ${shortAddress(dmResolvedTo)}, but no DM key found. Ask them to click Setup encrypted DM first.`
                      : "Enter a username or wallet. The receiver must setup encrypted DM first."}
                  </p>
                  <button
                    type="button"
                    className="pixel-btn-soft pixel-btn-soft-emerald"
                    disabled={!hasProfile || !dmResolvedTo || !dmForm.payload || !localDmPublicKey || !receiverDmPublicKey}
                    onClick={submitEncryptedMessage}
                  >
                    Send encrypted DM
                  </button>
                </div>
              </PixelPanel>
            </div>

            <PixelPanel>
              <PanelTitle
                title="Encrypted inbox"
                right={<span className="text-[10px] text-white/45">{dmBox === "inbox" ? `${inboxIds.length} inbox` : `${sentIds.length} sent`}</span>}
              />
              <div className="grid gap-3 p-4">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    className={`pixel-btn-soft pixel-btn-soft-sm ${dmBox === "inbox" ? "pixel-btn-soft-indigo" : "pixel-btn-soft-secondary"}`}
                    onClick={() => setDmBox("inbox")}
                  >
                    Inbox
                  </button>
                  <button
                    type="button"
                    className={`pixel-btn-soft pixel-btn-soft-sm ${dmBox === "sent" ? "pixel-btn-soft-emerald" : "pixel-btn-soft-secondary"}`}
                    onClick={() => setDmBox("sent")}
                  >
                    Sent
                  </button>
                </div>

                {dmMessages.length > 0 ? (
                  <div className="grid gap-3">
                    {dmMessages.map(({ messageId, message }) => {
                      const envelope = parseDmEnvelope(message[4]);
                      const decrypted = dmDecryptions[messageId.toString()];
                      const decoded = envelope ? "" : decodeMaybeTextPayload(message[4]);
                      return (
                        <div key={messageId.toString()} className="border border-white/10 bg-black p-3">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <ProfileBadge address={dmBox === "inbox" ? message[0] : message[1]} dense />
                            <span className="text-[10px] text-white/35">#{messageId.toString()} · {formatDate(message[5])}</span>
                          </div>
                          <div className="grid gap-2 text-[10px] uppercase tracking-[0.12em] text-white/42">
                            <span>From {shortAddress(message[0])}</span>
                            <span>To {shortAddress(message[1])}</span>
                          </div>
                          {envelope ? (
                            decrypted?.ok ? (
                              <p className="mt-3 whitespace-pre-wrap break-words border border-[var(--pixel-green)]/30 bg-[rgba(0,255,138,0.05)] p-3 text-xs leading-relaxed text-white">
                                {decrypted.text}
                              </p>
                            ) : (
                              <p className="mt-3 border border-[var(--pixel-amber)]/35 bg-[rgba(255,226,92,0.06)] p-3 text-[11px] leading-relaxed text-white/58">
                                {decrypted?.text || "Decrypting..."}
                              </p>
                            )
                          ) : decoded ? (
                            <p className="mt-3 whitespace-pre-wrap break-words border border-white/10 bg-white/[0.03] p-3 text-xs leading-relaxed text-white/78">
                              {decoded}
                            </p>
                          ) : (
                            <p className="mt-3 break-all border border-white/10 bg-white/[0.03] p-3 text-[11px] leading-relaxed text-white/52">
                              {message[4]}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="zeroxn-empty border border-white/12 bg-black p-5 text-sm text-white/50">
                    No encrypted messages in {dmBox}.
                  </div>
                )}
              </div>
            </PixelPanel>
          </section>
        ) : null}
      </main>
    </div>
  );
}
