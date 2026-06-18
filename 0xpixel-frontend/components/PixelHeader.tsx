"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { shortenAddress } from "@/lib/contract";
import { useToast } from "@/components/Toast";
import { normalizeError, shortHashOrAddr } from "@/lib/errors";

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
  const [addressMenuOpen, setAddressMenuOpen] = useState(false);
  const pathname = usePathname();

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const toast = useToast();

  const addressMenuRef = useRef<HTMLDivElement>(null);
  const prevConnectedRef = useRef<boolean | null>(null);
  const prevAddressRef = useRef<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Close mobile menu on route change.
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  // Close address menu when clicking outside.
  useEffect(() => {
    if (!addressMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (addressMenuRef.current && !addressMenuRef.current.contains(e.target as Node)) {
        setAddressMenuOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddressMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", escHandler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", escHandler);
    };
  }, [addressMenuOpen]);

  // Toast on connect / disconnect transitions.
  useEffect(() => {
    if (!mounted) return;
    const wasConnected = prevConnectedRef.current;
    const wasAddress = prevAddressRef.current;
    prevConnectedRef.current = isConnected;
    prevAddressRef.current = address ?? null;

    if (wasConnected === null) return; // first mount, ignore
    if (wasConnected === false && isConnected && address) {
      toast.success("Wallet connected", `Connected as ${shortHashOrAddr(address)}`);
    } else if (wasConnected === true && !isConnected) {
      if (wasAddress) {
        toast.info("Wallet disconnected", `Removed ${shortHashOrAddr(wasAddress)}`);
      }
    }
  }, [isConnected, address, mounted, toast]);

  // Toast on wagmi/connect error (no provider, user reject, etc.)
  useEffect(() => {
    if (!connectError) return;
    const normalized = normalizeError(connectError);
    toast.show({
      title: normalized.title,
      description: normalized.description,
      kind: normalized.kind,
    });
  }, [connectError, toast]);

  const handleConnect = () => {
    const connector = connectors[0];
    if (!connector) {
      toast.warning(
        "No wallet detected",
        "Install MetaMask or another Web3 wallet, then refresh the page."
      );
      return;
    }
    connect({ connector });
  };

  const handleCopyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      toast.success("Address copied", shortHashOrAddr(address));
    } catch {
      toast.error("Couldn't copy", "Your browser blocked clipboard access.");
    }
  };

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
              className="w-8 h-8 rounded-full object-cover transition-transform duration-200 group-hover:scale-105"
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
                className={[
                  "relative px-4 py-2 rounded-lg text-sm transition-all duration-150",
                  active
                    ? "text-white bg-white/5"
                    : "text-[#64748B] hover:text-white hover:bg-white/5",
                ].join(" ")}
                style={{ fontFamily: "var(--font-departure)" }}
              >
                <span className="relative z-10">{link.label}</span>
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute left-3 right-3 -bottom-0.5 h-px bg-gradient-to-r from-transparent via-indigo-400 to-transparent"
                  />
                ) : null}
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
          {mounted && isConnected && address ? (
            <div ref={addressMenuRef} className="relative">
              <button
                onClick={() => setAddressMenuOpen((v) => !v)}
                aria-expanded={addressMenuOpen}
                aria-haspopup="menu"
                className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30 hover:bg-indigo-500/15 transition-colors"
              >
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-white text-xs font-mono">
                  {shortenAddress(address)}
                </span>
                <svg
                  className={`w-3 h-3 text-[#94A3B8] transition-transform duration-150 ${
                    addressMenuOpen ? "rotate-180" : ""
                  }`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" d="M6 9l6 6 6-6" />
                </svg>
              </button>

              {addressMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 mt-2 w-52 rounded-xl border border-[#2D2D44] bg-[#13133A]/95 backdrop-blur-md shadow-2xl shadow-black/40 overflow-hidden animate-slideDown"
                >
                  <button
                    role="menuitem"
                    onClick={handleCopyAddress}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-[#94A3B8] hover:text-white hover:bg-white/5 transition-colors text-left"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <rect x="9" y="9" width="13" height="13" rx="2" />
                      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                    </svg>
                    Copy address
                  </button>
                  <a
                    role="menuitem"
                    href={`https://liteforge.explorer.caldera.xyz/address/${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-[#94A3B8] hover:text-white hover:bg-white/5 transition-colors"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
                      <path d="M15 3h6v6" />
                      <path d="M10 14L21 3" />
                    </svg>
                    View on Explorer
                  </a>
                  <div className="h-px bg-[#2D2D44]" />
                  <button
                    role="menuitem"
                    onClick={() => {
                      setAddressMenuOpen(false);
                      disconnect();
                    }}
                    className="w-full flex items-center gap-2 px-3.5 py-2.5 text-sm text-red-300 hover:text-red-200 hover:bg-red-500/10 transition-colors text-left"
                    style={{ fontFamily: "var(--font-departure)" }}
                  >
                    <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M16 17l5-5-5-5M21 12H9M9 21H4a2 2 0 01-2-2V5a2 2 0 012-2h5" />
                    </svg>
                    Disconnect
                  </button>
                </div>
              ) : null}

              {/* Mobile: compact address pill (no dropdown) */}
              <div className="sm:hidden flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span className="text-white text-[11px] font-mono">
                  {shortenAddress(address)}
                </span>
              </div>
            </div>
          ) : mounted ? (
            <button
              onClick={handleConnect}
              disabled={isPending}
              className="relative px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed active:translate-y-px overflow-hidden group"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              <span
                aria-hidden="true"
                className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent"
              />
              <span className="relative flex items-center gap-1.5">
                {isPending ? (
                  <>
                    <span className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />
                    CONNECTING...
                  </>
                ) : (
                  <>
                    <svg width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M21 12V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h7" />
                      <path d="M16 16l2 2 4-4" />
                    </svg>
                    CONNECT WALLET
                  </>
                )}
              </span>
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
              className={`block w-5 h-px bg-white transition-all duration-200 ${
                mobileMenuOpen ? "rotate-45 translate-y-1.5" : ""
              }`}
            />
            <span
              className={`block w-5 h-px bg-white transition-all duration-200 ${
                mobileMenuOpen ? "opacity-0" : ""
              }`}
            />
            <span
              className={`block w-5 h-px bg-white transition-all duration-200 ${
                mobileMenuOpen ? "-rotate-45 -translate-y-1.5" : ""
              }`}
            />
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <nav
          key="mobile-menu"
          className="md:hidden border-t border-[#2D2D44] px-4 py-3 space-y-0.5 animate-slideDown"
        >
          {NAV_LINKS.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm transition-all duration-150",
                  active
                    ? "text-white bg-white/5"
                    : "text-[#64748B] hover:text-white hover:bg-white/5",
                ].join(" ")}
                style={{ fontFamily: "var(--font-departure)" }}
              >
                {active ? (
                  <span aria-hidden="true" className="w-1 h-4 rounded-full bg-indigo-400" />
                ) : null}
                {link.label}
              </Link>
            );
          })}
          <a
            href="https://x.com/0xnothing_net"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-[#64748B] hover:text-white hover:bg-white/5 transition-colors"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            Follow on X
          </a>
          {mounted && isConnected ? (
            <button
              onClick={() => disconnect()}
              className="w-full flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-red-300 hover:text-red-200 hover:bg-red-500/10 transition-colors text-left"
              style={{ fontFamily: "var(--font-departure)" }}
            >
              <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M16 17l5-5-5-5M21 12H9M9 21H4a2 2 0 01-2-2V5a2 2 0 012-2h5" />
              </svg>
              Disconnect
            </button>
          ) : null}
        </nav>
      ) : null}
    </header>
  );
}
