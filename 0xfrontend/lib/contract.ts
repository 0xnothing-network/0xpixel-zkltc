import { createPublicClient, http } from "viem";
import { PixelNFTABI } from "./abi";
import { pixelDataToSVG } from "./gridParser";
import { litvm, LITVM_RPC_URL } from "@/config/wagmi";

export const PIXEL_NFT_CONTRACT_ADDRESS: `0x${string}` =
  (process.env.NEXT_PUBLIC_PIXEL_NFT_ADDRESS as `0x${string}`) ||
  "0x33A32b9b2BEe864f9e42BFa39cA7BDC72f655988";

export const PIXEL_MARKETPLACE_ADDRESS: `0x${string}` =
  (process.env.NEXT_PUBLIC_PIXEL_MARKETPLACE_ADDRESS as `0x${string}`) ||
  "0x13337cadA78d53C90E3c0EcE44C17c467C1a86F4";

export const LITVM_EXPLORER_URL = "https://liteforge.explorer.caldera.xyz";

export function getExplorerUrl(tokenId?: bigint | number | string): string {
  const base = `${LITVM_EXPLORER_URL}/token/${PIXEL_NFT_CONTRACT_ADDRESS}`;
  if (tokenId === undefined || tokenId === null) return base;
  return `${base}?id=${tokenId.toString()}`;
}

export function getMarketplaceTxUrl(txHash: string): string {
  return `${LITVM_EXPLORER_URL}/tx/${txHash}`;
}

export function shortenAddress(addr: string, head = 6, tail = 4): string {
  if (!addr) return "";
  if (addr.length < head + tail + 2) return addr;
  return `${addr.slice(0, head)}...${addr.slice(-tail)}`;
}

