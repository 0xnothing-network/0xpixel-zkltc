'use client';

import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useCandleData, CandleData } from '@/app/hooks/useCandleData';

const TF = [
  { label: '1h',  value: 60    },
  { label: '4h',  value: 240   },
  { label: '12h', value: 720   },
  { label: '1D',  value: 1440  },
  { label: '7D',  value: 10080 },
  { label: '30D', value: 43200 },
] as const;

export type TfValue = typeof TF[number]['value'];

const COLORS = {
  bg:               '#0a0a12',
  panelBg:          '#0d0d18',
  border:           '#2a2a4a',
  text:             '#7878b0',
  textBright:       '#d8d8ff',
  grid:             '#1a1a2e',
  bullish:          '#00ff88',
  bearish:          '#ff4466',
  accent:           '#8888ff',
  toolbarBg:        '#0d0d18',
  toolbarBtn:       '#1a1a2e',
  toolbarBtnActive: '#6a6aff',
};

function formatPrice(v: number) {
  if (!isFinite(v) || v <= 0) return '--';
  if (v >= 1000)    return v.toFixed(2);
  if (v >= 1)       return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6).replace(/\.?0+$/, '');
  return v.toPrecision(6).replace(/\.?0+$/, '');
}

interface CandleChartProps {
  pairId: string;
  token0: string;
  token1: string;
  contractAddress?: `0x${string}`;
  subgraphUrl?: string;
  initialTimeframe?: TfValue;
  height?: number;
  enableRealtime?: boolean;
  invertPrice?: boolean;
  fullscreen?: boolean;
}

function toChartData(candles: CandleData[], invertPrice: boolean): CandlestickData<Time>[] {
  const out: CandlestickData<Time>[] = [];
  for (const c of candles) {
    // Guard: skip candles with invalid time to prevent "Cannot update oldest data" crash
    if (typeof c.time !== 'number' || !isFinite(c.time)) continue;
    if (invertPrice) {
      out.push({
        time: c.time as Time,
        open:  c.open  > 0 ? 1 / c.open  : c.open,
        high:  c.high  > 0 ? 1 / c.low   : c.high,
        low:   c.low   > 0 ? 1 / c.high  : c.low,
        close: c.close > 0 ? 1 / c.close : c.close,
      });
    } else {
      out.push({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close });
    }
  }
  return out;
}

/* ── Memoized sub-components ─────────────────────────────── */

const TfButton = ({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) => (
  <button
    onClick={onClick}
    style={{
      fontFamily:  "'Press Start 2P', monospace",
      fontSize:    6,
      background:  active ? COLORS.toolbarBtnActive : COLORS.toolbarBtn,
      color:       active ? '#000' : COLORS.text,
      border:      `1px solid ${active ? COLORS.accent : COLORS.border}`,
      padding:    '3px 5px',
      cursor:     'pointer',
    }}
  >
    {label}
  </button>
);

const SkeletonBars = () => {
  const bars = useMemo(
    () => Array.from({ length: 6 }, (_, i) => ({
      width:      40 + (i * 17) % 50,
      marginLeft: i % 2 === 0 ? 0 : (i * 11) % 20,
    })),
    [],
  );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 192 }}>
      {bars.map((bar, i) => (
        <div
          key={i}
          style={{
            height:        12,
            background:    `linear-gradient(90deg, #1a1a2e 25%, #2a2a4a 50%, #1a1a2e 75%)`,
            backgroundSize:'200% 100%',
            animation:   'shimmer 1.2s infinite',
            width:       bar.width,
            marginLeft:  bar.marginLeft,
            borderRadius:2,
          }}
        />
      ))}
    </div>
  );
};

