import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { litvm, LITVM_RPC_URL } from "@/config/wagmi";

export const wagmiConfig = createConfig({
  chains: [litvm],
  connectors: [injected()],
  transports: {
    [litvm.id]: http(LITVM_RPC_URL),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
