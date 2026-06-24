'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import CandleChart from './CandleChart';

interface ChartWindowProps {
  pairId: string;
  token0: string;
  token1: string;
  pairLabel?: string;
  subgraphUrl?: string;
  initialTimeframe?: number;
  onClose: () => void;
}

const COLORS = {
  bg: '#0a0a12',
  border: '#2a2a4a',
  borderBright: '#4a4a7a',
  titleBg: '#0d0d18',
  text: '#7878b0',
  textBright: '#d8d8ff',
  accent: '#8888ff',
  bullish: '#00ff88',
  bearish: '#ff4466',
};

export default function ChartWindow({
  pairId,
  token0,
  token1,
  pairLabel,
  subgraphUrl,
  initialTimeframe = 5,
  onClose,
}: ChartWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const prevState = useRef({ x: 100, y: 80, w: 780, h: 520 });
  const [pos, setPos] = useState({ x: 100, y: 80 });
  const [size, setSize] = useState({ w: 780, h: 520 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [fsHeight, setFsHeight] = useState(900);
  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizing = useRef(false);
  const resizeDir = useRef('');
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });

  // ── Drag titlebar ────────────────────────────────────────────
  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.titlebar-btn')) return;
    dragging.current = true;
    dragOffset.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
    e.preventDefault();
  }, [pos]);

  // ── Resize from edges ───────────────────────────────────────
  const onEdgeMouseDown = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeDir.current = dir;
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, px: pos.x, py: pos.y };
  }, [size, pos]);

  // ── Minimize ───────────────────────────────────────────────
  const toggleMinimize = useCallback(() => {
    setIsMinimized(m => !m);
  }, []);

  // ── Fullscreen ──────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(f => {
      if (!f) {
        prevState.current = { x: pos.x, y: pos.y, w: size.w, h: size.h };
        return true;
      } else {
        setPos({ x: prevState.current.x, y: prevState.current.y });
        setSize({ w: prevState.current.w, h: prevState.current.h });
        return false;
      }
    });
  }, [pos, size]);

  // ── Mouse move / up ─────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y });
      }
      if (resizing.current) {
        const { x, y, w, h, px, py } = resizeStart.current;
        const dx = e.clientX - x;
        const dy = e.clientY - y;
        const dir = resizeDir.current;
        let newW = w, newH = h, newX = px, newY = py;
        if (dir.includes('e')) newW = Math.max(400, w + dx);
        if (dir.includes('s')) newH = Math.max(300, h + dy);
        if (dir.includes('w')) { newW = Math.max(400, w - dx); newX = px + dx; }
        if (dir.includes('n')) { newH = Math.max(300, h - dy); newY = py + dy; }
        setSize({ w: newW, h: newH });
        if (dir.includes('w')) setPos(p => ({ ...p, x: newX }));
        if (dir.includes('n')) setPos(p => ({ ...p, y: newY }));
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Fullscreen height sync ───────────────────────────────────
  useEffect(() => {
    if (!isFullscreen) return;
    setFsHeight(window.innerHeight);
    const onResize = () => setFsHeight(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [isFullscreen]);

  const fs = isFullscreen;

  return (
    <div
      ref={windowRef}
      style={{
        position: 'fixed',
        left: fs ? 0 : pos.x,
        top: fs ? 0 : pos.y,
        width: fs ? '100vw' : size.w,
        height: fs ? `${fsHeight}px` : isMinimized ? 36 : size.h,
        zIndex: fs ? 99999 : 9999,
        display: 'flex',
        flexDirection: 'column',
        background: COLORS.bg,
      }}
    >
      {/* ── Titlebar ── */}
      <div
        onMouseDown={onTitleMouseDown}
        style={{
          height: 36,
          background: COLORS.titleBg,
          borderBottom: `2px solid ${COLORS.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          cursor: fs ? 'default' : 'move',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        {/* Traffic lights */}
        <div style={{ display: 'flex', gap: 5, marginRight: 12 }}>
          <button
            className="titlebar-btn"
            onClick={onClose}
            style={{
              width: 18, height: 18,
              background: '#ff4466',
              border: `2px solid #aa2244`,
              boxShadow: 'inset 1px 1px 0 #ff8899, inset -1px -1px 0 #660011',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 6, color: '#220008',
              lineHeight: 1,
            }}
            title="Close"
          >
            X
          </button>
          <button
            className="titlebar-btn"
            onClick={toggleMinimize}
            style={{
              width: 18, height: 18,
              background: '#ffcc00',
              border: `2px solid #aa8800`,
              boxShadow: 'inset 1px 1px 0 #ffee88, inset -1px -1px 0 #664400',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 7, color: '#443300',
              lineHeight: 1,
            }}
            title="Minimize"
          >
            {isMinimized ? '+' : '—'}
          </button>
          <button
            className="titlebar-btn"
            onClick={toggleFullscreen}
            style={{
              width: 18, height: 18,
              background: '#00ff88',
              border: `2px solid #00aa55`,
              boxShadow: 'inset 1px 1px 0 #88ffcc, inset -1px -1px 0 #005522',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 5, color: '#002211',
              lineHeight: 1,
            }}
            title={fs ? 'Restore' : 'Maximize'}
          >
            {fs ? '◀' : '□'}
          </button>
        </div>

        {/* Title */}
        <span
          style={{
            flex: 1, textAlign: 'center',
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 7, color: COLORS.accent, letterSpacing: '0.08em',
          }}
        >
          {pairLabel || `${token0?.slice(0, 6)}... / ${token1?.slice(0, 6)}...`} — NOTHING
        </span>

        <span
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6, color: COLORS.text,
          }}
        >
          {pairId ? `${pairId.slice(0, 4)}...${pairId.slice(-2)}` : ''}
        </span>
      </div>

      {/* ── Chart ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: isMinimized ? 'none' : 'flex' }}>
        <CandleChart
          pairId={pairId}
          token0={token0}
          token1={token1}
          subgraphUrl={subgraphUrl}
          initialTimeframe={initialTimeframe}
          height={(fs ? fsHeight : size.h) - 36}
          enableRealtime={true}
        />
      </div>

      {/* ── Resize handles ── */}
      {!fs && !isMinimized && (['e', 's', 'w', 'n', 'se', 'sw', 'ne', 'nw'] as const).map(dir => {
        const isCorner = dir.length === 2;
        const style: React.CSSProperties = {
          position: 'absolute', zIndex: 10,
          cursor: isCorner
            ? (dir === 'se' || dir === 'nw' ? 'nwse' : 'nesw')
            : (dir === 'e' || dir === 'w' ? 'ew' : 'ns'),
        };
        if (dir.includes('e')) { style.right = 0; style.top = 0; style.bottom = 0; style.width = 6; }
        if (dir.includes('s')) { style.bottom = 0; style.left = 0; style.right = 0; style.height = 6; }
        if (dir.includes('w')) { style.left = 0; style.top = 0; style.bottom = 0; style.width = 6; }
        if (dir.includes('n')) { style.top = 0; style.left = 0; style.right = 0; style.height = 6; }
        return <div key={dir} style={style} onMouseDown={e => onEdgeMouseDown(e, dir)} />;
      })}
    </div>
  );
}
