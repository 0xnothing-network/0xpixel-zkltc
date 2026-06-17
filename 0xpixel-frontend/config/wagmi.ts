import { defineChain } from "viem";

const DEFAULT_LITVM_RPC = "https://liteforge.rpc.caldera.xyz/http";

export const LITVM_RPC_URL =
  process.env.NEXT_PUBLIC_LITVM_RPC || DEFAULT_LITVM_RPC;

export const litvm = defineChain({
  id: 4441,
  name: "LitVM LiteForge",
  nativeCurrency: { name: "zkLTC", symbol: "zkLTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [LITVM_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "LiteForge Explorer",
      url: "https://liteforge.explorer.caldera.xyz",
    },
  },
  contracts: {
    multicall3: {
      address: "0xca11bde05977b3631167028862be2a173976ca11",
      blockCreated: 1,
    },
  },
});