export const publicClient = createPublicClient({
  chain: litvm,
  transport: http(LITVM_RPC_URL, {
    retryCount: 2,
    retryDelay: 300,
    timeout: 15_000,
  }),
  batch: { multicall: { batchSize: 64 } },
});

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts = 5,
  baseDelayMs = 500
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      const msg = String((err as { message?: string })?.message || err);
      const isRateLimit =
        msg.includes("Bandwidth limit") ||
        msg.includes("rate limit") ||
        msg.includes("429") ||
        msg.includes("limit exceeded") ||
        msg.includes("too many requests");
      
      if (!isRateLimit && i > 0) throw err;
      if (i < attempts - 1) {
        const delay = baseDelayMs * Math.pow(2, i);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

interface TokenData {
  name: string;
  gridSize: bigint;
  pixelData: string;
  creator: string;
  mintedAt: bigint;
  artworkHash: string;
}

const CACHE_TTL_SUCCESS = 30_000;
const CACHE_TTL_ERROR = 2_000;
const TOKEN_DATA_CACHE_MAX = 4_096;
const USER_NFT_CACHE_MAX = 1_024;

type CacheEntry<T> = { data: T; timestamp: number; isError?: boolean };
const tokenDataCache = new Map<string, CacheEntry<TokenData | null>>();
const userNftCache = new Map<string, CacheEntry<bigint[]>>();

function setBoundedCache<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number
) {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

export async function fetchTokenDataCached(tokenId: bigint): Promise<TokenData | null> {
  const key = tokenId.toString();
  const cached = tokenDataCache.get(key);
  if (cached) {
    const ttl = cached.isError ? CACHE_TTL_ERROR : CACHE_TTL_SUCCESS;
    if (Date.now() - cached.timestamp < ttl) return cached.data;
  }

  try {
    const raw = await withRetry(() =>
      publicClient.readContract({
        address: PIXEL_NFT_CONTRACT_ADDRESS,
        abi: PixelNFTABI,
        functionName: "tokenData",
        args: [tokenId],
      })
    );
    const tuple = raw as unknown as [
      string, bigint, string, string, bigint, string,
    ];
    const result: TokenData = {
      name: tuple[0],
      gridSize: tuple[1],
      pixelData: tuple[2],
      creator: tuple[3],
      mintedAt: tuple[4],
      artworkHash: tuple[5],
    };
    setBoundedCache(tokenDataCache, key, { data: result, timestamp: Date.now() }, TOKEN_DATA_CACHE_MAX);
    return result;
  } catch (err) {
    console.error(`[Contract] tokenData(${tokenId}) error:`, err);
    if (!cached) {
      setBoundedCache(tokenDataCache, key, { data: null, timestamp: Date.now(), isError: true }, TOKEN_DATA_CACHE_MAX);
    }
    return cached?.data ?? null;
  }
}

export async function getUserTokenIds(address: string): Promise<bigint[]> {
  if (!address || typeof address !== "string" || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
    return [];
  }
  const addr = address.toLowerCase() as `0x${string}`;

  const cached = userNftCache.get(addr);
  if (cached && !cached.isError && Date.now() - cached.timestamp < CACHE_TTL_SUCCESS) {
    return cached.data;
  }

  try {
    const balance = (await withRetry(() =>
      publicClient.readContract({
        address: PIXEL_NFT_CONTRACT_ADDRESS,
        abi: PixelNFTABI,
        functionName: "balanceOf",
        args: [addr],
      })
    )) as bigint;
    if (balance > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("NFT balance is too large to enumerate safely");
    }
    const n = Number(balance);

    if (n === 0) {
      setBoundedCache(userNftCache, addr, { data: [], timestamp: Date.now() }, USER_NFT_CACHE_MAX);
      return [];
    }

    const BATCH = 100;
    const allIds: bigint[] = [];

    for (let start = 0; start < n; start += BATCH) {
      const indexes = Array.from(
        { length: Math.min(BATCH, n - start) },
        (_, offset) => start + offset
      );
      const results = await publicClient.multicall({
        allowFailure: true,
        contracts: indexes.map((index) => ({
          address: PIXEL_NFT_CONTRACT_ADDRESS,
          abi: PixelNFTABI,
          functionName: "userTokens" as const,
          args: [addr, BigInt(index)] as const,
        })),
      });

      const ids = await Promise.all(results.map((result, resultIndex) => {
        if (result.status === "success") return Promise.resolve(result.result as bigint);
        const index = indexes[resultIndex];
        return withRetry(() =>
          publicClient.readContract({
            address: PIXEL_NFT_CONTRACT_ADDRESS,
            abi: PixelNFTABI,
            functionName: "userTokens",
            args: [addr, BigInt(index)],
          }) as Promise<bigint>
        );
      }));
      allIds.push(...ids);
    }

    const ids = Array.from(
      new Map(allIds.map((id) => [id.toString(), id] as const)).values()
    );
    if (ids.length !== n) {
      throw new Error(`Incomplete NFT enumeration: expected ${n}, received ${ids.length}`);
    }
    setBoundedCache(userNftCache, addr, { data: ids, timestamp: Date.now() }, USER_NFT_CACHE_MAX);
    return ids.sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  } catch (err) {
    console.error("[Contract] getUserTokenIds error:", err);
    if (cached && !cached.isError) return cached.data;
    setBoundedCache(userNftCache, addr, { data: [], timestamp: Date.now(), isError: true }, USER_NFT_CACHE_MAX);
    throw err;
  }
}

export async function getUserNFTs(address: string) {
  if (!address || typeof address !== "string" || !address.match(/^0x[0-9a-fA-F]{40}$/)) {
    return [];
  }
  const tokenIds = await getUserTokenIds(address);
  if (tokenIds.length === 0) return [];

  const results = await Promise.all(
    tokenIds.map((id) => fetchTokenDataCached(id))
  );

  return tokenIds
    .map((id, i) => ({
      tokenId: id,
      data: results[i],
      imageUrl:
        results[i]?.pixelData && results[i]?.gridSize
          ? pixelDataToSVG(results[i]!.pixelData, Number(results[i]!.gridSize))
          : "",
    }))
    .filter((nft) => nft.data !== null && nft.imageUrl !== "");
}

export async function getListingImage(tokenId: bigint): Promise<string> {
  // 0xPIXEL tokenURI returns the standard ERC-721 Metadata JSON. Decode the
  // .image field and recurse for any nested envelope.
  try {
    const tokenUri = (await publicClient.readContract({
      address: PIXEL_NFT_CONTRACT_ADDRESS,
      abi: PixelNFTABI,
      functionName: "tokenURI",
      args: [tokenId],
    })) as string;
    return tryDecodeOnchainSvg(tokenUri, 16);
  } catch {
    return "";
  }
}

// -----------------------------------------------------------------------------
// 0xPIXEL on-chain metadata decoder
// -----------------------------------------------------------------------------

/** Pixel-onchain text format: [x,y]=#RRGGBB separated by whitespace. */
const ONCHAIN_TEXT_RE = /\[(\d+),(\d+)\]\s*=\s*(#[0-9A-Fa-f]{6})/g;

function isPackedHex(value: string): boolean {
  if (!value.startsWith("0x")) return false;
  const body = value.slice(2);
  return body.length > 0 && body.length % 12 === 0 && /^[0-9a-fA-F]+$/.test(body);
}

function packedHexToRects(hex: string): string {
  const body = hex.slice(2);
  const out: string[] = [];
  for (let i = 0; i < body.length; i += 12) {
    const x = parseInt(body.slice(i, i + 2), 16);
    const y = parseInt(body.slice(i + 2, i + 4), 16);
    const count = parseInt(body.slice(i + 4, i + 6), 16);
    const r = parseInt(body.slice(i + 6, i + 8), 16);
    const g = parseInt(body.slice(i + 8, i + 10), 16);
    const b = parseInt(body.slice(i + 10, i + 12), 16);
    const color =
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      b.toString(16).padStart(2, "0");
    for (let k = 0; k < count; k++) {
      out.push(`<rect x="${x + k}" y="${y}" width="1" height="1" fill="${color}"/>`);
    }
  }
  return out.join("");
}

function textToRects(text: string): string {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ONCHAIN_TEXT_RE.lastIndex = 0;
  while ((m = ONCHAIN_TEXT_RE.exec(text)) !== null) {
    const x = parseInt(m[1]);
    const y = parseInt(m[2]);
    out.push(`<rect x="${x}" y="${y}" width="1" height="1" fill="${m[3]}"/>`);
  }
  return out.join("");
}

function renderSvgDataUri(viewBox: number, innerSvg: string): string {
  if (!innerSvg) return "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox}" height="${viewBox}" viewBox="0 0 ${viewBox} ${viewBox}" shape-rendering="crispEdges">${innerSvg}</svg>`;
  const encoded =
    typeof Buffer !== "undefined"
      ? Buffer.from(svg, "utf-8").toString("base64")
      : typeof btoa !== "undefined"
      ? btoa(svg)
      : "";
  if (!encoded) return "";
  return `data:image/svg+xml;base64,${encoded}`;
}

/**
 * Convert a raw tokenURI response into a renderable image URL.
 * Returns "" when the value can't be turned into a usable image.
 */
export function tryDecodeOnchainSvg(raw: string, gridSize = 16): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";

  if (trimmed.startsWith("data:")) {
    if (
      trimmed.startsWith("data:image/svg+xml") ||
      trimmed.startsWith("data:image/png") ||
      trimmed.startsWith("data:image/jpeg") ||
      trimmed.startsWith("data:image/jpg") ||
      trimmed.startsWith("data:image/webp") ||
      trimmed.startsWith("data:image/gif") ||
      trimmed.startsWith("data:image/")
    ) {
      return trimmed;
    }
    if (trimmed.startsWith("data:application/json")) {
      const commaIdx = trimmed.indexOf(",");
      if (commaIdx < 0) return "";
      const meta = trimmed.slice(commaIdx + 1);
      const isBase64 = /;base64$/i.test(trimmed.slice(0, commaIdx));
      const decoded = isBase64 ? decodeBase64Text(meta) : decodeURIComponent(meta);
      if (!decoded) return "";
      const inner = tryDecodeOnchainSvg(decoded, gridSize);
      if (inner) return inner;
      const image = extractImageFromMetadataJson(decoded);
      return image ? tryDecodeOnchainSvg(image, gridSize) : "";
    }
    return "";
  }

  if (trimmed.startsWith("{")) {
    const image = extractImageFromMetadataJson(trimmed);
    if (image) return tryDecodeOnchainSvg(image, gridSize);
    return "";
  }

  if (isPackedHex(trimmed)) {
    return renderSvgDataUri(gridSize, packedHexToRects(trimmed));
  }

  if (trimmed.startsWith("ipfs://")) {
    return `https://ipfs.io/ipfs/${trimmed.slice("ipfs://".length).replace(/^ipfs\//, "")}`;
  }
  if (trimmed.startsWith("ar://")) {
    return `https://arweave.net/${trimmed.slice("ar://".length)}`;
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return trimmed;
  }

  if (/\[\d+,\d+\]\s*=\s*#[0-9A-Fa-f]{6}/.test(trimmed)) {
    return renderSvgDataUri(gridSize, textToRects(trimmed));
  }

  return "";
}

function decodeBase64Text(b64: string): string {
  if (!b64) return "";
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(b64, "base64").toString("utf-8");
    }
    if (typeof atob !== "undefined") {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new TextDecoder("utf-8").decode(bytes);
    }
  } catch {
    return "";
  }
  return "";
}

interface MetadataShape {
  image?: string;
  image_url?: string;
  animation_url?: string;
}

function extractImageFromMetadataJson(json: string): string | null {
  try {
    const obj = JSON.parse(json) as MetadataShape;
    const candidate = obj.image ?? obj.image_url ?? obj.animation_url;
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  } catch {
    /* fall through */
  }
  const m = /"(?:image|image_url|animation_url)"\s*:\s*"([^"]+)"/.exec(json);
  if (m && m[1]) {
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1];
    }
  }
  return null;
}
