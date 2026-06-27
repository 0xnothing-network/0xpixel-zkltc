'use client';

import { useEffect, useRef, useState, useMemo } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useCandleData, SwapEvent, CandleData } from '@/app/hooks/useCandleData';
import { useRealtimePrice } from '@/lib/use0xDex';

const TF = [
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '12h', value: 720 },
  { label: '1D', value: 1440 },
  { label: '7D', value: 10080 },
  { label: '30D', value: 43200 },
] as const;

export type TfValue = typeof TF[number]['value'];

const COLORS = {
  bg: '#0a0a12',
  panelBg: '#0d0d18',
  border: '#2a2a4a',
  text: '#7878b0',
  textBright: '#d8d8ff',
  grid: '#1a1a2e',
  bullish: '#00ff88',
  bearish: '#ff4466',
  accent: '#8888ff',
  toolbarBg: '#0d0d18',
  toolbarBtn: '#1a1a2e',
  toolbarBtnActive: '#6a6aff',
};

function formatPrice(v: number) {
  if (!isFinite(v) || v <= 0) return '--';
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
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
  fullscreen?: boolean;   // fill viewport instead of fixed height
}

// ── Build volume map ──────────────────────────────────────────────
function buildVolumeMap(rawSwaps: SwapEvent[], intervalMinutes: number): Map<number, number> {
  const map = new Map<number, number>();
  const bucket = intervalMinutes * 60;
  for (let i = 0; i < rawSwaps.length; i++) {
    const s = rawSwaps[i];
    const ct = Math.floor(Number(s.timestamp) / bucket) * bucket;
    map.set(ct, (map.get(ct) ?? 0) + Number(s.amountOut));
  }
  return map;
}

