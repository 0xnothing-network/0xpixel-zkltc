"use client";

import { useMemo, useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/Toast";

export function Providers({ children }: { children: React.ReactNode }) {
  // Suppress noisy Reown AppKit + WalletConnect remote-config logs (HTTP 403
  // fetching projectId metadata is non-fatal — wagmi falls back to defaults).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const shouldSilence = (args: unknown[]) =>
      args.some(
        (a) =>
          typeof a === "string" &&
          (a.includes("[Reown Config]") ||
            a.includes("[Reown WalletConnect") ||
            a.includes("Failed to fetch remote project configuration"))
      );
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    console.warn = (...args: unknown[]) => {
      if (shouldSilence(args)) return;
      origWarn(...args);
    };
    console.error = (...args: unknown[]) => {
      if (shouldSilence(args)) return;
      origError(...args);
    };
    return () => {
      console.warn = origWarn;
      console.error = origError;
    };
  }, []);

  const queryClient = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 2,
            retryDelay: (attemptIndex) => Math.min(500 * 2 ** attemptIndex, 3000),
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
          },
          mutations: {
            retry: 1,
          },
        },
      }),
    []
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
