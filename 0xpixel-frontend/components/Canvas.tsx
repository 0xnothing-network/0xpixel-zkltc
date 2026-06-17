"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { downloadAsPNG, downloadAsJSON, pixelDataToJSON } from "@/lib/gridParser";

interface CanvasProps {
  gridSize: number;
  pixelData: string[][];
  setPixelData: React.Dispatch<React.SetStateAction<string[][]>>;
  selectedColor: string;
  onColorPick?: (color: string) => void;
  onStrokeStart?: (dataBeforeStroke: string[][]) => void;
  onUndo?: () => void;
  canUndo?: boolean;
}

type Tool = "pencil" | "eraser" | "fill" | "picker";
type Symmetry = "none" | "horizontal" | "vertical" | "both";

const BRUSH_SIZES = [1, 2, 3, 4];
const SUBDIVISION_OPTIONS = [0, 2, 4, 8];

export function Canvas({
  gridSize,
  pixelData,
  setPixelData,
  selectedColor,
  onColorPick,
  onStrokeStart,
  onUndo,
  canUndo,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const isDrawingRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0 });
  const currentToolRef = useRef<Tool>("pencil");
  const selectedColorRef = useRef(selectedColor);
  const pixelDataRef = useRef(pixelData);
  const strokeSnapshotRef = useRef<string[][] | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [currentTool, setCurrentTool] = useState<Tool>("pencil");
  const [brushSize, setBrushSize] = useState(1);
  const [symmetry, setSymmetry] = useState<Symmetry>("none");
  const [subdivision, setSubdivision] = useState(0);

  const brushSizeRef = useRef(brushSize);
  const symmetryRef = useRef(symmetry);

  useEffect(() => { currentToolRef.current = currentTool; }, [currentTool]);
  useEffect(() => { selectedColorRef.current = selectedColor; }, [selectedColor]);
  useEffect(() => { pixelDataRef.current = pixelData; }, [pixelData]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { symmetryRef.current = symmetry; }, [symmetry]);

  const getGridCoords = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return null;
    const rect = canvas.getBoundingClientRect();
    const containerSize = Math.min(container.clientWidth, container.clientHeight);
    const cs = Math.floor(containerSize / gridSize);
    const gridDisplaySize = cs * gridSize * zoom;
    const offsetX = (container.clientWidth - gridDisplaySize) / 2 - pan.x * zoom;
    const offsetY = (container.clientHeight - gridDisplaySize) / 2 - pan.y * zoom;
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const gridX = Math.floor((clickX - offsetX) / (cs * zoom));
    const gridY = Math.floor((clickY - offsetY) / (cs * zoom));
    return { x: gridX, y: gridY, cs, offsetX, offsetY, gridDisplaySize };
  }, [gridSize, zoom, pan]);

  const drawGrid = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const containerSize = Math.min(container.clientWidth, container.clientHeight);
      const cs = Math.floor(containerSize / gridSize);
      const gridDisplaySize = cs * gridSize * zoom;
      const offsetX = (container.clientWidth - gridDisplaySize) / 2 - pan.x * zoom;
      const offsetY = (container.clientHeight - gridDisplaySize) / 2 - pan.y * zoom;

      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;

      ctx.fillStyle = "#0F0F23";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.fillStyle = "#1A1A2E";
      ctx.fillRect(offsetX, offsetY, gridDisplaySize, gridDisplaySize);

      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          const color = pixelData[y]?.[x];
          if (color && color !== "transparent") {
            ctx.fillStyle = color;
            const px = offsetX + x * cs * zoom;
            const py = offsetY + y * cs * zoom;
            ctx.fillRect(px, py, cs * zoom, cs * zoom);

            ctx.fillStyle = "rgba(255,255,255,0.12)";
            ctx.fillRect(px, py, cs * zoom, 1);
            ctx.fillRect(px, py, 1, cs * zoom);

            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fillRect(px, py + cs * zoom - 1, cs * zoom, 1);
            ctx.fillRect(px + cs * zoom - 1, py, 1, cs * zoom);
          }
        }
      }

      ctx.strokeStyle = zoom >= 1.5 ? "#252540" : "#1F1F3A";
      ctx.lineWidth = zoom >= 1.5 ? 1 : 0.5;
      for (let i = 0; i <= gridSize; i++) {
        const px = offsetX + i * cs * zoom;
        ctx.beginPath();
        ctx.moveTo(px, offsetY);
        ctx.lineTo(px, offsetY + gridDisplaySize);
        ctx.stroke();

        const py = offsetY + i * cs * zoom;
        ctx.beginPath();
        ctx.moveTo(offsetX, py);
        ctx.lineTo(offsetX + gridDisplaySize, py);
        ctx.stroke();
      }

      const centerH = offsetX + gridDisplaySize / 2;
      const centerV = offsetY + gridDisplaySize / 2;

      if (symmetry === "horizontal" || symmetry === "both") {
        ctx.strokeStyle = "rgba(255, 100, 100, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(centerH, offsetY);
        ctx.lineTo(centerH, offsetY + gridDisplaySize);
        ctx.stroke();
      }

      if (symmetry === "vertical" || symmetry === "both") {
        ctx.strokeStyle = "rgba(100, 100, 255, 0.4)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(offsetX, centerV);
        ctx.lineTo(offsetX + gridDisplaySize, centerV);
        ctx.stroke();
      }

      if (subdivision > 0) {
        ctx.strokeStyle = "rgba(100, 255, 150, 0.25)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        const subCount = gridSize / subdivision;
        for (let i = 1; i < subCount; i++) {
          const px = offsetX + i * subdivision * cs * zoom;
          ctx.beginPath();
          ctx.moveTo(px, offsetY);
          ctx.lineTo(px, offsetY + gridDisplaySize);
          ctx.stroke();

          const py = offsetY + i * subdivision * cs * zoom;
          ctx.beginPath();
          ctx.moveTo(offsetX, py);
          ctx.lineTo(offsetX + gridDisplaySize, py);
          ctx.stroke();
        }
      }

      ctx.setLineDash([]);
    });
  }, [pixelData, gridSize, zoom, pan, symmetry, subdivision]);

  const drawPreview = useCallback((gridX: number, gridY: number) => {
    const previewCanvas = previewCanvasRef.current;
    const container = containerRef.current;
    if (!previewCanvas || !container) return;
    const pctx = previewCanvas.getContext("2d");
    if (!pctx) return;

    const containerSize = Math.min(container.clientWidth, container.clientHeight);
    const cs = Math.floor(containerSize / gridSize);
    const gridDisplaySize = cs * gridSize * zoom;
    const offsetX = (container.clientWidth - gridDisplaySize) / 2 - pan.x * zoom;
    const offsetY = (container.clientHeight - gridDisplaySize) / 2 - pan.y * zoom;

    previewCanvas.width = container.clientWidth;
    previewCanvas.height = container.clientHeight;

    pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

    const color = selectedColorRef.current;
    const tool = currentToolRef.current;
    const half = Math.floor(brushSizeRef.current / 2);

    const paintPixel = (px: number, py: number) => {
      if (px < 0 || px >= gridSize || py < 0 || py >= gridSize) return;
      const drawX = offsetX + px * cs * zoom;
      const drawY = offsetY + py * cs * zoom;
      if (tool === "eraser") {
        pctx.fillStyle = "rgba(255, 80, 80, 0.4)";
        pctx.strokeStyle = "rgba(255, 80, 80, 0.8)";
      } else {
        pctx.fillStyle = color + "60";
        pctx.strokeStyle = color + "cc";
      }
      pctx.fillRect(drawX, drawY, cs * zoom, cs * zoom);
      pctx.lineWidth = 1.5;
      pctx.strokeRect(drawX + 0.5, drawY + 0.5, cs * zoom - 1, cs * zoom - 1);
    };

    const paintBrush = (cx: number, cy: number) => {
      for (let dy = -half; dy < brushSizeRef.current - half; dy++) {
        for (let dx = -half; dx < brushSizeRef.current - half; dx++) {
          paintPixel(cx + dx, cy + dy);
        }
      }
    };

    paintBrush(gridX, gridY);

    const sym = symmetryRef.current;
    if (sym !== "none") {
      const mirrorH = gridSize - 1 - gridX;
      const mirrorV = gridSize - 1 - gridY;
      if (sym === "horizontal" || sym === "both") {
        paintBrush(mirrorH, gridY);
      }
      if (sym === "vertical" || sym === "both") {
        paintBrush(gridX, mirrorV);
      }
      if (sym === "both") {
        paintBrush(mirrorH, mirrorV);
      }
    }
  }, [gridSize, zoom, pan]);

  useEffect(() => {
    drawGrid();
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [drawGrid]);

  useEffect(() => {
    const handleResize = () => drawGrid();
    window.addEventListener("resize", handleResize, { passive: true });
    return () => window.removeEventListener("resize", handleResize);
  }, [drawGrid]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "z") {
        e.preventDefault();
        onUndo?.();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo]);

  const floodFill = useCallback((startX: number, startY: number, fillColor: string) => {
    const targetColor = pixelData[startY]?.[startX] || "transparent";
    if (targetColor === fillColor) return;

    const newData = pixelData.map(row => [...row]);
    const stack: [number, number][] = [[startX, startY]];
    const visited = new Set<string>();

    while (stack.length > 0) {
      const [x, y] = stack.pop()!;
      const key = `${x},${y}`;
      if (visited.has(key)) continue;
      visited.add(key);

      if (
        x < 0 || x >= gridSize ||
        y < 0 || y >= gridSize ||
        (newData[y]?.[x] || "transparent") !== targetColor
      ) continue;

      newData[y][x] = fillColor;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    setPixelData(newData);
  }, [pixelData, gridSize, setPixelData]);

  const paintPixels = useCallback((gridX: number, gridY: number, tool: Tool, color: string) => {
    const fillColor = tool === "eraser" ? "transparent" : color;
    const half = Math.floor(brushSize / 2);

    const applyToPixel = (px: number, py: number) => {
      if (px < 0 || px >= gridSize || py < 0 || py >= gridSize) return;
      if (pixelDataRef.current[py]?.[px] === fillColor) return;
      setPixelData(prev => {
        const next = prev.map(row => [...row]);
        next[py][px] = fillColor;
        return next;
      });
    };

    for (let dy = -half; dy < brushSize - half; dy++) {
      for (let dx = -half; dx < brushSize - half; dx++) {
        const cx = gridX + dx;
        const cy = gridY + dy;
        applyToPixel(cx, cy);

        if (symmetry !== "none") {
          const mirrorH = gridSize - 1 - cx;
          const mirrorV = gridSize - 1 - cy;
          if (symmetry === "horizontal" || symmetry === "both") {
            applyToPixel(mirrorH, cy);
          }
          if (symmetry === "vertical" || symmetry === "both") {
            applyToPixel(cx, mirrorV);
          }
          if (symmetry === "both") {
            applyToPixel(mirrorH, mirrorV);
          }
        }
      }
    }
  }, [gridSize, brushSize, symmetry, setPixelData]);

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const coords = getGridCoords(e.clientX, e.clientY);
    if (!coords || coords.x < 0 || coords.x >= gridSize || coords.y < 0 || coords.y >= gridSize) return;

    isDrawingRef.current = true;
    const tool = currentToolRef.current;

    if (tool === "pencil" || tool === "eraser") {
      if (!strokeSnapshotRef.current) {
        strokeSnapshotRef.current = pixelDataRef.current.map(row => [...row]);
        onStrokeStart?.(strokeSnapshotRef.current);
      }
    }

    if (tool === "fill") {
      isDrawingRef.current = false;
      floodFill(coords.x, coords.y, selectedColorRef.current);
      onStrokeStart?.(pixelDataRef.current);
      return;
    }

    if (tool === "picker") {
      isDrawingRef.current = false;
      const pickedColor = pixelDataRef.current[coords.y]?.[coords.x];
      if (pickedColor && pickedColor !== "transparent" && onColorPick) {
        onColorPick(pickedColor);
      }
      return;
    }

    strokeSnapshotRef.current = pixelDataRef.current.map(row => [...row]);
    /* eslint-disable react-hooks/exhaustive-deps */
    onStrokeStart?.(strokeSnapshotRef.current);
    paintPixels(coords.x, coords.y, tool, selectedColorRef.current);
  }, [getGridCoords, gridSize, floodFill, paintPixels, onStrokeStart, onColorPick]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isPanningRef.current) {
      const dx = (e.clientX - panStartRef.current.x) / zoom;
      const dy = (e.clientY - panStartRef.current.y) / zoom;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }

    const coords = getGridCoords(e.clientX, e.clientY);

    if (!isDrawingRef.current) {
      if (coords) {
        if (coords.x >= 0 && coords.x < gridSize && coords.y >= 0 && coords.y < gridSize) {
          drawPreview(coords.x, coords.y);
        } else {
          const previewCanvas = previewCanvasRef.current;
          if (previewCanvas) {
            const pctx = previewCanvas.getContext("2d");
            if (pctx) pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
          }
        }
      }
      return;
    }

    if (!coords || coords.x < 0 || coords.x >= gridSize || coords.y < 0 || coords.y >= gridSize) return;

    const tool = currentToolRef.current;
    if (tool === "pencil" || tool === "eraser") {
      paintPixels(coords.x, coords.y, tool, selectedColorRef.current);
    }
  }, [getGridCoords, zoom, gridSize, paintPixels, drawPreview]);

  const handleMouseUp = useCallback(() => {
    isDrawingRef.current = false;
    isPanningRef.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isDrawingRef.current = false;
    isPanningRef.current = false;
    const previewCanvas = previewCanvasRef.current;
    if (previewCanvas) {
      const pctx = previewCanvas.getContext("2d");
      if (pctx) pctx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    }
  }, []);

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Toolbar Bar */}
      <div className="flex flex-wrap items-center gap-1.5 justify-center">
        {/* Tools */}
        <div className="flex gap-0.5 bg-[#1A1A2E] rounded-xl p-1 border border-[#2D2D44]">
          <ToolButton active={currentTool === "pencil"} onClick={() => setCurrentTool("pencil")} title="Pencil">
            <PencilIcon />
          </ToolButton>
          <ToolButton active={currentTool === "eraser"} onClick={() => setCurrentTool("eraser")} title="Eraser">
            <EraserIcon />
          </ToolButton>
          <ToolButton active={currentTool === "fill"} onClick={() => setCurrentTool("fill")} title="Fill">
            <FillIcon />
          </ToolButton>
          <ToolButton active={currentTool === "picker"} onClick={() => setCurrentTool("picker")} title="Color Picker">
            <PickerIcon />
          </ToolButton>

          <div className="w-px h-6 bg-[#2D2D44] mx-0.5 self-center" />

          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-100 ${canUndo ? "text-[#94A3B8] hover:text-white hover:bg-white/5" : "text-[#374151] cursor-not-allowed"}`}
          >
            <UndoIcon />
          </button>
        </div>

        {/* Zoom */}
        <div className="flex items-center gap-0.5 bg-[#1A1A2E] rounded-xl p-1 border border-[#2D2D44]">
          <button
            onClick={() => setZoom(z => Math.max(z / 1.5, 0.5))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all"
            title="Zoom Out"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <span className="text-[#94A3B8] text-[10px] w-10 text-center font-mono bg-white/5 rounded-md py-1" style={{ fontFamily: "var(--font-departure)" }}>
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.min(z * 1.5, 10))}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all"
            title="Zoom In"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[#94A3B8] hover:text-white hover:bg-white/5 transition-all text-[10px] font-bold"
            title="Reset View"
            style={{ fontFamily: "var(--font-departure)" }}
          >
            R
          </button>
        </div>

        {/* Brush Size */}
        <div className="flex items-center gap-0.5 bg-[#1A1A2E] rounded-xl p-1 border border-[#2D2D44]">
          <span className="text-[#64748B] text-[9px] px-1 font-mono self-center" style={{ fontFamily: "var(--font-departure)" }}>SZ</span>
          {BRUSH_SIZES.map(size => (
            <button
              key={size}
              onClick={() => setBrushSize(size)}
              title={`Brush ${size}x${size}`}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${
                brushSize === size ? "bg-indigo-500/20 text-indigo-300" : "text-[#64748B] hover:text-white hover:bg-white/5"
              }`}
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {size}
            </button>
          ))}
        </div>

        {/* Symmetry */}
        <div className="flex items-center gap-0.5 bg-[#1A1A2E] rounded-xl p-1 border border-[#2D2D44]">
          <SymmetryButton active={symmetry === "horizontal"} onClick={() => setSymmetry(s => s === "horizontal" ? "none" : "horizontal")} title="Symmetry Horizontal">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20" />
              <path d="M8 6l4-4 4 4" />
              <path d="M8 18l4 4 4-4" />
            </svg>
          </SymmetryButton>
          <SymmetryButton active={symmetry === "vertical"} onClick={() => setSymmetry(s => s === "vertical" ? "none" : "vertical")} title="Symmetry Vertical">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M2 12h20" />
              <path d="M6 8l-4 4 4 4" />
              <path d="M18 8l4 4-4 4" />
            </svg>
          </SymmetryButton>
          <SymmetryButton active={symmetry === "both"} onClick={() => setSymmetry(s => s === "both" ? "none" : "both")} title="Symmetry Both">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v20" />
              <path d="M2 12h20" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
            </svg>
          </SymmetryButton>
        </div>

        {/* Subdivision */}
        <div className="flex items-center gap-0.5 bg-[#1A1A2E] rounded-xl p-1 border border-[#2D2D44]">
          <span className="text-[#64748B] text-[9px] px-1 font-mono self-center" style={{ fontFamily: "var(--font-departure)" }}>GRID</span>
          {SUBDIVISION_OPTIONS.map(opt => (
            <button
              key={opt}
              onClick={() => setSubdivision(opt)}
              title={opt === 0 ? "No grid" : `${opt}x${opt} sub-grid`}
              className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all ${
                subdivision === opt ? "bg-indigo-500/20 text-indigo-300" : "text-[#64748B] hover:text-white hover:bg-white/5"
              }`}
              style={{ fontFamily: "var(--font-departure)" }}
            >
              {opt === 0 ? "-" : opt}
            </button>
          ))}
        </div>

        <ExportMenu pixelData={pixelData} gridSize={gridSize} />
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="w-full max-w-[480px] flex justify-center items-center overflow-hidden bg-[#0F0F23] rounded-xl border border-[#2D2D44] relative"
        style={{ aspectRatio: "1 / 1" }}
      >
        <canvas
          ref={canvasRef}
          style={{
            position: "absolute",
            imageRendering: "pixelated",
            cursor: currentTool === "fill" ? "cell" : currentTool === "picker" ? "crosshair" : "crosshair",
            width: "100%",
            height: "100%",
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave}
          onWheel={e => { e.preventDefault(); setZoom(z => e.deltaY < 0 ? Math.min(z * 1.2, 10) : Math.max(z / 1.2, 0.5)); }}
          onContextMenu={e => e.preventDefault()}
        />
        <canvas
          ref={previewCanvasRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            imageRendering: "pixelated",
          }}
        />
      </div>

      <p className="text-[#374151] text-[10px]" style={{ fontFamily: "var(--font-departure)" }}>
        Scroll to zoom &middot; Right-click to pan
      </p>
    </div>
  );
}

function ToolButton({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-100 ${
        active ? "bg-indigo-500/20 text-indigo-300" : "text-[#64748B] hover:text-white hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function SymmetryButton({ children, active, onClick, title }: { children: React.ReactNode; active: boolean; onClick: () => void; title: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-100 ${
        active ? "bg-indigo-500/20 text-indigo-300" : "text-[#64748B] hover:text-white hover:bg-white/5"
      }`}
    >
      {children}
    </button>
  );
}

function PencilIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
      <path d="M22 21H7" />
      <path d="m5 11 9 9" />
    </svg>
  );
}

function FillIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m19 11-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11Z" />
      <path d="m5 2 5 5" />
      <path d="M2 13h15" />
      <path d="M22 20a2 2 0 1 1-4 0c0-1.6 1.7-2.4 2-4 .3 1.6 2 2.4 2 4Z" />
    </svg>
  );
}

function PickerIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m2 22 1-1h3l9-9" />
      <path d="M3 21v-3l9-9" />
      <path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7v6h6" />
      <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
    </svg>
  );
}

function ExportMenu({ pixelData, gridSize }: { pixelData: string[][]; gridSize: number }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    if (open) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const hasDrawing = pixelData.some(row => row.some(cell => cell !== "transparent"));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="pixel-btn pixel-btn-secondary pixel-btn-sm flex items-center gap-1 text-[#64748B] hover:text-white"
        style={{ fontFamily: "var(--font-departure)" }}
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="7 10 12 15 17 10" />
          <line x1="12" y1="15" x2="12" y2="3" />
        </svg>
        EXPORT
        <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transition: "transform 80ms", transform: open ? "rotate(180deg)" : "" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-50 min-w-[160px]"
          style={{
            background: "#1A1A2E",
            border: "1px solid #2D2D44",
            boxShadow: "4px 4px 0 0 #060614",
            borderRadius: "8px",
          }}
        >
          {[
            {
              label: "COPY GRID DATA",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect width="14" height="14" x="8" y="8" rx="2" ry="2" /><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" /></svg>,
              onClick: () => { navigator.clipboard.writeText(pixelDataToJSON(pixelData, gridSize)); setOpen(false); },
            },
            {
              label: "PNG IMAGE",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>,
              onClick: () => { downloadAsPNG(pixelData, gridSize); setOpen(false); },
            },
            {
              label: "DOWNLOAD GRID DATA",
              icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>,
              onClick: () => { downloadAsJSON(pixelData, gridSize); setOpen(false); },
            },
          ].map((item, i, arr) => (
            <div key={item.label}>
              <button
                onClick={item.onClick}
                disabled={!hasDrawing}
                className="w-full px-3 py-2.5 text-left flex items-center gap-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed text-[#94A3B8] hover:text-white hover:bg-white/5"
                style={{ fontFamily: "var(--font-departure)", fontSize: 9, fontWeight: 700, letterSpacing: "0.05em" }}
              >
                {item.icon}
                {item.label}
              </button>
              {i < arr.length - 1 && <div style={{ height: 1, background: "#2D2D44" }} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
