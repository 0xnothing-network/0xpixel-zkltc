"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Canvas } from "@/components/Canvas";
import { Toolbar } from "@/components/Toolbar";
import { MintPanel } from "@/components/MintPanel";
import { AIPromptGenerator } from "@/components/AIPromptGenerator";

const MAX_HISTORY = 50;

function makeEmptyGrid(gridSize: number): string[][] {
  return Array.from({ length: gridSize }, () =>
    Array.from({ length: gridSize }, () => "transparent")
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
  const [mounted, setMounted] = useState(false);

  const pixelDataRef = useRef(pixelData);
  const historyRef = useRef(history);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    setPixelData(makeEmptyGrid(gridSize));
    setHistory([]);
  }, [gridSize]);

  useEffect(() => {
    pixelDataRef.current = pixelData;
  }, [pixelData]);

  useEffect(() => {
    historyRef.current = history;
  }, [history]);

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

  const handleMintSuccess = useCallback(() => {
    // intentionally silent — user can navigate to /pixel/gallery to see the new NFT
  }, []);

  const setSelectedColorStable = useCallback((c: string) => setSelectedColor(c), []);
  const setGridSizeStable = useCallback((s: number) => setGridSize(s), []);

  const canvasMemo = useMemo(
    () => ({
      gridSize,
      pixelData,
      setPixelData,
      selectedColor,
      onColorPick: setSelectedColorStable,
      onStrokeStart: handleStrokeStart,
      onUndo: handleUndo,
      canUndo,
    }),
    [gridSize, pixelData, setPixelData, selectedColor, setSelectedColorStable, handleStrokeStart, handleUndo, canUndo]
  );

  if (!mounted) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-20 flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "var(--font-departure)" }}>
      <section className="pixel-hero-anim relative overflow-hidden border-b border-white/5">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(99,102,241,0.15) 0%, transparent 60%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-4 pt-10 pb-8 text-center">
          <h1
            className="pixel-hero-anim text-4xl md:text-5xl font-bold text-white mb-3 tracking-tight leading-tight"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Create your{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
              pixel masterpiece
            </span>
          </h1>
          <p
            className="pixel-hero-anim text-[#94A3B8] text-base md:text-lg max-w-md mx-auto"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            Draw. Mint. Trade on LitVM.
          </p>
        </div>
      </section>

      <main className="max-w-7xl mx-auto px-4 pt-6 pb-12">
        <div className="grid xl:grid-cols-[280px_1fr_360px] gap-6 items-start">
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
            <Canvas {...canvasMemo} />
          </div>

          <div className="order-3 space-y-4">
            <MintPanel
              pixelData={pixelData}
              gridSize={gridSize}
              onMintSuccess={handleMintSuccess}
            />
            <AIPromptGenerator
              gridSize={gridSize}
              onApplyPixelData={handleApplyPixelData}
            />
          </div>
        </div>
      </main>

      <footer className="border-t border-white/5 py-5 mt-8">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <Link
            href="/"
            className="flex items-center gap-2 text-[#64748B] text-xs hover:text-white transition-colors"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            <Image
              src="/0xNothing-by.jpg"
              alt="0xNothing"
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
    </div>
  );
}

