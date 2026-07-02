import { PIXEL_NFT_CONTRACT_ADDRESS } from "@/lib/contract";
import { pixelDataToSVG } from "@/lib/gridParser";

const DEFAULT_MARKETPLACE_SUBGRAPH_URL = "";

const MARKETPLACE_SUBGRAPH_URL_RAW =
  process.env.NEXT_PUBLIC_MARKETPLACE_SUBGRAPH_URL ||
  DEFAULT_MARKETPLACE_SUBGRAPH_URL;

const MARKETPLACE_SUBGRAPH_URL =
  MARKETPLACE_SUBGRAPH_URL_RAW === "disabled" ? "" : MARKETPLACE_SUBGRAPH_URL_RAW;

const PIXEL_COLLECTION = PIXEL_NFT_CONTRACT_ADDRESS.toLowerCase();

export interface SubgraphTokenMetadata {
  tokenId: string;
  name: string;
  imageUrl: string;
  creator: `0x${string}`;
  mintedAt: number;
}

export interface SubgraphListingDTO {
  listingId: string;
  tokenId: string;
  price: string;
  seller: `0x${string}`;
  active: boolean;
}

export type SubgraphMarketEventType = "LISTED" | "BOUGHT" | "CANCELLED";

export interface SubgraphMarketEventDTO {
  id: string;
  listingId: string;
  tokenId: string;
  eventType: SubgraphMarketEventType;
  price: string | null;
  seller: `0x${string}` | null;
  buyer: `0x${string}` | null;
  timestamp: number;
  blockNumber: number;
  txHash: `0x${string}`;
  token: SubgraphTokenMetadata | null;
}

