import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected, walletConnect } from "wagmi/connectors";
import { litvm, LITVM_RPC_URL } from "@/config/wagmi";

const projectId = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

const baseConnectors = [injected(), coinbaseWallet({ appName: "0xDex" })];

const connectors = projectId
  ? [...baseConnectors, walletConnect({ projectId })]
  : baseConnectors;

export const wagmiConfig = createConfig({
  chains: [litvm],
  connectors,
  transports: {
    [litvm.id]: http(LITVM_RPC_URL),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
