import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import { litvm } from "@/config/wagmi";

export const wagmiConfig = createConfig({
  chains: [litvm],
  connectors: [injected()],
  transports: {
    [litvm.id]: http("https://liteforge.rpc.caldera.xyz/http"),
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
