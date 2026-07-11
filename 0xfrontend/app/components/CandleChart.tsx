'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickData,
  ColorType,
  createChart,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  Time,
  UTCTimestamp,
} from 'lightweight-charts';
import { CandleData, useCandleData } from '@/app/hooks/useCandleData';

const TIMEFRAMES = [
  { label: '15m', value: 15 },
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1D', value: 1440 },
] as const;

export type TfValue = typeof TIMEFRAMES[number]['value'];

interface CandleChartProps {
  pairId: string;
  token0: string;
  token1: string;
  subgraphUrl?: string;
  initialPrice?: number | null;
  token0Decimals?: number;
  token1Decimals?: number;
  height?: number;
  initialTimeframe?: TfValue;
  enableRealtime?: boolean;
  invertPrice?: boolean;
  fullscreen?: boolean;
  onTimeframeChange?: (timeframe: TfValue) => void;
}

const COLORS = {
  bg: '#000000',
  panelBg: '#030303',
  toolbarBg: '#070707',
  border: '#363636',
  grid: '#171717',
  text: '#a9b3ae',
  textBright: '#ffffff',
  accent: '#7cffc7',
  bullish: '#00f58c',
  bearish: '#ff4168',
};

function isFinitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeTimeframe(value: number | undefined): TfValue {
  return TIMEFRAMES.find(timeframe => timeframe.value === value)?.value ?? 15;
}

function formatPrice(value: number) {
  if (!Number.isFinite(value)) return '--';
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value >= 1) return value.toFixed(4).replace(/\.?0+$/, '');
  if (value >= 0.0001) return value.toFixed(8).replace(/\.?0+$/, '');
  return value.toPrecision(7);
}

function precisionFor(value: number) {
  if (value >= 1000) return 2;
  if (value >= 1) return 4;
  if (value >= 0.01) return 6;
  if (value >= 0.0001) return 8;
  return 10;
}

function invertCandle(candle: CandleData): CandleData | null {
  if (![candle.open, candle.high, candle.low, candle.close].every(isFinitePositive)) {
    return null;
  }

  return {
    time: candle.time,
    open: 1 / candle.open,
    high: 1 / candle.low,
    low: 1 / candle.high,
    close: 1 / candle.close,
  };
}

function toChartData(candles: CandleData[], invertPrice: boolean): CandlestickData<Time>[] {
  const byTime = new Map<number, CandleData>();

  for (const source of candles) {
    const candle = invertPrice ? invertCandle(source) : source;
    const time = Math.floor(Number(candle?.time));
    if (
      !candle ||
      !Number.isFinite(time) ||
      ![candle.open, candle.high, candle.low, candle.close].every(isFinitePositive)
    ) {
      continue;
    }

    const normalized = {
      time,
      open: candle.open,
      high: Math.max(candle.high, candle.open, candle.close),
      low: Math.min(candle.low, candle.open, candle.close),
      close: candle.close,
    };
    const previous = byTime.get(time);
    byTime.set(time, previous
      ? {
          time,
          open: previous.open,
          high: Math.max(previous.high, normalized.high),
          low: Math.min(previous.low, normalized.low),
          close: normalized.close,
        }
      : normalized);
  }

  return [...byTime.values()]
    .sort((a, b) => a.time - b.time)
    .map(candle => ({ ...candle, time: candle.time as UTCTimestamp }));
}

function pricesAreCompatible(indexedPrice: number, spotPrice: number) {
  if (!isFinitePositive(indexedPrice) || !isFinitePositive(spotPrice)) return false;
  const ratio = indexedPrice / spotPrice;
  return ratio >= 0.2 && ratio <= 5;
}

function resolveCandlesEndpoint(subgraphUrl?: string) {
  if (!subgraphUrl || subgraphUrl.includes('/api/subgraph')) return '/api/candles';
  return subgraphUrl;
}

