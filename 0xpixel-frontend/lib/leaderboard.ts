import { PMINING_CONTRACT_ADDRESS } from "@/lib/pmContract";

const BLOCKSCOUT_BASE = "https://liteforge.explorer.caldera.xyz/api/v2";

export interface LeaderboardEntry {
  address: `0x${string}`;
  rigCount: number;
  totalMined: bigint;
}

export interface LeaderboardData {
  entries: LeaderboardEntry[];
  totalRigs: number;
  totalMined: bigint;
  uniqueMiners: number;
  refreshedAt: number;
  nextRefreshAt: number;
}

interface BlockscoutLogItem {
  address: { hash: string };
  block_number: number;
  topics: string[];
  data: string;
  decoded?: {
    method_call: string;
    parameters: { name: string; value: string; type: string }[];
  };
}

interface BlockscoutLogsResponse {
  items: BlockscoutLogItem[];
  next_page_params: { block_number: number; index: number } | null;
}

async function fetchAllContractLogs(): Promise<BlockscoutLogItem[]> {
  const all: BlockscoutLogItem[] = [];
  let page: string | null = null;
  for (let i = 0; i < 20; i++) {
    const url = page
      ? `${BLOCKSCOUT_BASE}${page}`
      : `${BLOCKSCOUT_BASE}/addresses/${PMINING_CONTRACT_ADDRESS}/logs`;
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`Blockscout logs HTTP ${res.status}`);
    const json = (await res.json()) as BlockscoutLogsResponse;
    all.push(...json.items);
    if (!json.next_page_params) break;
    const np = json.next_page_params;
    page = `/addresses/${PMINING_CONTRACT_ADDRESS}/logs?block_number=${np.block_number}&index=${np.index}`;
  }
  return all;
}

function decodeUint256(hex: string): bigint {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

export async function buildLeaderboard(): Promise<LeaderboardData> {
  const logs = await fetchAllContractLogs();

  const minedByAddress = new Map<string, bigint>();
  const rigsByAddress = new Map<string, Set<bigint>>();

  for (const log of logs) {
    const method = log.decoded?.method_call ?? "";
    const params = log.decoded?.parameters ?? [];

    if (method.startsWith("RigClaimed(")) {
      const user = (params.find((p) => p.name === "user")?.value ?? "") as string;
      const rewardHex =
        params.find((p) => p.name === "reward")?.value ??
        params.find((p) => p.name === "amount")?.value ??
        "0";
      if (!user) continue;
      const reward = decodeUint256(rewardHex);
      minedByAddress.set(user.toLowerCase(), (minedByAddress.get(user.toLowerCase()) ?? 0n) + reward);
    } else if (method.startsWith("RigBought(")) {
      const user =
        (params.find((p) => p.name === "user")?.value ??
        params.find((p) => p.name === "buyer")?.value ??
        "") as string;
      const nftIdHex = params.find((p) => p.name === "nftId")?.value ?? "0";
      if (!user) continue;
      const nftId = decodeUint256(nftIdHex);
      const set = rigsByAddress.get(user.toLowerCase()) ?? new Set<bigint>();
      set.add(nftId);
      rigsByAddress.set(user.toLowerCase(), set);
    }
  }

  const allAddresses = new Set<string>([
    ...minedByAddress.keys(),
    ...rigsByAddress.keys(),
  ]);

  const entries: LeaderboardEntry[] = [];
  let totalRigs = 0;
  let totalMined = 0n;

  for (const addr of allAddresses) {
    const rigCount = rigsByAddress.get(addr)?.size ?? 0;
    const totalMinedAddr = minedByAddress.get(addr) ?? 0n;
    if (rigCount === 0 && totalMinedAddr === 0n) continue;
    totalRigs += rigCount;
    totalMined += totalMinedAddr;
    entries.push({
      address: addr as `0x${string}`,
      rigCount,
      totalMined: totalMinedAddr,
    });
  }

  entries.sort((a, b) => {
    if (a.totalMined > b.totalMined) return -1;
    if (a.totalMined < b.totalMined) return 1;
    return a.address.localeCompare(b.address);
  });

  return {
    entries,
    totalRigs,
    totalMined,
    uniqueMiners: entries.length,
    refreshedAt: Date.now(),
    nextRefreshAt: getNext7UtcMs(),
  };
}

export function getNext7UtcMs(now: number = Date.now()): number {
  const d = new Date(now);
  const next = new Date(
    Date.UTC(
      d.getUTCFullYear(),
      d.getUTCMonth(),
      d.getUTCDate() + (d.getUTCHours() >= 7 ? 1 : 0),
      7,
      0,
      0,
      0
    )
  );
  return next.getTime();
}
