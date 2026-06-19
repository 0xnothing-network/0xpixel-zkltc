import { createPublicClient, http, fallback } from "viem";
import { PMiningAbi } from "./pmAbi";
import { LITVM_RPC_URL } from "@/config/wagmi";

export const PMINING_CONTRACT_ADDRESS: `0x${string}` = "0x37672fE781D51278D673E9B78F13EBC2f514Cb92";
export const NTOKEN_ADDRESS: `0x${string}` = "0xCde45Fd4A5496926F8b5Cda3cF9173152888cC27";

export const pmPublicClient = createPublicClient({
  chain: {
    id: 4441,
    name: "LitVM LiteForge",
    nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
    rpcUrls: { default: { http: [LITVM_RPC_URL] } },
  },
  transport: fallback([http(LITVM_RPC_URL)], { rank: false, retryCount: 3, retryDelay: 250 }),
});

export async function getRigInfo(nftId: bigint) {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "getRigInfo",
    args: [nftId],
  });
  return data as unknown as [owner: `0x${string}`, level: number, dailyProduction: bigint, nextClaimTime: bigint];
}

export async function getUserMachines(user: `0x${string}`): Promise<bigint[]> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "getUserMachines",
    args: [user],
  });
  return data as bigint[];
}

export async function getRigLevel(nftId: bigint): Promise<number> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "rigLevel",
    args: [nftId],
  });
  return Number(data);
}

export async function getIsRigDeposited(nftId: bigint): Promise<boolean> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "isRigDeposited",
    args: [nftId],
  });
  return Boolean(data);
}

export async function getLastRigClaimTime(nftId: bigint): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "lastRigClaimTime",
    args: [nftId],
  });
  return data as unknown as bigint;
}

export async function getUserRigCount(user: `0x${string}`): Promise<number> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "userRigCount",
    args: [user],
  });
  return Number(data as bigint);
}

export async function getLevelProduction(level: number): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "levelProduction",
    args: [level] as [number],
  });
  return data as unknown as bigint;
}

export async function getLevelUpgradeCost(level: number): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "levelUpgradeCost",
    args: [level] as [number],
  });
  return data as unknown as bigint;
}

export async function getFirstMachinePrice(): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "FIRST_MACHINE_PRICE",
    args: [],
  });
  return data as bigint;
}

export async function getNormalMachinePrice(): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "NORMAL_MACHINE_PRICE",
    args: [],
  });
  return data as bigint;
}

export async function getTotalRewardPool(): Promise<bigint> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "totalRewardPool",
    args: [],
  });
  return data as bigint;
}

export async function getDevWallet(): Promise<`0x${string}`> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "devWallet",
    args: [],
  });
  return data as `0x${string}`;
}

export async function getOwner(): Promise<`0x${string}`> {
  const data = await pmPublicClient.readContract({
    address: PMINING_CONTRACT_ADDRESS,
    abi: PMiningAbi,
    functionName: "owner",
    args: [],
  });
  return data as `0x${string}`;
}

export function getPMExplorerUrl(path: string): string {
  return `https://liteforge.explorer.caldera.xyz/${path}`;
}