// ── Convert candles → chart data ────────────────────────────────
function toChartData(
  candles: CandleData[],
  volumeMap: Map<number, number>,
  invertPrice: boolean,
): { candleData: CandlestickData<Time>[]; volumeData: { time: Time; value: number; color: string }[] } {
  const n = candles.length;
  const candleData: CandlestickData<Time>[] = new Array(n);
  const volumeData: { time: Time; value: number; color: string }[] = new Array(n);

  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const isUp = invertPrice ? c.close < c.open : c.close >= c.open;

    let o: number, h: number, l: number, cl: number;
    if (invertPrice) {
      o  = c.open  > 0 ? 1 / c.open  : c.open;
      h  = c.high  > 0 ? 1 / c.low   : c.high;
      l  = c.low   > 0 ? 1 / c.high  : c.low;
      cl = c.close > 0 ? 1 / c.close : c.close;
    } else {
      o = c.open; h = c.high; l = c.low; cl = c.close;
    }

    candleData[i] = { time: c.time as Time, open: o, high: h, low: l, close: cl };
    volumeData[i] = {
      time: c.time as Time,
      value: volumeMap.get(c.time) ?? 0,
      color: isUp ? '#00ff8820' : '#ff446620',
    };
  }

  return { candleData, volumeData };
}

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
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);

  const [isClient, setIsClient] = useState(false);
  const [timeframe, setTimeframe] = useState<TfValue>(
    TF.find(t => t.value === initialTimeframe)?.value ?? 1440
  );
  const [hasData, setHasData] = useState(false);

  // Stable refs
  const fitDoneRef = useRef(false);
  const lastPairRef = useRef('');
  const lastTfRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const dataInitializedRef = useRef(false);
  const pendingRef = useRef<{
    candleData: CandlestickData<Time>[];
    volumeData: { time: Time; value: number; color: string }[];
    fit?: boolean;
  } | null>(null);
  const isNewDataRef = useRef(false);

  // ── Candle data ────────────────────────────────────────────────
  const { candles = [], rawSwaps = [], isLoading } = useCandleData({
    pairId,
    token0,
    token1,
    intervalMinutes: timeframe,
  });

  // ── Realtime price ────────────────────────────────────────────
  const { latestPrice: realtimePrice } = useRealtimePrice(
    token0 as `0x${string}` | undefined,
    token1 as `0x${string}` | undefined,
  );

  // ── Client-side check ─────────────────────────────────────────
  useEffect(() => {
    setIsClient(true);
  }, []);

  // ── Viewport tracking (for fullscreen mode) ─────────────────
  const [viewportH, setViewportH] = useState<number>(height);
  useEffect(() => {
    if (!fullscreen) return;
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  // ── Flush ref: always sees latest pendingRef ──────────────────
  const flushRef = useRef<() => void>(() => {});

  // ── Data effect: build pending + schedule flush ────────────────
  useEffect(() => {
    flushRef.current = () => {
      rafRef.current = null;
      if (!chartRef.current || !candleSeriesRef.current || !volumeSeriesRef.current) return;
      if (!pendingRef.current) return;

      const { candleData, volumeData, fit } = pendingRef.current;
      if (!candleData?.length) return;
      pendingRef.current = null;

      candleSeriesRef.current.setData(candleData);
      if (volumeData?.length) {
        volumeSeriesRef.current.setData(volumeData);
      }

      // Pin margins tightly so candles fill the chart area with no black gap.
      // Auto-scale still runs, but we forbid it from adding empty padding.
      chartRef.current.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.02, bottom: 0.02 },
      });

      if (fit && !fitDoneRef.current) {
        chartRef.current.timeScale().fitContent();
        fitDoneRef.current = true;
      }

      dataInitializedRef.current = true;
      setHasData(true);
    };

    if (!candles.length) return;

    const isNewPair = lastPairRef.current !== pairId || lastTfRef.current !== timeframe;
    if (isNewPair) {
      lastPairRef.current = pairId;
      lastTfRef.current = timeframe;
      fitDoneRef.current = false;
      isNewDataRef.current = true;
      dataInitializedRef.current = false;
      lastTimeframeRef.current = null;
    }

    const vm = buildVolumeMap(rawSwaps, timeframe);
    const result = toChartData(candles, vm, invertPrice);

    pendingRef.current = {
      candleData: result.candleData,
      volumeData: result.volumeData,
      fit: isNewDataRef.current,
    };
    isNewDataRef.current = false;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(flushRef.current);
  }, [candles, rawSwaps, invertPrice, pairId, timeframe]);

  // ── Realtime candle update ──────────────────────────────────────
  const lastTimeframeRef = useRef<TfValue | null>(null);
  useEffect(() => {
    if (!candleSeriesRef.current || !candles.length || !dataInitializedRef.current) return;
    if (lastTimeframeRef.current !== null && lastTimeframeRef.current !== timeframe) return;
    const last = candles[candles.length - 1];
    if (!last) return;
    lastTimeframeRef.current = timeframe;

    const livePrice = realtimePrice?.price ?? last.close;
    const dispLive = invertPrice && livePrice > 0 ? 1 / livePrice : livePrice;
    const o = invertPrice && last.open > 0 ? 1 / last.open : last.open;
    const l = invertPrice && last.low > 0 ? 1 / last.high : last.low;
    const h = invertPrice && last.high > 0 ? 1 / last.low : last.high;

    if (dataInitializedRef.current) {
      candleSeriesRef.current?.update({
        time: last.time as Time,
        open: o,
        high: Math.max(h, dispLive),
        low: Math.min(l, dispLive),
        close: dispLive,
      });
    }
  }, [realtimePrice?.price, candles, invertPrice, timeframe]);

  // ── Re-fit on height prop change (fullscreen toggle) ──────────
  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;
    const r = requestAnimationFrame(() => {
      if (!chartRef.current || !chartContainerRef.current) return;
      chartRef.current.applyOptions({
        width: chartContainerRef.current.clientWidth,
        height: chartContainerRef.current.clientHeight || Math.max(100, height - 52),
      });
      chartRef.current.timeScale().fitContent();
    });
    return () => cancelAnimationFrame(r);
  }, [height]);

  // ── Chart init / destroy ──────────────────────────────────────
  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const totalH = fullscreen ? viewportH : height;
    const containerH = container.clientHeight || Math.max(100, totalH - 52);
    const containerW = container.clientWidth || (fullscreen ? window.innerWidth : 400);

    const chart = createChart(container, {
      width: containerW,
      height: containerH,
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontSize: 9,
        fontFamily: "'Press Start 2P', monospace",
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
        textColor: COLORS.text,
        scaleMargins: { top: 0.02, bottom: 0.02 },
        visible: true,
        alignLabels: true,
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 0,
        barSpacing: 6,
        minBarSpacing: 1,
        fixLeftEdge: false,
        fixRightEdge: false,
        shiftVisibleRangeOnNewBar: true,
      },
      handleScale: {
        mouseWheel: true,
        pinch: true,
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      kineticScroll: { mouse: true, touch: true },
    });

    chartRef.current = chart;
    const candleSeries = chart.addCandlestickSeries({
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderUpColor: COLORS.bullish,
      borderDownColor: COLORS.bearish,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
      borderVisible: true,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    candleSeriesRef.current = candleSeries;

    const volumeSeries = chart.addHistogramSeries({
      color: '#00ff8830',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.88, bottom: 0 },
      visible: false,
    });
    volumeSeriesRef.current = volumeSeries;

    // ── OHLCV bar ───────────────────────────────────────────────
    const crosshairHandler = (() => {
      const lastUpdateRef = { current: 0 };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (param: any) => {
        const ohlcvBar = document.getElementById('ohlcv-bar');
        if (!ohlcvBar) return;
        const now = Date.now();
        if (now - lastUpdateRef.current < 50) return;
        lastUpdateRef.current = now;

        const bar = param?.seriesData?.get(candleSeries) as CandlestickData<Time> | undefined;
        if (!bar || !param?.time) {
          ohlcvBar.innerHTML = '';
          return;
        }

        const fmt = (n: number) => formatPrice(n);

        let dispOpen: number, dispHigh: number, dispLow: number, dispClose: number;
        if (invertPrice) {
          dispOpen  = bar.open  > 0 ? 1 / bar.open  : bar.open;
          dispHigh  = bar.high > 0 ? Math.max(1 / bar.low, 1 / bar.high) : bar.high;
          dispLow   = bar.low  > 0 ? Math.min(1 / bar.high, 1 / bar.low)  : bar.low;
          dispClose = bar.close > 0 ? 1 / bar.close : bar.close;
        } else {
          dispOpen = bar.open; dispHigh = bar.high; dispLow = bar.low; dispClose = bar.close;
        }

        const change = dispOpen ? ((dispClose - dispOpen) / dispOpen * 100) : 0;
        const sign = change >= 0 ? '+' : '';

        ohlcvBar.innerHTML =
          `<span style="color:${COLORS.text}">O</span>` +
          `<span style="color:${COLORS.textBright}">${fmt(dispOpen)}</span>` +
          `<span style="color:${COLORS.text};margin-left:6px">H</span>` +
          `<span style="color:${COLORS.bullish}">${fmt(dispHigh)}</span>` +
          `<span style="color:${COLORS.text};margin-left:6px">L</span>` +
          `<span style="color:${COLORS.bearish}">${fmt(dispLow)}</span>` +
          `<span style="color:${COLORS.text};margin-left:6px">C</span>` +
          `<span style="color:${COLORS.textBright}">${fmt(dispClose)}</span>` +
          `<span style="margin-left:8px;color:${change >= 0 ? COLORS.bullish : COLORS.bearish}">${sign}${change.toFixed(2)}%</span>`;
      };
    })();

    chart.subscribeCrosshairMove(crosshairHandler);

    // ── ResizeObserver ────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight || Math.max(100, height - 44),
        });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.remove();
      chartRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isClient, fullscreen, viewportH]);

  // ── Price stats ───────────────────────────────────────────────
  const lastCandle = candles[candles.length - 1];
  const lastPrice = lastCandle?.close
    ? (invertPrice && lastCandle.close > 0 ? 1 / lastCandle.close : lastCandle.close)
    : 0;
  const firstPrice = candles[0]?.open
    ? (invertPrice && candles[0].open > 0 ? 1 / candles[0].open : candles[0].open)
    : 0;
  const pctChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;

  // Memoize skeleton bars so they don't re-randomize on every render
  const skeletonBars = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    width: 40 + (i * 17) % 50,
    marginLeft: i % 2 === 0 ? 0 : (i * 11) % 20,
  })), []);

  if (!isClient) {
    return (
      <div
        style={{
          height,
          background: COLORS.bg,
          border: `1px solid ${COLORS.border}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: COLORS.text }}>
          LOADING...
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        height: fullscreen ? viewportH : height,
        width: fullscreen ? '100vw' : '100%',
        background: COLORS.bg,
        border: fullscreen ? 'none' : `1px solid ${COLORS.border}`,
        boxShadow: fullscreen ? 'none' : `inset 0 0 0 2px ${COLORS.border}, inset 0 0 0 4px ${COLORS.bg}`,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* ── Toolbar ── */}
      <div
        style={{
          height: 32,
          background: COLORS.toolbarBg,
          borderBottom: `2px solid ${COLORS.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 4,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6,
            color: COLORS.accent,
            letterSpacing: '0.05em',
          }}
        >
          {token0 ? `${token0.slice(0, 6)}...${token0.slice(-4)}` : '--'} /{' '}
          {token1 ? `${token1.slice(0, 6)}...${token1.slice(-4)}` : '--'}
        </span>

        {lastCandle && (
          <>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: COLORS.textBright }}>
              {formatPrice(lastPrice)}
            </span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: pctChange >= 0 ? COLORS.bullish : COLORS.bearish }}>
              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
            </span>
          </>
        )}

        <div style={{ flex: 1 }} />

        {TF.map(tf => (
          <button
            key={tf.value}
            onClick={() => setTimeframe(tf.value)}
            style={{
              fontFamily: "'Press Start 2P', monospace",
              fontSize: 6,
              background: timeframe === tf.value ? COLORS.toolbarBtnActive : COLORS.toolbarBtn,
              color: timeframe === tf.value ? '#000' : COLORS.text,
              border: `1px solid ${timeframe === tf.value ? COLORS.accent : COLORS.border}`,
              padding: '3px 5px',
              cursor: 'pointer',
            }}
          >
            {tf.label}
          </button>
        ))}

        {isLoading && (
          <div
            style={{
              width: 6,
              height: 6,
              background: COLORS.accent,
              animation: 'pixelBlink 0.5s steps(1) infinite',
            }}
            title="Loading..."
          />
        )}
      </div>

      {/* ── OHLCV bar ── */}
      <div
        id="ohlcv-bar"
        style={{
          height: 20,
          background: COLORS.panelBg,
          borderBottom: `2px solid ${COLORS.border}`,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 6,
          color: COLORS.text,
          display: 'flex',
          alignItems: 'center',
          padding: '0 12px',
          gap: 2,
          flexShrink: 0,
        }}
      />

      {/* ── Chart area ── */}
      <div
        ref={chartContainerRef}
        style={{ flex: 1, minHeight: 0, width: '100%' }}
      />

      {/* ── Loading overlay ── */}
      {isLoading && !hasData && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 0,
            right: 0,
            bottom: 0,
            background: COLORS.bg,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: 192 }}>
            {skeletonBars.map((bar, i) => (
              <div
                key={i}
                style={{
                  height: 12,
                  background: `linear-gradient(90deg, #1a1a2e 25%, #2a2a4a 50%, #1a1a2e 75%)`,
                  backgroundSize: '200% 100%',
                  animation: 'shimmer 1.2s infinite',
                  width: bar.width,
                  marginLeft: bar.marginLeft,
                  borderRadius: 2,
                }}
              />
            ))}
          </div>
          <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.text }}>
            LOADING...
          </span>
        </div>
      )}

      {/* ── Empty state ── */}
      {!isLoading && !hasData && (
        <div
          style={{
            position: 'absolute',
            top: 52,
            left: 0,
            right: 0,
            bottom: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6,
            color: COLORS.text,
            gap: 4,
          }}
        >
          <span>NO DATA</span>
          <span style={{ color: '#2D2D44', fontSize: 5 }}>Swap on this pair to generate candles</span>
        </div>
      )}
    </div>
  );
}
