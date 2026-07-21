import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, type Address } from "viem";
import { LITVM_EXPLORER_URL } from "@/lib/explorer";
import { ZEROXN_ADDRESS } from "@/lib/0xNAbi";

const ZEROXN_DEPLOYMENT_BLOCK = 26_925_806;
const POST_CREATED_TOPIC = "0xa449010b893eaee00a1f98d63e14bb12546d5fe4738079a532ac6a1536153de6";
const POST_LIKED_TOPIC = "0xa52683361f4b72bf21d66b5cf9727c4f49f4c0e12ec466cfad4473c8c971dfd7";
const COMMENT_CREATED_TOPIC = "0xb26b28af845c655de8a0781b33321442c59fca924e20664d2d40e97a43c45f6f";
const FOLLOWED_TOPIC = "0x6178e95c138f06036cdc07a49ed6a3d23008969fa143baeceb037ebae22e8d14";

type ExplorerLog = {
  blockNumber: string;
  logIndex: string;
  timeStamp: string;
  topics: string[];
  transactionHash: string;
};

type ExplorerLogResponse = {
  status?: string;
  message?: string;
  result?: ExplorerLog[] | string;
};

export type SocialNotification = {
  id: string;
  kind: "like" | "comment" | "follow";
  actor: Address;
  postId?: string;
  timestamp: number;
  transactionHash: `0x${string}`;
};

function indexedAddress(address: Address): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

function indexedUint(value: string): `0x${string}` {
  return `0x${BigInt(value).toString(16).padStart(64, "0")}`;
}

function addressFromTopic(topic?: string): Address | null {
  if (!topic || topic.length < 42) return null;
  const value = `0x${topic.slice(-40)}`;
  return isAddress(value) ? getAddress(value) : null;
}

function uintFromTopic(topic?: string): string | null {
  if (!topic) return null;
  try {
    return BigInt(topic).toString();
  } catch {
    return null;
  }
}

function hexNumber(value?: string): number {
  if (!value) return 0;
  try {
    return Number(BigInt(value));
  } catch {
    return 0;
  }
}

function logsUrl(topic0: string, indexed?: { position: 1 | 2 | 3; value: string }): string {
  const url = new URL("/api", LITVM_EXPLORER_URL);
  url.searchParams.set("module", "logs");
  url.searchParams.set("action", "getLogs");
  url.searchParams.set("fromBlock", ZEROXN_DEPLOYMENT_BLOCK.toString());
  url.searchParams.set("toBlock", "latest");
  url.searchParams.set("address", ZEROXN_ADDRESS);
  url.searchParams.set("topic0", topic0);
  if (indexed) {
    url.searchParams.set(`topic${indexed.position}`, indexed.value);
    url.searchParams.set(`topic0_${indexed.position}_opr`, "and");
  }
  return url.toString();
}

async function fetchLogs(topic0: string, indexed?: { position: 1 | 2 | 3; value: string }): Promise<ExplorerLog[]> {
  const response = await fetch(logsUrl(topic0, indexed), {
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });

  if (!response.ok) throw new Error(`Explorer returned HTTP ${response.status}`);
  const body = (await response.json()) as ExplorerLogResponse;
  if (Array.isArray(body.result)) return body.result;

  const message = `${body.message ?? ""} ${typeof body.result === "string" ? body.result : ""}`;
  if (body.status === "0" && /no (logs|records) found/i.test(message)) return [];
  throw new Error(message.trim() || "Explorer returned an invalid log response");
}

function logId(kind: SocialNotification["kind"], log: ExplorerLog): string {
  return `${kind}:${log.transactionHash}:${log.logIndex}`;
}

export async function GET(request: NextRequest) {
  const rawAddress = request.nextUrl.searchParams.get("address")?.trim();
  if (!rawAddress || !isAddress(rawAddress)) {
    return NextResponse.json({ error: "A valid wallet address is required." }, { status: 400 });
  }

  const address = getAddress(rawAddress);
  const targetTopic = indexedAddress(address);

  try {
    const [postLogs, likeLogs, followLogs] = await Promise.all([
      fetchLogs(POST_CREATED_TOPIC, { position: 2, value: targetTopic }),
      fetchLogs(POST_LIKED_TOPIC, { position: 3, value: targetTopic }),
      fetchLogs(FOLLOWED_TOPIC, { position: 2, value: targetTopic }),
    ]);

    const ownPostIds = new Set<string>(
      postLogs
        .map((log) => uintFromTopic(log.topics[1]))
        .filter((postId): postId is string => Boolean(postId)),
    );
    const commentLogs: ExplorerLog[] = [];
    const postIds = [...ownPostIds];
    for (let start = 0; start < postIds.length; start += 6) {
      const batch = postIds.slice(start, start + 6);
      const results = await Promise.all(
        batch.map((postId) => fetchLogs(COMMENT_CREATED_TOPIC, {
          position: 2,
          value: indexedUint(postId),
        })),
      );
      results.forEach((logs) => commentLogs.push(...logs));
    }
    const ownAddress = address.toLowerCase();
    const notifications: SocialNotification[] = [];

    likeLogs.forEach((log) => {
      const actor = addressFromTopic(log.topics[2]);
      const postId = uintFromTopic(log.topics[1]);
      if (!actor || !postId || actor.toLowerCase() === ownAddress) return;
      notifications.push({
        id: logId("like", log),
        kind: "like",
        actor,
        postId,
        timestamp: hexNumber(log.timeStamp),
        transactionHash: log.transactionHash as `0x${string}`,
      });
    });

    commentLogs.forEach((log) => {
      const actor = addressFromTopic(log.topics[3]);
      const postId = uintFromTopic(log.topics[2]);
      if (!actor || !postId || !ownPostIds.has(postId) || actor.toLowerCase() === ownAddress) return;
      notifications.push({
        id: logId("comment", log),
        kind: "comment",
        actor,
        postId,
        timestamp: hexNumber(log.timeStamp),
        transactionHash: log.transactionHash as `0x${string}`,
      });
    });

    followLogs.forEach((log) => {
      const actor = addressFromTopic(log.topics[1]);
      if (!actor || actor.toLowerCase() === ownAddress) return;
      notifications.push({
        id: logId("follow", log),
        kind: "follow",
        actor,
        timestamp: hexNumber(log.timeStamp),
        transactionHash: log.transactionHash as `0x${string}`,
      });
    });

    notifications.sort((a, b) => b.timestamp - a.timestamp || b.id.localeCompare(a.id));

    return NextResponse.json(
      {
        address,
        notifications,
        generatedAt: Math.floor(Date.now() / 1_000),
      },
      {
        headers: {
          "Cache-Control": "public, max-age=10, s-maxage=10, stale-while-revalidate=30",
        },
      },
    );
  } catch (error) {
    console.error("[0x notifications]", error);
    return NextResponse.json(
      { error: "Could not load onchain notifications right now." },
      { status: 502 },
    );
  }
}
