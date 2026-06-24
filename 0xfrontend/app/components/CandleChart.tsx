'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, ColorType, CrosshairMode, IChartApi, ISeriesApi, CandlestickData, Time } from 'lightweight-charts';
import { useCandleData } from '@/app/hooks/useCandleData';

const TF = [
  { label: '1m', value: 1 },
  { label: '5m', value: 5 },
  { label: '15m', value: 15 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1D', value: 1440 },
  { label: '1W', value: 10080 },
  { label: '1M', value: 43200 },
] as const;

type TfValue = typeof TF[number]['value'];

const COLORS = {
  bg: '#0a0a12',
  panelBg: '#0d0d18',
  border: '#2a2a4a',
  borderBright: '#4a4a7a',
  text: '#7878b0',
  textBright: '#d8d8ff',
  grid: '#1a1a2e',
  bullish: '#00ff88',
  bearish: '#ff4466',
  accent: '#8888ff',
  toolbarBg: '#0d0d18',
  toolbarBtn: '#1a1a2e',
  toolbarBtnHover: '#2a2a4a',
  toolbarBtnActive: '#6a6aff',
};

function formatPrice(v: number) {
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6).replace(/\.?0+$/, '');
  if (v > 0) return v.toPrecision(6).replace(/\.?0+$/, '');
  return '0';
}

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

interface CandleChartProps {
  pairId: string;
  token0: string;
  token1: string;
  contractAddress?: `0x${string}`;
  subgraphUrl?: string;
  initialTimeframe?: number;
  height?: number;
  enableRealtime?: boolean;
  invertPrice?: boolean; // true = show NUSD/Token instead of Token/NUSD
}

