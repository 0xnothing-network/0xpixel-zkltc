'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import CandleChart from './CandleChart';
import type { TfValue } from './CandleChart';

interface ChartWindowProps {
  pairId: string;
  token0: string;
  token1: string;
  pairLabel?: string;
  subgraphUrl?: string;
  initialPrice?: number | null;
  token0Decimals?: number;
  token1Decimals?: number;
  initialTimeframe?: TfValue;
  onTimeframeChange?: (timeframe: TfValue) => void;
  onClose: () => void;
}

const COLORS = {
  bg: '#000000',
  border: 'rgba(255,255,255,0.28)',
  titleBg: '#030303',
  text: '#cfcfcf',
  accent: '#ffffff',
};

const DEFAULT_POS = { x: 100, y: 80 };
const DEFAULT_SIZE = { w: 780, h: 520 };

export default function ChartWindow({
  pairId,
  token0,
  token1,
  pairLabel,
  subgraphUrl,
  initialPrice,
  token0Decimals = 18,
  token1Decimals = 18,
  initialTimeframe = 240,
  onTimeframeChange,
  onClose,
}: ChartWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const prevState = useRef({ ...DEFAULT_POS, ...DEFAULT_SIZE });
  const [pos, setPos] = useState(DEFAULT_POS);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [fsHeight, setFsHeight] = useState(900);

  const dragging = useRef(false);
  const dragOffset = useRef({ x: 0, y: 0 });
  const resizing = useRef(false);
  const resizeDir = useRef('');
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0, px: 0, py: 0 });
  const moveFrame = useRef<number | null>(null);
  const pendingWindowState = useRef<{ pos?: typeof pos; size?: typeof size }>({});

  useEffect(() => { posRef.current = pos; }, [pos]);
  useEffect(() => { sizeRef.current = size; }, [size]);

  const flushWindowState = useCallback(() => {
    moveFrame.current = null;
    const next = pendingWindowState.current;
    pendingWindowState.current = {};
    if (next.pos) setPos(next.pos);
    if (next.size) setSize(next.size);
  }, []);

  const scheduleWindowState = useCallback((next: { pos?: typeof pos; size?: typeof size }) => {
    pendingWindowState.current = { ...pendingWindowState.current, ...next };
    if (moveFrame.current === null) {
      moveFrame.current = requestAnimationFrame(flushWindowState);
    }
  }, [flushWindowState]);

  useEffect(() => {
    const checkMobile = () => {
      if (window.innerWidth >= 640) return;
      const w = Math.min(window.innerWidth - 16, 420);
      const h = Math.min(window.innerHeight - 80, 480);
      const nextPos = { x: (window.innerWidth - w) / 2, y: 40 };
      const nextSize = { w, h };
      setPos(p => (p.x === nextPos.x && p.y === nextPos.y ? p : nextPos));
      setSize(s => (s.w === nextSize.w && s.h === nextSize.h ? s : nextSize));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const onTitleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.titlebar-btn')) return;
    dragging.current = true;
    const currentPos = posRef.current;
    dragOffset.current = { x: e.clientX - currentPos.x, y: e.clientY - currentPos.y };
    e.preventDefault();
  }, []);

  const onEdgeMouseDown = useCallback((e: React.MouseEvent, dir: string) => {
    e.preventDefault();
    e.stopPropagation();
    resizing.current = true;
    resizeDir.current = dir;
    const currentSize = sizeRef.current;
    const currentPos = posRef.current;
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: currentSize.w,
      h: currentSize.h,
      px: currentPos.x,
      py: currentPos.y,
    };
  }, []);

  const toggleMinimize = useCallback(() => {
    setIsMinimized(m => !m);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(f => {
      if (!f) {
        const currentPos = posRef.current;
        const currentSize = sizeRef.current;
        prevState.current = {
          x: currentPos.x,
          y: currentPos.y,
          w: currentSize.w,
          h: currentSize.h,
        };
        return true;
      }

      setPos({ x: prevState.current.x, y: prevState.current.y });
      setSize({ w: prevState.current.w, h: prevState.current.h });
      return false;
    });
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        scheduleWindowState({
          pos: {
            x: e.clientX - dragOffset.current.x,
            y: e.clientY - dragOffset.current.y,
          },
        });
      }

      if (resizing.current) {
        const { x, y, w, h, px, py } = resizeStart.current;
        const dx = e.clientX - x;
        const dy = e.clientY - y;
        const dir = resizeDir.current;
        const minW = Math.min(400, Math.max(280, window.innerWidth - 16));
        const minH = Math.min(300, Math.max(220, window.innerHeight - 64));
        let newW = w;
        let newH = h;
        let newX = px;
        let newY = py;

        if (dir.includes('e')) newW = Math.max(minW, w + dx);
        if (dir.includes('s')) newH = Math.max(minH, h + dy);
        if (dir.includes('w')) {
          newW = Math.max(minW, w - dx);
          newX = px + (w - newW);
        }
        if (dir.includes('n')) {
          newH = Math.max(minH, h - dy);
          newY = py + (h - newH);
        }

        scheduleWindowState({
          size: { w: newW, h: newH },
          pos: { x: newX, y: newY },
        });
      }
    };

    const onUp = () => {
      dragging.current = false;
      resizing.current = false;
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (moveFrame.current !== null) {
        cancelAnimationFrame(moveFrame.current);
        moveFrame.current = null;
      }
    };
  }, [scheduleWindowState]);

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
        <div style={{ display: 'flex', gap: 5, marginRight: 12 }}>
          <button
            className="titlebar-btn"
            onClick={onClose}
            style={{
              width: 18,
              height: 18,
              background: '#ff4466',
              border: '2px solid #ffffff',
              boxShadow: 'inset 1px 1px 0 #ff9aac, inset -1px -1px 0 #660011',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 6,
              color: '#220008',
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
              width: 18,
              height: 18,
              background: '#ffffff',
              border: '2px solid #ffffff',
              boxShadow: 'inset 1px 1px 0 #ffffff, inset -1px -1px 0 #777777',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 7,
              color: '#000000',
              lineHeight: 1,
            }}
            title="Minimize"
          >
            {isMinimized ? '+' : '-'}
          </button>
          <button
            className="titlebar-btn"
            onClick={toggleFullscreen}
            style={{
              width: 18,
              height: 18,
              background: '#0a0a0a',
              border: '2px solid #ffffff',
              boxShadow: 'inset 1px 1px 0 #444444, inset -1px -1px 0 #000000',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 5,
              color: '#ffffff',
              lineHeight: 1,
            }}
            title={fs ? 'Restore' : 'Maximize'}
          >
            {fs ? '<' : '[]'}
          </button>
        </div>

        <span
          style={{
            flex: 1,
            textAlign: 'center',
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 7,
            color: COLORS.accent,
            letterSpacing: '0.08em',
          }}
        >
          {pairLabel || `${token0?.slice(0, 6)}... / ${token1?.slice(0, 6)}...`}
        </span>

        <span
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6,
            color: COLORS.text,
          }}
        >
          {pairId ? `${pairId.slice(0, 4)}...${pairId.slice(-2)}` : ''}
        </span>
      </div>

      <div style={{ flex: 1, overflow: 'hidden', display: isMinimized ? 'none' : 'flex' }}>
        <CandleChart
          pairId={pairId}
          token0={token0}
          token1={token1}
          subgraphUrl={subgraphUrl}
          initialPrice={initialPrice}
          token0Decimals={token0Decimals}
          token1Decimals={token1Decimals}
          initialTimeframe={initialTimeframe}
          onTimeframeChange={onTimeframeChange}
          height={Math.max(200, (fs ? fsHeight : size.h) - 60)}
          enableRealtime={!isMinimized}
        />
      </div>

      {!fs && !isMinimized && (['e', 's', 'w', 'n', 'se', 'sw', 'ne', 'nw'] as const).map(dir => {
        const isCorner = dir.length === 2;
        const style: React.CSSProperties = {
          position: 'absolute',
          zIndex: 10,
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
