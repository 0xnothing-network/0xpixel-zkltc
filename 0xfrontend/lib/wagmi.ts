import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { litvm, LITVM_RPC_URL } from "@/config/wagmi";

const connectors = [injected(), coinbaseWallet({ appName: "0xDex" })];

export const wagmiConfig = createConfig({
  ssr: true,
  chains: [litvm],
  connectors,
  transports: {
    [litvm.id]: http(LITVM_RPC_URL, {
      retryCount: 2,
      retryDelay: 300,
      timeout: 15_000,
    }),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