export default function CandleChart({
  pairId,
  token0,
  token1,
  height = 440,
  initialTimeframe = 5,
  invertPrice = true,
}: CandleChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const [isClient, setIsClient] = useState(false);
  const [timeframe, setTimeframe] = useState<TfValue>(
    TF.find(t => t.value === initialTimeframe)?.value ?? 5
  );
  const didInitialFit = useRef(false);

  const { candles = [], rawSwaps = [], isLoading, isError, error } = useCandleData({
    pairId,
    token0,
    token1,
    intervalMinutes: timeframe,
  });

  useEffect(() => { setIsClient(true); }, []);

  // ─── Init chart ───────────────────────────────────────────────
  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;

    const container = chartContainerRef.current;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: height - 44, // minus toolbar height
      layout: {
        background: { type: ColorType.Solid, color: COLORS.bg },
        textColor: COLORS.text,
        fontSize: 9,
        fontFamily: "'Press Start 2P', monospace",
        attributionLogo: false,
        watermark: { visible: false },
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: COLORS.text,
          width: 1,
          style: 2,
          labelBackgroundColor: COLORS.toolbarBg,
        },
        horzLine: {
          color: COLORS.text,
          width: 1,
          style: 2,
          labelBackgroundColor: COLORS.toolbarBg,
        },
      },
      rightPriceScale: {
        borderColor: COLORS.border,
        textColor: COLORS.text,
        scaleMargins: { top: 0.05, bottom: 0.32 },
        visible: true,
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
    });

    chartRef.current = chart;

    // Candlestick series
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

    // Volume histogram (bottom 20%)
    const volumeSeries = chart.addHistogramSeries({
      color: '#00ff8830',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeriesRef.current = volumeSeries;

    // Crosshair subscription for OHLCV bar
    chart.subscribeCrosshairMove((param) => {
      const ohlcvBar = document.getElementById('ohlcv-bar');
      if (!ohlcvBar || !param.time) { return; }

      const bar = param.seriesData.get(candleSeries) as CandlestickData<Time> | undefined;
        if (bar) {
        const fmt = (n: number) => {
          if (n >= 1000) return n.toFixed(2);
          if (n >= 1) return n.toFixed(4);
          if (n >= 0.0001) return n.toFixed(6).replace(/\.?0+$/, '');
          if (n > 0) return n.toPrecision(6).replace(/\.?0+$/, '');
          return '0';
        };
        const dispOpen = invertPrice ? (bar.open > 0 ? 1 / bar.open : 0) : bar.open;
        const dispHigh = invertPrice ? (bar.high > 0 ? 1 / bar.low  : 0) : bar.high;
        const dispLow  = invertPrice ? (bar.low  > 0 ? 1 / bar.high : 0) : bar.low;
        const dispClose= invertPrice ? (bar.close> 0 ? 1 / bar.close: 0) : bar.close;
        const change = dispOpen ? ((dispClose - dispOpen) / dispOpen * 100) : 0;
        const sign = change >= 0 ? '+' : '';
        ohlcvBar.innerHTML =
          `<span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.text}">O</span><span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.textBright}">${fmt(dispOpen)}</span>` +
          `<span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.text};margin-left:6px">H</span><span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.bullish}">${fmt(dispHigh)}</span>` +
          `<span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.text};margin-left:6px">L</span><span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.bearish}">${fmt(dispLow)}</span>` +
          `<span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.text};margin-left:6px">C</span><span style="font-family:\'Press Start 2P\',monospace;font-size:6px;color:${COLORS.textBright}">${fmt(dispClose)}</span>` +
          `<span style="font-family:\'Press Start 2P\',monospace;font-size:6px;margin-left:8px;color:${change >= 0 ? COLORS.bullish : COLORS.bearish}">${sign}${change.toFixed(2)}%</span>`;
      }
    });

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (container && chartRef.current) {
        chartRef.current.applyOptions({ width: container.clientWidth });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
    };
  }, [isClient, pairId]);

  // Update chart size when height prop changes (e.g. window resize), without rebuilding chart
  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;
    chartRef.current.applyOptions({
      width: chartContainerRef.current.clientWidth,
      height: height - 44,
    });
    chartRef.current.timeScale().fitContent();
  }, [height]);

  // ─── Push data to chart ──────────────────────────────────────
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return;

    if (!candles.length) {
      candleSeriesRef.current.setData([]);
      volumeSeriesRef.current.setData([]);
      return;
    }

    const candleData: CandlestickData<Time>[] = candles.map(c => {
      const o = invertPrice ? 1 / c.open : c.open;
      const h = invertPrice ? 1 / c.low  : c.high;
      const l = invertPrice ? 1 / c.high : c.low;
      const cl = invertPrice ? 1 / c.close : c.close;
      return { time: c.time as Time, open: o, high: h, low: l, close: cl };
    });

    // Build synthetic volume from swap amounts per candle
    const swapMap = new Map<number, number>();
    for (const swap of rawSwaps) {
      const t = Number(swap.timestamp);
      const candleTime = Math.floor(t / (timeframe * 60)) * (timeframe * 60);
      const prev = swapMap.get(candleTime) ?? 0;
      swapMap.set(candleTime, prev + Number(swap.amountOut));
    }

    const volumeData = candles.map(c => {
      const isUp = invertPrice ? c.close < c.open : c.close >= c.open;
      return {
        time: c.time as Time,
        value: swapMap.get(c.time) ?? 0,
        color: isUp ? '#00ff8820' : '#ff446620',
      };
    });

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);

    // Only auto-fit on very first data load, preserve user's zoom/scroll after
    if (!didInitialFit.current) {
      chartRef.current?.timeScale().fitContent();
      didInitialFit.current = true;
    }
    // Recompute when rawSwaps reference changes (5s poll) or invert flips
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, timeframe, pairId, invertPrice]);

  // ─── Helpers ─────────────────────────────────────────────────
  const last = candles[candles.length - 1];
  // Invert: show NUSD per Token instead of Token per NUSD
  const lastPrice = last?.close ? 1 / last.close : 0;
  const firstPrice = candles[0]?.open ? 1 / candles[0].open : 0;
  const pctChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice * 100) : 0;
  const tfLabel = TF.find(t => t.value === timeframe)?.label ?? `${timeframe}m`;

  if (!isClient) {
    return (
      <div style={{ height, background: COLORS.bg }} className="flex items-center justify-center">
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 8, color: COLORS.text }}>
          LOADING...
        </span>
      </div>
    );
  }

  return (
    <div
      className="w-full overflow-hidden border"
      style={{
        height,
        background: COLORS.bg,
        borderColor: COLORS.border,
        boxShadow: `inset 0 0 0 2px ${COLORS.border}, inset 0 0 0 4px ${COLORS.bg}`,
      }}
    >
      {/* ── Toolbar ── */}
      <div
        className="flex items-center px-2 gap-1"
        style={{
          height: 32,
          background: COLORS.toolbarBg,
          borderBottom: `2px solid ${COLORS.border}`,
        }}
      >
        {/* Symbol label */}
        <span
          style={{
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6,
            color: COLORS.accent,
            letterSpacing: '0.05em',
          }}
        >
          {token0 ? `${token0.slice(0, 6)}...${token0.slice(-4)}` : '——'} / {token1 ? `${token1.slice(0, 6)}...${token1.slice(-4)}` : '——'}
        </span>

        {/* Price + change */}
        {last && (
          <>
            <span
              style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: 7,
                color: COLORS.textBright,
              }}
            >
              {formatPrice(lastPrice)}
            </span>
            <span
              style={{
                fontFamily: "'Press Start 2P', monospace",
                fontSize: 7,
                color: pctChange >= 0 ? COLORS.bullish : COLORS.bearish,
              }}
            >
              {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(2)}%
            </span>
          </>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Timeframe buttons */}
        <div className="flex items-center gap-[2px]">
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
                transition: 'none',
              }}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* Loading dot */}
        {isLoading && (
          <div
            style={{
              width: 6, height: 6,
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
        className="flex items-center px-3"
        style={{
          height: 20,
          background: COLORS.panelBg,
          borderBottom: `2px solid ${COLORS.border}`,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 6,
          color: COLORS.text,
        }}
      >
        <span style={{ color: COLORS.bullish }}>H</span>
        <span style={{ color: COLORS.textBright, marginLeft: 2 }}>{last ? formatPrice(invertPrice && last.high > 0 ? 1 / last.low : last.high) : '——'}</span>
        <span style={{ color: COLORS.border, margin: '0 6px' }}>|</span>
        <span style={{ color: COLORS.bearish }}>L</span>
        <span style={{ color: COLORS.textBright, marginLeft: 2 }}>{last ? formatPrice(invertPrice && last.low > 0 ? 1 / last.high : last.low) : '——'}</span>
        <span style={{ color: COLORS.border, margin: '0 6px' }}>|</span>
        <span style={{ color: COLORS.text }}>VOL</span>
        <span style={{ color: COLORS.textBright, marginLeft: 2 }}>{last ? Number(last.high).toExponential(1) : '——'}</span>
      </div>

      {/* ── Chart area ── */}
      <div ref={chartContainerRef} className="w-full" style={{ flex: 1, height: `calc(100% - 52px)` }} />

      {/* ── Error / empty state ── */}
      {isError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 font-mono text-xs text-red-400">
          Error: {error?.message}
        </div>
      )}
      {!isLoading && !isError && candles.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center font-mono text-xs" style={{ color: COLORS.text }}>
          <span>No chart data for {tfLabel}</span>
          <span className="text-[#2D2D44] mt-1">Swap on this pair to generate candles</span>
        </div>
      )}
    </div>
  );
}
