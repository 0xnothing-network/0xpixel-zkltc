import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "0xNothing — Nothing to Every",
  description: "Where pixels become possibilities. Create, collect, and trade unique pixel art NFTs on the LitVM LiteForge network.",
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
    other: [
      { url: "/favicon.svg", rel: "alternate icon", type: "image/svg+xml" },
    ],
  },
};

export default function Home() {
  return (
    <div className="min-h-screen flex flex-col" style={{ fontFamily: "var(--font-departure)" }}>
      <div className="fixed inset-0 bg-[#080808] -z-10" />

      <header className="relative z-10 px-6 py-5 border-b border-white/[0.04]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/0xNothing.jpg"
              alt="0xNothing"
              className="w-8 h-8 object-cover"
            />
            <span className="text-white/80 text-xs tracking-widest uppercase">
              0xNothing
            </span>
          </div>

          <a
            href="https://x.com/0xnothing_net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-white/25 hover:text-white/60 transition-colors duration-200"
            aria-label="X / Twitter"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
        </div>
      </header>

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-24">
        <div className="max-w-4xl mx-auto text-center">

          <h1
            className="text-white antialiased"
            style={{
              fontFamily: "var(--font-departure), monospace",
              fontSize: "clamp(3.5rem, 13vw, 11rem)",
              fontWeight: 700,
              letterSpacing: "0.02em",
              lineHeight: 1.05,
            }}
          >
            NOTHING
          </h1>

          <h1
            className="text-white antialiased mb-4"
            style={{
              fontFamily: "var(--font-departure), monospace",
              fontSize: "clamp(2rem, 6vw, 4.5rem)",
              fontWeight: 700,
              letterSpacing: "0.02em",
              lineHeight: 1.1,
            }}
          >
            to everything
          </h1>

          <div className="mt-20 flex flex-col sm:flex-row gap-3 justify-center items-center">
            <Link
              href="/0xpixel"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] tracking-widest uppercase bg-white text-black hover:bg-white/90 transition-colors duration-150 rounded-none"
              style={{ fontFamily: "var(--font-departure), monospace" }}
            >
              <span>0xPixel</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              href="/0xdex"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] tracking-widest uppercase bg-indigo-600 text-white hover:bg-indigo-500 transition-colors duration-150 rounded-none"
              style={{ fontFamily: "var(--font-departure), monospace" }}
            >
              <span>0xDex</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              href="/0xfactory"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] tracking-widest uppercase bg-amber-600 text-white hover:bg-amber-500 transition-colors duration-150 rounded-none"
              style={{ fontFamily: "var(--font-departure), monospace" }}
            >
              <span>0xFactory</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </Link>
            <Link
              href="/protocol"
              className="inline-flex items-center gap-2 px-5 py-2.5 text-[11px] tracking-widest uppercase bg-white/10 text-white hover:bg-white/20 transition-colors duration-150 rounded-none border border-white/20"
              style={{ fontFamily: "var(--font-departure), monospace" }}
            >
              <span>Protocol</span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
              </svg>
            </Link>
          </div>

        </div>
      </main>

      <footer className="relative z-10 px-6 py-8 border-t border-white/[0.04]">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span
            className="text-white/[0.06] uppercase"
            style={{ fontFamily: "var(--font-departure), monospace", fontSize: "9px", letterSpacing: "0.4em" }}
          >
            LitVM LiteForge
          </span>
          <span
            className="text-white/[0.06] uppercase"
            style={{ fontFamily: "var(--font-departure), monospace", fontSize: "9px", letterSpacing: "0.4em" }}
          >
            2026
          </span>
        </div>
      </footer>
    </div>
  );
}
