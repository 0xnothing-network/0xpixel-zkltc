"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortenAddress } from "@/lib/contract";

const NAV_LINKS = [
  { href: "/pixel", label: "Draw" },
  { href: "/pixel/gallery", label: "Gallery" },
  { href: "/pixel/marketplace", label: "Marketplace" },
] as const;

function isActive(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/pixel") return pathname === "/pixel";
  return pathname === href || pathname.startsWith(href + "/");
}

export function PixelHeader() {
  const [mounted, setMounted] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close mobile menu on route change.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-50 bg-[#1A1A2E]/90 backdrop-blur-xl border-b border-[#2D2D44]">
      <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/icon.svg"
              alt="0xPixel Logo"
              width={32}
              height={32}
              priority
              className="w-8 h-8 rounded-full object-cover"
            />
            <span
              className="text-white font-bold text-base tracking-tight"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              0xPixel
            </span>
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "px-4 py-2 rounded-lg text-sm text-white bg-white/5 transition-all duration-150"
                    : "px-4 py-2 rounded-lg text-sm text-[#64748B] hover:text-white hover:bg-white/5 transition-all duration-150"
                }
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {link.label}
              </Link>
            );
          })}
          <a
            href="https://x.com/0xnothing_net"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-[#64748B] hover:text-white hover:bg-white/5 transition-all duration-150"
            aria-label="X / Twitter"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </nav>

        <div className="flex items-center gap-2">
          {mounted && isConnected ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-white text-xs font-mono">
                  {shortenAddress(address!)}
                </span>
              </div>
              <button
                onClick={() => disconnect()}
                className="px-3 py-1.5 rounded-lg text-xs text-[#94A3B8] hover:text-white bg-white/5 hover:bg-white/10 border border-[#2D2D44] transition-colors"
                style={{ fontFamily: "var(--font-departure)" }}
              >
                DISCONNECT
              </button>
            </div>
          ) : mounted ? (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              disabled={isPending}
              className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-colors disabled:opacity-50"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {isPending ? "CONNECTING..." : "CONNECT WALLET"}
            </button>
          ) : (
            <div className="w-28 h-9 bg-white/5 rounded-lg animate-pulse" />
          )}

          <button
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden w-9 h-9 flex flex-col items-center justify-center gap-1.5 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="Toggle menu"
            aria-expanded={mobileMenuOpen}
          >
            <span
              className={`block w-5 h-px bg-white transition-all ${
                mobileMenuOpen ? "rotate-45 translate-y-1.5" : ""
              }`}
            />
            <span
              className={`block w-5 h-px bg-white transition-all ${
                mobileMenuOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block w-5 h-px bg-white transition-all ${
                mobileMenuOpen ? "-rotate-45 -translate-y-1.5" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <nav className="md:hidden border-t border-[#2D2D44] px-4 py-3 space-y-0.5">
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={
                  active
                    ? "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white bg-white/5 transition-all duration-150"
                    : "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-[#64748B] hover:text-white hover:bg-white/5 transition-all duration-150"
                }
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}