export default function CandleChart({
  pairId,
  token0,
  token1,
  height = 440,
  initialTimeframe = 1440,
  invertPrice = false,
  fullscreen = false,
}: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef          = useRef<IChartApi | null>(null);
  const candleRef         = useRef<ISeriesApi<'Candlestick'> | null>(null);

  const [isClient, setIsClient]   = useState(false);
  const [timeframe, setTimeframe] = useState<TfValue>(
    TF.find(t => t.value === initialTimeframe)?.value ?? 1440
  );
  const [hasData, setHasData]     = useState(false);

  const [viewportH, setViewportH] = useState(height);
  useEffect(() => {
    if (!fullscreen) return;
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  useEffect(() => { setIsClient(true); }, []);

  // ── Candle data (now from Edge /api/candles) ────────────
  const { candles = [], isLoading, latestPrice } = useCandleData({
    pairId,
    token0,
    token1,
    intervalMinutes: timeframe,
  });

  // ── Stable refs ────────────────────────────────────────
  const dataInitializedRef = useRef(false);
  const lastPairRef        = useRef('');
  const lastTfRef          = useRef(0);
  const rafRef             = useRef<number | null>(null);
  const pendingRef         = useRef<{ data: CandlestickData<Time>[]; fit: boolean } | null>(null);

  // ── Chart init / destroy ────────────────────────────────
  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const totalH  = fullscreen ? viewportH : height;
    const initH   = container.clientHeight || Math.max(100, totalH - 52);
    const initW   = container.clientWidth  || (fullscreen ? window.innerWidth : 400);

    const chart = createChart(container, {
      width:  initW,
      height: initH,
      layout: {
        background:  { type: ColorType.Solid, color: COLORS.bg },
        textColor:   COLORS.text,
        fontSize:    9,
        fontFamily:  "'Press Start 2P', monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: COLORS.text, width: 1, style: 2, labelBackgroundColor: COLORS.toolbarBg },
        horzLine: { color: COLORS.text, width: 1, style: 2, labelBackgroundColor: COLORS.toolbarBg },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        textColor:   COLORS.text,
        scaleMargins: { top: 0.02, bottom: 0.02 },
        visible:     true,
        alignLabels: true,
      },
      timeScale: {
        borderColor:            COLORS.border,
        timeVisible:             true,
        secondsVisible:          false,
        rightOffset:             0,
        barSpacing:              6,
        minBarSpacing:           1,
        fixLeftEdge:             false,
        fixRightEdge:            false,
        shiftVisibleRangeOnNewBar: true,
      },
      handleScale: {
        mouseWheel:           true,
        pinch:                true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      handleScroll: {
        mouseWheel:       true,
        pressedMouseMove: true,
        horzTouchDrag:    true,
        vertTouchDrag:    true,
      },
      kineticScroll: { mouse: true, touch: true },
    });

    chartRef.current = chart;
    const candle = chart.addCandlestickSeries({
      upColor:         COLORS.bullish,
      downColor:       COLORS.bearish,
      borderUpColor:   COLORS.bullish,
      borderDownColor: COLORS.bearish,
      wickUpColor:     COLORS.bullish,
      wickDownColor:   COLORS.bearish,
      borderVisible:   true,
      priceFormat:     { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    candleRef.current = candle;

    // ── OHLCV bar ────────────────────────────────────────
    let lastOhlcvUpdate = 0;
    chart.subscribeCrosshairMove(param => {
      const ohlcvEl = document.getElementById('ohlcv-bar');
      if (!ohlcvEl) return;
      const now = Date.now();
      if (now - lastOhlcvUpdate < 50) return;
      lastOhlcvUpdate = now;

      const bar = param?.seriesData?.get(candle) as CandlestickData<Time> | undefined;
      if (!bar || !param?.time) { ohlcvEl.innerHTML = ''; return; }

      let dOpen: number, dHigh: number, dLow: number, dClose: number;
      if (invertPrice) {
        dOpen  = bar.open  > 0 ? 1 / bar.open  : bar.open;
        dHigh  = bar.high  > 0 ? 1 / bar.low   : bar.high;
        dLow   = bar.low   > 0 ? 1 / bar.high  : bar.low;
        dClose = bar.close > 0 ? 1 / bar.close : bar.close;
      } else {
        dOpen = bar.open; dHigh = bar.high; dLow = bar.low; dClose = bar.close;
      }

      const change = dOpen ? ((dClose - dOpen) / dOpen * 100) : 0;
      const sign = change >= 0 ? '+' : '';
      const fmt = (n: number) => formatPrice(n);

      ohlcvEl.innerHTML =
        `<span style="color:${COLORS.text}">O</span>` +
        `<span style="color:${COLORS.textBright}">${fmt(dOpen)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">H</span>` +
        `<span style="color:${COLORS.bullish}">${fmt(dHigh)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">L</span>` +
        `<span style="color:${COLORS.bearish}">${fmt(dLow)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">C</span>` +
        `<span style="color:${COLORS.textBright}">${fmt(dClose)}</span>` +
        `<span style="margin-left:8px;color:${change >= 0 ? COLORS.bullish : COLORS.bearish}">${sign}${change.toFixed(2)}%</span>`;
    });

    // ── ResizeObserver ───────────────────────────────────
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        const { width, height: h } = e.contentRect;
        chart.applyOptions({ width, height: h || Math.max(100, totalH - 52) });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(() => {});
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, fullscreen, viewportH]);

  // ── Data flush (RAF-batched) ────────────────────────────
  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (!chartRef.current || !candleRef.current) return;
    if (!pendingRef.current?.data.length) return;

    const { data, fit } = pendingRef.current;
    pendingRef.current = null;

    candleRef.current.setData(data);
    chartRef.current.priceScale('right').applyOptions({
      autoScale:    true,
      scaleMargins: { top: 0.02, bottom: 0.02 },
    });
    if (fit && !dataInitializedRef.current) {
      chartRef.current.timeScale().fitContent();
      dataInitializedRef.current = true;
    }
    setHasData(true);
  }, []);

  // Trigger data flush
  useEffect(() => {
    if (!candles.length) return;

    const isNewPair = lastPairRef.current !== pairId || lastTfRef.current !== timeframe;
    if (isNewPair) {
      lastPairRef.current        = pairId;
      lastTfRef.current          = timeframe;
      dataInitializedRef.current = false;
    }

    pendingRef.current = {
      data: toChartData(candles, invertPrice),
      fit: isNewPair || !dataInitializedRef.current,
    };

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(flushPending);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, pairId, timeframe]);

  // ── Realtime price update ───────────────────────────────
  useEffect(() => {
    if (!candleRef.current || !candles.length || !dataInitializedRef.current) return;
    if (lastTfRef.current !== timeframe) return;

    const last = candles[candles.length - 1];
    if (!last) return;
    // Validate ALL numeric fields before touching the chart
    const time = Number(last.time);
    const open = Number(last.open);
    const high = Number(last.high);
    const low = Number(last.low);
    if (!isFinite(time) || !isFinite(open) || !isFinite(high) || !isFinite(low)) return;

    const livePrice = latestPrice?.price ?? last.close;

    if (invertPrice) {
      const l  = livePrice > 0 ? 1 / livePrice : livePrice;
      const o  = open > 0 ? 1 / open : open;
      const h  = high > 0 ? 1 / low : high;
      const cl = low > 0 ? 1 / high : low;
      candleRef.current.update({ time: time as Time, open: o, high: Math.max(h, l), low: Math.min(cl, l), close: l });
    } else {
      candleRef.current.update({
        time:  time as Time,
        open:  open,
        high:  Math.max(high, livePrice),
        low:   Math.min(low, livePrice),
        close: livePrice,
      });
    }
  }, [latestPrice, candles, invertPrice, timeframe]);

  // ── Price stats ────────────────────────────────────────
  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle?.close
    ? (invertPrice && lastCandle.close > 0 ? 1 / lastCandle.close : lastCandle.close)
    : 0;
  const firstPrice = candles[0]?.open
    ? (invertPrice && candles[0].open > 0 ? 1 / candles[0].open : candles[0].open)
    : 0;
  const pctChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;

  /* ── Render ─────────────────────────────────────────── */

  if (!isClient) {
    return (
      <div style={{ height, background: COLORS.bg, border: `1px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: COLORS.text }}>LOADING...</span>
      </div>
    );
  }

  return (
    <div
      style={{
        height:        fullscreen ? viewportH : height,
        width:         fullscreen ? '100vw' : '100%',
        background:    COLORS.bg,
        border:        fullscreen ? 'none' : `1px solid ${COLORS.border}`,
        boxShadow:     fullscreen ? 'none' : `inset 0 0 0 2px ${COLORS.border}, inset 0 0 0 4px ${COLORS.bg}`,
        position:     'relative',
        display:     'flex',
        flexDirection:'column',
        overflow:     'hidden',
      }}
    >
      {/* Toolbar */}
      <div style={{ height: 32, background: COLORS.toolbarBg, borderBottom: `2px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.accent, letterSpacing: '0.05em' }}>
          {token0 ? `${token0.slice(0, 6)}...${token0.slice(-4)}` : '--'} / {token1 ? `${token1.slice(0, 6)}...${token1.slice(-4)}` : '--'}
        </span>

        {lastPrice > 0 && (
          <>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: COLORS.textBright }}>{formatPrice(lastPrice)}</span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: pctChange >= 0 ? COLORS.bullish : COLORS.bearish }}>
              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
            </span>
          </>
        )}

        <div style={{ flex: 1 }} />

        {TF.map(tf => (
          <TfButton key={tf.value} label={tf.label} active={timeframe === tf.value} onClick={() => setTimeframe(tf.value)} />
        ))}

        {isLoading && (
          <div style={{ width: 6, height: 6, background: COLORS.accent, animation: 'pixelBlink 0.5s steps(1) infinite' }} title="Loading..." />
        )}
      </div>

      {/* OHLCV bar */}
      <div
        id="ohlcv-bar"
        style={{
          height: 20, background: COLORS.panelBg, borderBottom: `2px solid ${COLORS.border}`,
          fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.text,
          display: 'flex', alignItems: 'center', padding: '0 12px', gap: 2, flexShrink: 0,
        }}
      />

      {/* Chart canvas */}
      <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />

      {/* Loading overlay */}
      {isLoading && !hasData && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, bottom: 0, background: COLORS.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <SkeletonBars />
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.text }}>LOADING...</span>
        </div>
      )}

      {/* Empty state */}
      {!isLoading && !hasData && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.text, gap: 4 }}>
          <span>NO DATA</span>
          <span style={{ color: '#2D2D44', fontSize: 5 }}>Swap on this pair to generate candles</span>
        </div>
      )}
    </div>
  );
}
