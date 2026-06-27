"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";

const MAX_HISTORY = 50;

function makeEmptyGrid(gridSize: number): string[][] {
  return Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => "transparent")
  );
}

const Toolbar = dynamic(
  () => import("@/components/Toolbar").then((m) => m.Toolbar),
  { ssr: false, loading: () => <PanelSkeleton label="Toolbar" /> }
);
const Canvas = dynamic(
  () => import("@/components/Canvas").then((m) => m.Canvas),
  { ssr: false, loading: () => <CanvasSkeleton /> }
);
const MintPanel = dynamic(
  () => import("@/components/MintPanel").then((m) => m.MintPanel),
  { ssr: false, loading: () => <PanelSkeleton label="Mint" /> }
);
const AIPromptGenerator = dynamic(
  () =>
    import("@/components/AIPromptGenerator").then(
      (m) => m.AIPromptGenerator
    ),
  { ssr: false, loading: () => <PanelSkeleton label="AI" /> }
);

function PanelSkeleton({ label }: { label: string }) {
  return (
    <div className="bg-[#1A1A2E] rounded-2xl border border-[#2D2D44] p-4 h-32 animate-pulse flex items-center justify-center">
      <span className="text-[#4D4D64] text-xs" style={{ fontFamily: "var(--font-departure)" }}>
        {label} loading…
      </span>
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div
      className="aspect-square w-full max-w-[640px] rounded-2xl bg-[#0F0F23] border border-[#2D2D44] flex items-center justify-center animate-pulse"
      style={{ backgroundImage: "linear-gradient(45deg,#1A1A2E 25%,transparent 25%,transparent 75%,#1A1A2E 75%),linear-gradient(45deg,#1A1A2E 25%,transparent 25%,transparent 75%,#1A1A2E 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }}
    >
      <div className="w-10 h-10 border-3 border-[#8888ff] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

export default function PixelPage() {
  const DEFAULT_GRID_SIZE = 16;
  const [gridSize, setGridSize] = useState(DEFAULT_GRID_SIZE);
  const [pixelData, setPixelData] = useState<string[][]>(() =>
    makeEmptyGrid(DEFAULT_GRID_SIZE)
  );
  const [history, setHistory] = useState<string[][][]>([]);
  const [selectedColor, setSelectedColor] = useState("#6366F1");

  const pixelDataRef = useRef(pixelData);
  const historyRef = useRef(history);

  useEffect(() => {
    setPixelData(makeEmptyGrid(gridSize));
    setHistory([]);
  }, [gridSize]);

  useEffect(() => { pixelDataRef.current = pixelData; }, [pixelData]);
  useEffect(() => { historyRef.current = history; }, [history]);

  const pushHistory = useCallback((snapshot: string[][]) => {
    setHistory((h) => [...h, snapshot.map((row) => [...row])].slice(-MAX_HISTORY));
  }, []);

  const handleClear = useCallback(() => {
    pushHistory(pixelDataRef.current);
    setPixelData(makeEmptyGrid(gridSize));
  }, [gridSize, pushHistory]);

  const handleApplyPixelData = useCallback(
    (newPixelData: string[][]) => {
      pushHistory(pixelDataRef.current);
      setPixelData(newPixelData);
    },
    [pushHistory]
  );

  const handleStrokeStart = useCallback(() => {
    pushHistory(pixelDataRef.current);
  }, [pushHistory]);

  const handleUndo = useCallback(() => {
    if (historyRef.current.length === 0) return;
    const prev = historyRef.current[historyRef.current.length - 1];
    setHistory((h) => h.slice(0, -1));
    setPixelData(prev);
  }, []);

  const canUndo = history.length > 0;

  const setSelectedColorStable = useCallback((c: string) => setSelectedColor(c), []);
  const setGridSizeStable = useCallback((s: number) => setGridSize(s), []);

  return (
    <div style={{ fontFamily: "var(--font-departure)" }}>
      <section className="relative overflow-hidden border-b border-white/5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.15) 0%, transparent 60%)",
          }}
        />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-[#8888ff]/10 rounded-full blur-3xl animate-pulse" />
        <div
          className="absolute bottom-10 right-1/4 w-64 h-64 bg-[#8888ff]/10 rounded-full blur-3xl animate-pulse"
          style={{ animationDelay: "1s" }}
        />

        <div className="max-w-7xl mx-auto px-5 pt-12 pb-10 text-center relative">
          <h1
            className="text-3xl md:text-5xl font-bold text-white mb-4 tracking-tight leading-tight hero-fade-in"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Create your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#8888ff] to-[#AAAADD]">
              pixel masterpiece
            </span>
          </h1>
          <p
            className="text-[#94A3B8] text-base md:text-lg max-w-md mx-auto hero-fade-in-delay"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Draw. Mint. Trade on LitVM.
          </p>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-5 pt-8 pb-16">
        <div className="grid xl:grid-cols-[300px_1fr_380px] gap-6 items-start">
          <div className="order-2 xl:order-1">
            <div className="xl:sticky xl:top-20">
              <Toolbar
                selectedColor={selectedColor}
                onColorChange={setSelectedColorStable}
                gridSize={gridSize}
                onGridSizeChange={setGridSizeStable}
                onClear={handleClear}
              />
            </div>
          </div>

          <div className="order-1 xl:order-2 flex justify-center">
            <Canvas
              gridSize={gridSize}
              pixelData={pixelData}
              setPixelData={setPixelData}
              selectedColor={selectedColor}
              onColorPick={setSelectedColorStable}
              onStrokeStart={handleStrokeStart}
              onUndo={handleUndo}
              canUndo={canUndo}
            />
          </div>

          <div className="order-3 space-y-4">
            <MintPanel
              pixelData={pixelData}
              gridSize={gridSize}
              onMintSuccess={() => {}}
            />
            <AIPromptGenerator
              gridSize={gridSize}
              onApplyPixelData={handleApplyPixelData}
            />
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/5 py-5 mt-8">
      <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <Link
          href="/"
          className="flex items-center gap-2 text-[#64748B] text-xs hover:text-white transition-colors"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/0xNothing-by.jpg"
            alt="0xNothing"
            loading="lazy"
            width={20}
            height={20}
            className="w-5 h-5 rounded-full object-cover"
          />
          <span>by 0xNothing</span>
        </Link>
        <p
          className="text-[#374151] text-xs"
          style={{ fontFamily: "var(--font-departure)" }}
        >
          Built on LitVM
        </p>
      </div>
    </footer>
  );
}