export interface SubgraphOwnedNft {
  tokenId: string;
  name: string;
  imageUrl: string;
  listing: { listingId: string; price: string } | null;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

interface TokenNode {
  id: string;
  tokenId: string;
  name: string;
  gridSize: string | null;
  pixelData: string | null;
  creator: string;
  mintedAt: string;
  activeListing?: {
    listingId: string;
    price: string;
    active: boolean;
  } | null;
}

interface ListingNode {
  id: string;
  listingId: string;
  tokenId: string;
  price: string;
  seller: string;
  active: boolean;
  token?: TokenNode | null;
}

interface MarketEventNode {
  id: string;
  listingId: string;
  tokenId: string | null;
  eventType: SubgraphMarketEventType;
  price: string | null;
  seller: string | null;
  buyer: string | null;
  timestamp: string;
  blockNumber: string;
  txHash: string;
  listing?: {
    token?: TokenNode | null;
  } | null;
}

const USER_NFTS_QUERY = `
  query GetUserPixelNfts(
    $owner: Bytes!
    $collection: Bytes!
    $limit: Int!
  ) {
    tokens(
      first: $limit
      orderBy: tokenId
      orderDirection: desc
      where: {
        owner: $owner
        collection: $collection
      }
    ) {
      id
      tokenId
      name
      gridSize
      pixelData
      creator
      mintedAt
      activeListing {
        listingId
        price
        active
      }
    }
  }
`;

const ACTIVE_LISTINGS_QUERY = `
  query GetActivePixelListings(
    $collection: Bytes!
    $limit: Int!
    $skip: Int!
  ) {
    listings(
      first: $limit
      skip: $skip
      orderBy: listedAt
      orderDirection: desc
      where: {
        active: true
        collection: $collection
      }
    ) {
      id
      listingId
      tokenId
      price
      seller
      active
      token {
        id
        tokenId
        name
        gridSize
        pixelData
        creator
        mintedAt
      }
    }
  }
`;

const MARKET_EVENTS_QUERY = `
  query GetPixelMarketEvents(
    $collection: Bytes!
    $limit: Int!
    $skip: Int!
  ) {
    marketEvents(
      first: $limit
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
      where: {
        collection: $collection
      }
    ) {
      id
      listingId
      tokenId
      eventType
      price
      seller
      buyer
      timestamp
      blockNumber
      txHash
      listing {
        token {
          id
          tokenId
          name
          gridSize
          pixelData
          creator
          mintedAt
        }
      }
    }
  }
`;

const MARKET_EVENTS_BY_TYPE_QUERY = `
  query GetPixelMarketEventsByType(
    $collection: Bytes!
    $eventTypes: [MarketEventType!]!
    $limit: Int!
    $skip: Int!
  ) {
    marketEvents(
      first: $limit
      skip: $skip
      orderBy: timestamp
      orderDirection: desc
      where: {
        collection: $collection
        eventType_in: $eventTypes
      }
    ) {
      id
      listingId
      tokenId
      eventType
      price
      seller
      buyer
      timestamp
      blockNumber
      txHash
      listing {
        token {
          id
          tokenId
          name
          gridSize
          pixelData
          creator
          mintedAt
        }
      }
    }
  }
`;

export function hasMarketplaceSubgraph(): boolean {
  return MARKETPLACE_SUBGRAPH_URL.length > 0;
}

export async function fetchUserNftsFromSubgraph(
  address: string,
  limit = 500
): Promise<SubgraphOwnedNft[]> {
  const owner = normalizeAddress(address);
  const data = await graphFetch<{ tokens: TokenNode[] }>(USER_NFTS_QUERY, {
    owner,
    collection: PIXEL_COLLECTION,
    limit,
  });

  return (data.tokens ?? []).map((token) => {
    const activeListing = token.activeListing?.active
      ? {
          listingId: token.activeListing.listingId,
          price: token.activeListing.price,
        }
      : null;

    return {
      tokenId: token.tokenId,
      name: token.name || `Token #${token.tokenId}`,
      imageUrl: imageUrlFromToken(token),
      listing: activeListing,
    };
  });
}

export async function fetchMarketplaceListingsFromSubgraph(
  limit = 1000
): Promise<{
  listings: SubgraphListingDTO[];
  tokens: Record<string, SubgraphTokenMetadata | null>;
}> {
  const listings: SubgraphListingDTO[] = [];
  const tokens: Record<string, SubgraphTokenMetadata | null> = {};
  const pageSize = Math.min(Math.max(1, limit), 1000);
  let skip = 0;

  while (true) {
    const data = await graphFetch<{ listings: ListingNode[] }>(
      ACTIVE_LISTINGS_QUERY,
      {
        collection: PIXEL_COLLECTION,
        limit: pageSize,
        skip,
      }
    );

    const page = data.listings ?? [];
    for (const listing of page) {
      if (!listing.active) continue;
      const tokenId = listing.tokenId;
      listings.push({
        listingId: listing.listingId,
        tokenId,
        price: listing.price,
        seller: normalizeAddress(listing.seller),
        active: listing.active,
      });
      tokens[tokenId] = listing.token
        ? {
            tokenId,
            name: listing.token.name || `Token #${tokenId}`,
            imageUrl: imageUrlFromToken(listing.token),
            creator: normalizeAddress(listing.token.creator),
            mintedAt: Number(listing.token.mintedAt || 0),
          }
        : null;
    }

    if (page.length < pageSize) break;
    skip += pageSize;
  }

  return { listings, tokens };
}

export async function fetchMarketplaceActivityFromSubgraph({
  limit = 30,
  skip = 0,
  eventTypes,
}: {
  limit?: number;
  skip?: number;
  eventTypes?: SubgraphMarketEventType[];
} = {}): Promise<{ events: SubgraphMarketEventDTO[] }> {
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeSkip = Math.max(0, skip);
  const filteredTypes = eventTypes?.filter(isMarketEventType);
  const query = filteredTypes?.length
    ? MARKET_EVENTS_BY_TYPE_QUERY
    : MARKET_EVENTS_QUERY;
  const variables: Record<string, unknown> = {
    collection: PIXEL_COLLECTION,
    limit: safeLimit,
    skip: safeSkip,
  };

  if (filteredTypes?.length) {
    variables.eventTypes = filteredTypes;
  }

  const data = await graphFetch<{ marketEvents: MarketEventNode[] }>(
    query,
    variables
  );

  return {
    events: (data.marketEvents ?? []).map((event) => {
      const token = event.listing?.token ?? null;
      const tokenId = event.tokenId || token?.tokenId || "0";
      return {
        id: event.id,
        listingId: event.listingId,
        tokenId,
        eventType: event.eventType,
        price: event.price,
        seller: normalizeNullableAddress(event.seller),
        buyer: normalizeNullableAddress(event.buyer),
        timestamp: Number(event.timestamp || 0),
        blockNumber: Number(event.blockNumber || 0),
        txHash: normalizeAddress(event.txHash),
        token: token
          ? {
              tokenId,
              name: token.name || `Token #${tokenId}`,
              imageUrl: imageUrlFromToken(token),
              creator: normalizeAddress(token.creator),
              mintedAt: Number(token.mintedAt || 0),
            }
          : null,
      };
    }),
  };
}

async function graphFetch<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T> {
  if (!MARKETPLACE_SUBGRAPH_URL) {
    throw new Error("Marketplace subgraph URL is not configured");
  }

  const response = await fetch(MARKETPLACE_SUBGRAPH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8_000),
    next: { revalidate: 10 },
  });

  if (!response.ok) {
    throw new Error(`Marketplace subgraph request failed: ${response.status}`);
  }

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new Error(json.errors[0]?.message || "Marketplace subgraph query error");
  }
  if (!json.data) {
    throw new Error("Marketplace subgraph returned no data");
  }
  return json.data;
}

function imageUrlFromToken(token: TokenNode): string {
  if (!token.pixelData || !token.gridSize) return "";
  const gridSize = Number(token.gridSize);
  if (!Number.isFinite(gridSize) || gridSize <= 0) return "";
  return pixelDataToSVG(token.pixelData, gridSize);
}

function normalizeAddress(address: string): `0x${string}` {
  return address.toLowerCase() as `0x${string}`;
}

function normalizeNullableAddress(address: string | null | undefined): `0x${string}` | null {
  return address ? normalizeAddress(address) : null;
}

function isMarketEventType(value: string): value is SubgraphMarketEventType {
  return value === "LISTED" || value === "BOUGHT" || value === "CANCELLED";
}
