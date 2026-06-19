"use client";

import { PMHeader } from "@/components/PixelHeader";

export default function PMLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen" style={{ fontFamily: "var(--font-departure)" }}>
      <PMHeader />
      <div className="max-w-7xl mx-auto px-4 py-6">
        {children}
      </div>
    </div>
  );
}