const TimeframeButton = memo(function TimeframeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        width: 34,
        height: 22,
        flex: '0 0 34px',
        display: 'grid',
        placeItems: 'center',
        padding: 0,
        border: active ? '2px solid #ffffff' : `1px solid ${COLORS.border}`,
        background: active ? '#ffffff' : '#050505',
        color: active ? '#000000' : COLORS.text,
        fontFamily: "'Press Start 2P', monospace",
        fontSize: 6,
        lineHeight: 1,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
});

const LoadingOverlay = memo(function LoadingOverlay({ label }: { label: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: '52px 0 0',
        zIndex: 4,
        display: 'grid',
        placeItems: 'center',
        background: 'rgba(0,0,0,0.82)',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 14px',
          border: `1px solid ${COLORS.border}`,
          background: '#050505',
          boxShadow: '4px 4px 0 #000000',
          color: COLORS.textBright,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 7,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 9,
            height: 9,
            background: COLORS.accent,
            animation: 'pixelLoaderBlock 0.8s steps(2, end) infinite',
          }}
        />
        {label}
      </div>
    </div>
  );
});

export default function CandleChart({
  pairId,
  token0,
  token1,
  subgraphUrl,
  initialPrice,
  token0Decimals = 18,
  token1Decimals = 18,
  height = 440,
  initialTimeframe = 15,
  enableRealtime = true,
  invertPrice = false,
  fullscreen = false,
  onTimeframeChange,
}: CandleChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const ohlcvRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const renderedSeriesKeyRef = useRef('');
  const renderedLastTimeRef = useRef<number | null>(null);
  const renderedCountRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);
  const fitFrameRef = useRef<number | null>(null);

  const [isClient, setIsClient] = useState(false);
  const [chartReady, setChartReady] = useState(false);
  const [timeframe, setTimeframe] = useState<TfValue>(() => normalizeTimeframe(initialTimeframe));
  const [viewportHeight, setViewportHeight] = useState(height);

  const candlesEndpoint = useMemo(() => resolveCandlesEndpoint(subgraphUrl), [subgraphUrl]);
  const {
    candles,
    isLoading,
    source,
    complete,
    indexedBlock,
    hasIndexingErrors,
    upstreamError,
    latestPrice,
  } = useCandleData({
    pairId,
    token0,
    token1,
    intervalMinutes: timeframe,
    subgraphUrl: candlesEndpoint,
    enabled: enableRealtime,
    initialPrice,
    token0Decimals,
    token1Decimals,
  });

  const chartData = useMemo(
    () => toChartData(candles, invertPrice),
    [candles, invertPrice],
  );
  const seriesKey = `${pairId.toLowerCase()}:${timeframe}:${invertPrice ? 1 : 0}`;

  const priceStats = useMemo(() => {
    const first = chartData[0];
    const last = chartData[chartData.length - 1];
    const indexedPrice = last?.close ?? 0;
    const spotPrice = latestPrice?.price ?? 0;
    const displayPrice = pricesAreCompatible(indexedPrice, spotPrice)
      ? spotPrice
      : indexedPrice || spotPrice;
    const change = first?.open && last?.close
      ? ((last.close - first.open) / first.open) * 100
      : 0;
    return { displayPrice, change };
  }, [chartData, latestPrice]);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    const next = normalizeTimeframe(initialTimeframe);
    setTimeframe(current => (current === next ? current : next));
  }, [initialTimeframe]);

  useEffect(() => {
    if (!fullscreen) return;
    const update = () => setViewportHeight(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  useEffect(() => {
    if (!isClient || !containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: Math.max(1, container.clientWidth),
      height: Math.max(180, container.clientHeight),
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
        vertLine: { color: '#747474', width: 1, style: 2, labelBackgroundColor: '#111111' },
        horzLine: { color: '#747474', width: 1, style: 2, labelBackgroundColor: '#111111' },
      },
      rightPriceScale: {
        visible: true,
        autoScale: true,
        borderColor: COLORS.border,
        textColor: COLORS.text,
        scaleMargins: { top: 0.08, bottom: 0.12 },
      },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 3,
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
    const series = chart.addCandlestickSeries({
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderUpColor: COLORS.bullish,
      borderDownColor: COLORS.bearish,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
      borderVisible: true,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });

    chartRef.current = chart;
    seriesRef.current = series;
    setChartReady(true);

    const crosshairHandler: Parameters<typeof chart.subscribeCrosshairMove>[0] = parameter => {
      const element = ohlcvRef.current;
      if (!element) return;
      const bar = parameter.seriesData.get(series) as CandlestickData<Time> | undefined;
      if (!bar) {
        element.textContent = '';
        return;
      }

      const change = bar.open ? ((bar.close - bar.open) / bar.open) * 100 : 0;
      element.textContent = `O ${formatPrice(bar.open)}  H ${formatPrice(bar.high)}  L ${formatPrice(bar.low)}  C ${formatPrice(bar.close)}  ${change >= 0 ? '+' : ''}${change.toFixed(2)}%`;
      element.style.color = change >= 0 ? COLORS.bullish : COLORS.bearish;
    };
    chart.subscribeCrosshairMove(crosshairHandler);

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = requestAnimationFrame(() => {
        resizeFrameRef.current = null;
        chart.applyOptions({
          width: Math.max(1, Math.floor(entry.contentRect.width)),
          height: Math.max(180, Math.floor(entry.contentRect.height)),
        });
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
      if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      renderedSeriesKeyRef.current = '';
      renderedLastTimeRef.current = null;
      renderedCountRef.current = 0;
      setChartReady(false);
    };
  }, [isClient]);

  useEffect(() => {
    if (!chartReady || !chartRef.current || !seriesRef.current) return;
    const chart = chartRef.current;
    const series = seriesRef.current;
    const isNewSeries = renderedSeriesKeyRef.current !== seriesKey;
    const previousLastTime = renderedLastTimeRef.current;
    const previousCount = renderedCountRef.current;
    const last = chartData[chartData.length - 1];

    series.setData(chartData);
    renderedSeriesKeyRef.current = seriesKey;
    renderedLastTimeRef.current = last ? Number(last.time) : null;
    renderedCountRef.current = chartData.length;

    if (last) {
      const precision = precisionFor(last.close);
      series.applyOptions({
        priceFormat: {
          type: 'price',
          precision,
          minMove: 10 ** -precision,
        },
      });
    }

    if (ohlcvRef.current) {
      ohlcvRef.current.textContent = '';
      ohlcvRef.current.style.color = COLORS.text;
    }

    if (fitFrameRef.current !== null) cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = requestAnimationFrame(() => {
      fitFrameRef.current = null;
      if (!chartData.length) return;

      if (isNewSeries || previousCount === 0) {
        chart.priceScale('right').applyOptions({ autoScale: true });
        chart.timeScale().fitContent();
        return;
      }

      const nextLastTime = last ? Number(last.time) : null;
      if (
        nextLastTime !== null &&
        previousLastTime !== null &&
        nextLastTime > previousLastTime &&
        chart.timeScale().scrollPosition() < 6
      ) {
        chart.timeScale().scrollToRealTime();
      }
    });
  }, [chartData, chartReady, seriesKey]);

  useEffect(() => {
    if (!chartRef.current || !containerRef.current) return;
    chartRef.current.applyOptions({
      width: Math.max(1, containerRef.current.clientWidth),
      height: Math.max(180, containerRef.current.clientHeight),
    });
  }, [fullscreen, height, viewportHeight]);

  const changeTimeframe = useCallback((next: TfValue) => {
    if (next === timeframe) return;
    seriesRef.current?.setData([]);
    renderedSeriesKeyRef.current = '';
    renderedLastTimeRef.current = null;
    renderedCountRef.current = 0;
    setTimeframe(next);
    onTimeframeChange?.(next);
  }, [onTimeframeChange, timeframe]);

  const noDataLabel = hasIndexingErrors
    ? 'INDEX ERROR'
    : source === 'unavailable' || upstreamError
      ? 'DATA SOURCE OFFLINE'
      : 'INDEXING CANDLES';
  const showLoading = isLoading && chartData.length === 0;
  const totalHeight = fullscreen ? viewportHeight : height;

  if (!isClient) {
    return (
      <div
        style={{
          height: totalHeight,
          display: 'grid',
          placeItems: 'center',
          border: `1px solid ${COLORS.border}`,
          background: COLORS.bg,
          color: COLORS.text,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 7,
        }}
      >
        LOADING...
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        width: fullscreen ? '100vw' : '100%',
        height: totalHeight,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        border: fullscreen ? 'none' : `1px solid ${COLORS.border}`,
        background: COLORS.bg,
      }}
    >
      <div
        style={{
          minHeight: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 8px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.toolbarBg,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            color: COLORS.accent,
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 6,
            whiteSpace: 'nowrap',
          }}
        >
          {token0 ? `${token0.slice(0, 6)}...${token0.slice(-4)}` : '--'} / {token1 ? `${token1.slice(0, 6)}...${token1.slice(-4)}` : '--'}
        </span>

        {priceStats.displayPrice > 0 && (
          <>
            <span style={{ color: COLORS.textBright, fontFamily: "'Press Start 2P', monospace", fontSize: 7 }}>
              {formatPrice(priceStats.displayPrice)}
            </span>
            {chartData.length > 1 && (
              <span
                style={{
                  color: priceStats.change >= 0 ? COLORS.bullish : COLORS.bearish,
                  fontFamily: "'Press Start 2P', monospace",
                  fontSize: 6,
                }}
              >
                {priceStats.change >= 0 ? '+' : ''}{priceStats.change.toFixed(2)}%
              </span>
            )}
          </>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          {TIMEFRAMES.map(item => (
            <TimeframeButton
              key={item.value}
              label={item.label}
              active={timeframe === item.value}
              onClick={() => changeTimeframe(item.value)}
            />
          ))}
        </div>
      </div>

      <div
        ref={ohlcvRef}
        style={{
          minHeight: 20,
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          borderBottom: `1px solid ${COLORS.border}`,
          background: COLORS.panelBg,
          color: COLORS.text,
          fontFamily: "'Press Start 2P', monospace",
          fontSize: 6,
          lineHeight: 1.4,
          flexShrink: 0,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      />

      <div ref={containerRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />

      {showLoading && <LoadingOverlay label={`LOADING ${timeframe === 1440 ? '1D' : TIMEFRAMES.find(item => item.value === timeframe)?.label ?? ''}`} />}

      {!showLoading && chartData.length === 0 && (
        <div
          style={{
            position: 'absolute',
            inset: '52px 0 0',
            display: 'grid',
            placeItems: 'center',
            pointerEvents: 'none',
            color: COLORS.text,
            fontFamily: "'Press Start 2P', monospace",
            textAlign: 'center',
          }}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <span style={{ color: source === 'unavailable' ? COLORS.bearish : COLORS.textBright, fontSize: 8 }}>
              {noDataLabel}
            </span>
            {indexedBlock !== null && (
              <span style={{ color: COLORS.text, fontSize: 5 }}>BLOCK {indexedBlock.toLocaleString()}</span>
            )}
          </div>
        </div>
      )}

      {chartData.length > 0 && !complete && (
        <span
          style={{
            position: 'absolute',
            left: 8,
            bottom: 8,
            padding: '4px 5px',
            border: `1px solid ${COLORS.border}`,
            background: '#050505',
            color: COLORS.text,
            fontFamily: "'Press Start 2P', monospace",
            fontSize: 5,
            pointerEvents: 'none',
          }}
        >
          SYNCING
        </span>
      )}
    </div>
  );
}
