import { createConfig, http } from "wagmi";
import { coinbaseWallet, injected } from "wagmi/connectors";
import { litvm, LITVM_RPC_URL } from "@/config/wagmi";

const connectors = [injected(), coinbaseWallet({ appName: "0xDex" })];

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
