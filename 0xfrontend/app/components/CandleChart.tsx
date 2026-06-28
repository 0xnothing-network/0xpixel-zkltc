'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createChart,
  ColorType,
  CrosshairMode,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
} from 'lightweight-charts';
import {
  useCandleData,
  CandleData,
  CandlesResponse,
  fetchCandlesRequest,
  getCachedCandlesResponse,
  getCandlesQueryKey,
} from '@/app/hooks/useCandleData';

const TF = [
  { label: '1h', value: 60 },
  { label: '4h', value: 240 },
  { label: '1D', value: 1440 },
] as const;

export type TfValue = typeof TF[number]['value'];
const PRICE_SCALE_MAX_RATIO = 100;

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

type PendingChartData =
  | {
      mode: 'set';
      data: CandlestickData<Time>[];
      fit: boolean;
      seriesKey: string;
      rawFirstTime: number | null;
      rawLastTime: number | null;
    }
  | {
      mode: 'update';
      datum: CandlestickData<Time>;
      seriesKey: string;
      rawTime: number;
      fallbackData: CandlestickData<Time>[];
      fallbackRawFirstTime: number | null;
      fallbackRawLastTime: number | null;
    };

interface CandleChartProps {
  pairId: string;
  token0: string;
  token1: string;
  contractAddress?: `0x${string}`;
  subgraphUrl?: string;
  initialPrice?: number | null;
  token0Decimals?: number;
  token1Decimals?: number;
  initialTimeframe?: TfValue;
  height?: number;
  enableRealtime?: boolean;
  invertPrice?: boolean;
  fullscreen?: boolean;
}

function formatPrice(v: number) {
  if (!isFinite(v) || v <= 0) return '--';
  if (v >= 1000) return v.toFixed(2);
  if (v >= 1) return v.toFixed(4);
  if (v >= 0.0001) return v.toFixed(6).replace(/\.?0+$/, '');
  return v.toPrecision(6).replace(/\.?0+$/, '');
}

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && isFinite(value);
}

function isPriceScaleMismatch(left: number | null | undefined, right: number | null | undefined) {
  if (!isValidNumber(left) || !isValidNumber(right) || left <= 0 || right <= 0) return false;
  const ratio = left / right;
  return ratio > PRICE_SCALE_MAX_RATIO || ratio < 1 / PRICE_SCALE_MAX_RATIO;
}

function normalizeTime(value: unknown): number | null {
  if (typeof value === 'number' && isFinite(value)) return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = Number(value);
    return isFinite(parsed) ? Math.floor(parsed) : null;
  }
  if (typeof value === 'object' && value !== null) {
    const seconds = (value as { seconds?: unknown }).seconds;
    if (typeof seconds === 'number' && isFinite(seconds)) return Math.floor(seconds);
    if (typeof seconds === 'string') {
      const parsed = Number(seconds);
      return isFinite(parsed) ? Math.floor(parsed) : null;
    }
  }
  return null;
}

function toChartDatum(candle: CandleData, invertPrice: boolean): CandlestickData<Time> | null {
  const { open, high, low, close } = candle;
  const time = normalizeTime(candle.time);
  if (time === null || ![open, high, low, close].every(isValidNumber)) return null;

  if (!invertPrice) {
    return { time: time as Time, open, high, low, close };
  }

  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;

  const invOpen = 1 / open;
  const invClose = 1 / close;
  const invHigh = 1 / low;
  const invLow = 1 / high;

  return {
    time: time as Time,
    open: invOpen,
    high: Math.max(invOpen, invHigh, invLow, invClose),
    low: Math.min(invOpen, invHigh, invLow, invClose),
    close: invClose,
  };
}

function toChartData(candles: CandleData[], invertPrice: boolean): CandlestickData<Time>[] {
  const out: CandlestickData<Time>[] = [];
  for (const candle of candles) {
    const datum = toChartDatum(candle, invertPrice);
    if (datum) out.push(datum);
  }

  out.sort((a, b) => {
    const leftTime = normalizeTime(a.time) ?? 0;
    const rightTime = normalizeTime(b.time) ?? 0;
    return leftTime - rightTime;
  });

  const deduped: CandlestickData<Time>[] = [];
  for (const datum of out) {
    const datumTime = normalizeTime(datum.time);
    if (datumTime === null) continue;

    const previous = deduped[deduped.length - 1];
    const previousTime = previous ? normalizeTime(previous.time) : null;
    if (previousTime === datumTime) {
      deduped[deduped.length - 1] = datum;
    } else if (previousTime === null || datumTime > previousTime) {
      deduped.push(datum);
    }
  }

  return deduped;
}

function withLivePrice(
  candles: CandleData[],
  livePrice: number | null | undefined,
  intervalMinutes: number,
): CandleData[] {
  if (!isValidNumber(livePrice) || livePrice <= 0) return candles;

  const intervalSeconds = intervalMinutes * 60;
  const liveTime = Math.floor(Math.floor(Date.now() / 1000) / intervalSeconds) * intervalSeconds;
  const last = candles[candles.length - 1];

  if (!last) {
    return [{ time: liveTime, open: livePrice, high: livePrice, low: livePrice, close: livePrice }];
  }

  const lastTime = normalizeTime(last.time);
  if (lastTime === null) return candles;

  if (lastTime === liveTime) {
    if (isPriceScaleMismatch(last.close, livePrice)) {
      return candles.map((candle, index) => (
        index === candles.length - 1
          ? { ...candle, open: livePrice, high: livePrice, low: livePrice, close: livePrice }
          : candle
      ));
    }

    return candles.map((candle, index) => (
      index === candles.length - 1
        ? {
            ...candle,
            high: Math.max(candle.high, livePrice),
            low: candle.low === 0 ? livePrice : Math.min(candle.low, livePrice),
            close: livePrice,
          }
        : candle
    ));
  }

  if (lastTime > liveTime) return candles;

  const open = last.close > 0 && !isPriceScaleMismatch(last.close, livePrice)
    ? last.close
    : livePrice;
  return [
    ...candles,
    {
      time: liveTime,
      open,
      high: Math.max(open, livePrice),
      low: Math.min(open, livePrice),
      close: livePrice,
    },
  ];
}

function lastValidTime(candles: CandleData[]) {
  for (let i = candles.length - 1; i >= 0; i--) {
    const time = normalizeTime(candles[i]?.time);
    if (time !== null) return time;
  }
  return null;
}

function firstValidTime(candles: CandleData[]) {
  for (let i = 0; i < candles.length; i++) {
    const time = normalizeTime(candles[i]?.time);
    if (time !== null) return time;
  }
  return null;
}

function canUpdateLastCandle(previous: CandleData[], next: CandleData[], mustSetData: boolean) {
  if (mustSetData || previous.length === 0 || next.length === 0) return false;
  const delta = next.length - previous.length;
  if (delta < 0 || delta > 1) return false;

  const stableCount = delta === 0 ? next.length - 1 : previous.length;
  for (let i = 0; i < stableCount; i++) {
    const previousTime = normalizeTime(previous[i]?.time);
    const nextTime = normalizeTime(next[i]?.time);
    if (
      previousTime === null ||
      nextTime === null ||
      previousTime !== nextTime ||
      previous[i].open !== next[i].open ||
      previous[i].high !== next[i].high ||
      previous[i].low !== next[i].low ||
      previous[i].close !== next[i].close
    ) {
      return false;
    }
  }

  return true;
}

function makeSeriesKey(pairId: string, timeframe: TfValue, invertPrice: boolean) {
  return `${pairId}:${timeframe}:${invertPrice ? 'inverted' : 'normal'}`;
}

function resolveCandlesEndpoint(subgraphUrl?: string) {
  if (!subgraphUrl) return '/api/candles';
  return /\/api\/candles(?:\?|$)|\/candles(?:\?|$)/.test(subgraphUrl) ? subgraphUrl : '/api/candles';
}

const TfButton = memo(function TfButton({
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
      onClick={onClick}
      style={{
        fontFamily: "'Press Start 2P', monospace",
        fontSize: 6,
        background: active ? COLORS.toolbarBtnActive : COLORS.toolbarBtn,
        color: active ? '#000' : COLORS.text,
        border: `1px solid ${active ? COLORS.accent : COLORS.border}`,
        padding: '3px 5px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
});

const SkeletonBars = memo(function SkeletonBars() {
  const bars = useMemo(
    () => Array.from({ length: 18 }, (_, i) => ({
      height: 28 + ((i * 13) % 82),
      opacity: 0.45 + ((i % 4) * 0.12),
      delay: `${i * 55}ms`,
    })),
    [],
  );

  return (
    <div style={{ width: 'min(460px, 78vw)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          height: 138,
          border: `1px solid ${COLORS.border}`,
          background:
            `linear-gradient(${COLORS.grid} 1px, transparent 1px), ` +
            `linear-gradient(90deg, ${COLORS.grid} 1px, transparent 1px), ${COLORS.bg}`,
          backgroundSize: '100% 34px, 52px 100%',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 7,
          padding: '14px 16px',
          overflow: 'hidden',
        }}
      >
        {bars.map((bar, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: bar.height,
              background: i % 3 === 0 ? COLORS.bearish : COLORS.bullish,
              opacity: bar.opacity,
              boxShadow: `0 -18px 0 -4px ${i % 3 === 0 ? COLORS.bearish : COLORS.bullish}`,
              animation: 'chartLoadPulse 1.05s steps(2) infinite',
              animationDelay: bar.delay,
            }}
          />
        ))}
      </div>

      <div style={{ height: 4, background: COLORS.toolbarBtn, border: `1px solid ${COLORS.border}`, overflow: 'hidden' }}>
        <div
          style={{
            width: '42%',
            height: '100%',
            background: COLORS.accent,
            animation: 'chartLoadSweep 1.15s ease-in-out infinite',
          }}
        />
      </div>
    </div>
  );
});

const ChartLoadingOverlay = memo(function ChartLoadingOverlay({
  label,
}: {
  label: string;
}) {
  return (
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
        gap: 14,
        zIndex: 3,
      }}
    >
      <SkeletonBars />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: 7,
            height: 7,
            background: COLORS.accent,
            boxShadow: `10px 0 0 ${COLORS.text}, 20px 0 0 ${COLORS.border}`,
            animation: 'chartLoadDots 0.9s steps(3) infinite',
          }}
        />
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.textBright }}>
          {label}
        </span>
      </div>
      <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 5, color: COLORS.text }}>
        syncing 1h / 4h / 1D
      </span>
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
  initialTimeframe = 240,
  enableRealtime = true,
  invertPrice = false,
  fullscreen = false,
}: CandleChartProps) {
  const queryClient = useQueryClient();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const ohlcvRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const dataInitializedRef = useRef(false);
  const lastPairRef = useRef('');
  const lastTfRef = useRef(0);
  const lastInvertRef = useRef(invertPrice);
  const lastRawCandlesRef = useRef<CandleData[]>([]);
  const chartSeriesKeyRef = useRef('');
  const chartFirstTimeRef = useRef<number | null>(null);
  const chartLastTimeRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRef = useRef<PendingChartData | null>(null);

  const [isClient, setIsClient] = useState(false);
  const [timeframe, setTimeframe] = useState<TfValue>(
    TF.find(t => t.value === initialTimeframe)?.value ?? 240,
  );
  const [hasData, setHasData] = useState(false);
  const [viewportH, setViewportH] = useState(height);
  const [loadingSeriesKey, setLoadingSeriesKey] = useState('');

  const candlesEndpoint = useMemo(() => resolveCandlesEndpoint(subgraphUrl), [subgraphUrl]);
  const normalizedToken0 = token0 ? token0.toLowerCase() : '';
  const normalizedToken1 = token1 ? token1.toLowerCase() : '';

  const { candles = [], isLoading, latestPrice } = useCandleData({
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
  const livePrice = latestPrice?.price ?? (isValidNumber(initialPrice) && initialPrice > 0 ? initialPrice : null);

  useEffect(() => {
    if (!enableRealtime || !normalizedToken0 || !normalizedToken1) return;

    for (const tf of TF) {
      const queryKey = getCandlesQueryKey(
        pairId,
        normalizedToken0,
        normalizedToken1,
        tf.value,
        token0Decimals,
        token1Decimals,
      );
      if (!queryClient.getQueryData(queryKey)) {
        const cached = getCachedCandlesResponse(
          normalizedToken0,
          normalizedToken1,
          tf.value,
          token0Decimals,
          token1Decimals,
        );
        if (cached) queryClient.setQueryData(queryKey, cached);
      }

      void queryClient.prefetchQuery({
        queryKey,
        queryFn: () =>
          fetchCandlesRequest({
            token0: normalizedToken0,
            token1: normalizedToken1,
            intervalMinutes: tf.value,
            subgraphUrl: candlesEndpoint,
            token0Decimals,
            token1Decimals,
          }),
        staleTime: 5_000,
        gcTime: 5 * 60_000,
      });
    }
  }, [
    candlesEndpoint,
    enableRealtime,
    normalizedToken0,
    normalizedToken1,
    pairId,
    queryClient,
    token0Decimals,
    token1Decimals,
  ]);

  const clearChartForSeries = useCallback((seriesKey: string) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRef.current = null;
    lastRawCandlesRef.current = [];
    chartFirstTimeRef.current = null;
    chartLastTimeRef.current = null;
    chartSeriesKeyRef.current = seriesKey;
    dataInitializedRef.current = false;
    setHasData(false);
    if (candleRef.current) candleRef.current.setData([]);
    if (ohlcvRef.current) ohlcvRef.current.innerHTML = '';
  }, []);

  const flushPending = useCallback(() => {
    rafRef.current = null;
    if (!chartRef.current || !candleRef.current || !pendingRef.current) return;

    const pending = pendingRef.current;
    pendingRef.current = null;

    if (pending.mode === 'update') {
      const canUpdate =
        chartSeriesKeyRef.current === pending.seriesKey &&
        dataInitializedRef.current &&
        (chartLastTimeRef.current === null || pending.rawTime >= chartLastTimeRef.current);

      if (canUpdate) {
        try {
          candleRef.current.update(pending.datum);
          chartLastTimeRef.current = pending.rawTime;
          setHasData(true);
          return;
        } catch {
          // Fall through to a full setData below if lightweight-charts rejects the update.
        }
      }

      candleRef.current.setData(pending.fallbackData);
      chartSeriesKeyRef.current = pending.seriesKey;
      chartFirstTimeRef.current = pending.fallbackRawFirstTime;
      chartLastTimeRef.current = pending.fallbackRawLastTime;
      const hasFallbackData = pending.fallbackData.length > 0;
      if (hasFallbackData) dataInitializedRef.current = true;
      chartRef.current.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.02, bottom: 0.02 },
      });
      setHasData(hasFallbackData);
      return;
    }

    candleRef.current.setData(pending.data);
    chartSeriesKeyRef.current = pending.seriesKey;
    chartFirstTimeRef.current = pending.rawFirstTime;
    chartLastTimeRef.current = pending.rawLastTime;
    chartRef.current.priceScale('right').applyOptions({
      autoScale: true,
      scaleMargins: { top: 0.02, bottom: 0.02 },
    });

    const nextHasData = pending.data.length > 0;
    setHasData(nextHasData);
    if (nextHasData && pending.fit) {
      chartRef.current.timeScale().fitContent();
      dataInitializedRef.current = true;
    } else if (!nextHasData) {
      dataInitializedRef.current = false;
    }
  }, []);

  const queuePendingFlush = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(flushPending);
  }, [flushPending]);

  useEffect(() => { setIsClient(true); }, []);

  useEffect(() => {
    if (!fullscreen) return;
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [fullscreen]);

  useEffect(() => {
    if (!isClient || !chartContainerRef.current) return;

    const container = chartContainerRef.current;
    const initH = Math.max(100, container.clientHeight || 388);
    const initW = Math.max(1, container.clientWidth || 400);

    const chart = createChart(container, {
      width: initW,
      height: initH,
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
    const candle = chart.addCandlestickSeries({
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderUpColor: COLORS.bullish,
      borderDownColor: COLORS.bearish,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
      borderVisible: true,
      priceFormat: { type: 'price', precision: 8, minMove: 0.00000001 },
    });
    candleRef.current = candle;

    let lastOhlcvUpdate = 0;
    const crosshairHandler: Parameters<typeof chart.subscribeCrosshairMove>[0] = (param) => {
      const ohlcvEl = ohlcvRef.current;
      if (!ohlcvEl) return;

      const now = Date.now();
      if (now - lastOhlcvUpdate < 50) return;
      lastOhlcvUpdate = now;

      const bar = param?.seriesData?.get(candle) as CandlestickData<Time> | undefined;
      if (!bar || !param?.time) {
        ohlcvEl.innerHTML = '';
        return;
      }

      const change = bar.open ? ((bar.close - bar.open) / bar.open) * 100 : 0;
      const sign = change >= 0 ? '+' : '';

      ohlcvEl.innerHTML =
        `<span style="color:${COLORS.text}">O</span>` +
        `<span style="color:${COLORS.textBright}">${formatPrice(bar.open)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">H</span>` +
        `<span style="color:${COLORS.bullish}">${formatPrice(bar.high)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">L</span>` +
        `<span style="color:${COLORS.bearish}">${formatPrice(bar.low)}</span>` +
        `<span style="color:${COLORS.text};margin-left:6px">C</span>` +
        `<span style="color:${COLORS.textBright}">${formatPrice(bar.close)}</span>` +
        `<span style="margin-left:8px;color:${change >= 0 ? COLORS.bullish : COLORS.bearish}">${sign}${change.toFixed(2)}%</span>`;
    };

    chart.subscribeCrosshairMove(crosshairHandler);

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height: observedHeight } = entry.contentRect;
      chart.applyOptions({
        width: Math.max(1, Math.floor(width)),
        height: Math.max(100, Math.floor(observedHeight || container.clientHeight || 388)),
      });
    });
    ro.observe(container);

    if (pendingRef.current) queuePendingFlush();

    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(crosshairHandler);
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      chartSeriesKeyRef.current = '';
      chartFirstTimeRef.current = null;
      chartLastTimeRef.current = null;
    };
  }, [isClient, queuePendingFlush]);

  useEffect(() => {
    if (!chartRef.current || !chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const totalH = fullscreen ? viewportH : height;
    chartRef.current.applyOptions({
      width: Math.max(1, container.clientWidth || (fullscreen ? window.innerWidth : 400)),
      height: Math.max(100, container.clientHeight || totalH - 52),
    });
  }, [fullscreen, height, viewportH]);

  useEffect(() => {
    const seriesKey = makeSeriesKey(pairId, timeframe, invertPrice);
    const cachedSeries = queryClient.getQueryData<CandlesResponse>(
      getCandlesQueryKey(
        pairId,
        normalizedToken0,
        normalizedToken1,
        timeframe,
        token0Decimals,
        token1Decimals,
      ),
    );
    const hasCachedSeriesData = Boolean(cachedSeries?.candles?.length);
    const isNewSeries =
      lastPairRef.current !== pairId ||
      lastTfRef.current !== timeframe ||
      lastInvertRef.current !== invertPrice;

    if (isNewSeries) {
      lastPairRef.current = pairId;
      lastTfRef.current = timeframe;
      lastInvertRef.current = invertPrice;
      if (!hasCachedSeriesData && candles.length === 0) {
        clearChartForSeries(seriesKey);
      } else {
        chartSeriesKeyRef.current = seriesKey;
        if (ohlcvRef.current) ohlcvRef.current.innerHTML = '';
      }
      setLoadingSeriesKey(seriesKey);
    }

    const previousRawCandles = lastRawCandlesRef.current;
    const previousFirstTime = firstValidTime(previousRawCandles);
    const hasConfirmedCandles = candles.length > 0;
    const chartCandles = hasConfirmedCandles
      ? withLivePrice(candles, livePrice, timeframe)
      : withLivePrice([], livePrice, timeframe);

    if (!chartCandles.length) {
      lastRawCandlesRef.current = candles;
      setLoadingSeriesKey(current => (current === seriesKey ? '' : current));
      pendingRef.current = {
        mode: 'set',
        data: [],
        fit: false,
        seriesKey,
        rawFirstTime: null,
        rawLastTime: null,
      };
      queuePendingFlush();
      return;
    }

    const canIncrementalUpdate = canUpdateLastCandle(
      previousRawCandles,
      candles,
      isNewSeries ||
        !dataInitializedRef.current ||
        chartSeriesKeyRef.current !== seriesKey,
    );
    const lastDatum = canIncrementalUpdate
      ? toChartDatum(chartCandles[chartCandles.length - 1], invertPrice)
      : null;
    const chartData = toChartData(chartCandles, invertPrice);
    const rawFirstTime = firstValidTime(chartCandles);
    const rawLastTime = lastValidTime(chartCandles);
    const historyExpandedLeft =
      hasConfirmedCandles &&
      rawFirstTime !== null &&
      (previousFirstTime === null || rawFirstTime < previousFirstTime);
    const shouldFitContent = isNewSeries || !dataInitializedRef.current || historyExpandedLeft;

    pendingRef.current = lastDatum
      ? {
          mode: 'update',
          datum: lastDatum,
          seriesKey,
          rawTime: normalizeTime(chartCandles[chartCandles.length - 1].time) ?? rawLastTime ?? 0,
          fallbackData: chartData,
          fallbackRawFirstTime: rawFirstTime,
          fallbackRawLastTime: rawLastTime,
        }
      : {
          mode: 'set',
          data: chartData,
          fit: shouldFitContent,
          seriesKey,
          rawFirstTime,
          rawLastTime,
        };

    lastRawCandlesRef.current = candles;
    setLoadingSeriesKey(current => (current === seriesKey ? '' : current));
    queuePendingFlush();
  }, [
    candles,
    livePrice,
    pairId,
    timeframe,
    invertPrice,
    clearChartForSeries,
    queuePendingFlush,
    queryClient,
    normalizedToken0,
    normalizedToken1,
    token0Decimals,
    token1Decimals,
  ]);

  const priceStats = useMemo(() => {
    const lastCandle = candles[candles.length - 1];
    const latestClose = livePrice ?? lastCandle?.close ?? 0;
    const lastPrice = invertPrice && latestClose > 0 ? 1 / latestClose : latestClose;
    const firstOpen = candles[0]?.open ?? 0;
    const firstPrice = invertPrice && firstOpen > 0 ? 1 / firstOpen : firstOpen;
    const pctChange = firstPrice ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0;
    return { lastPrice, pctChange };
  }, [candles, invertPrice, livePrice]);

  const currentSeriesKey = makeSeriesKey(pairId, timeframe, invertPrice);
  const isSeriesLoading = isLoading || loadingSeriesKey === currentSeriesKey;
  const showLoadingOverlay = isSeriesLoading && (!hasData || candles.length === 0);

  const timeframeButtons = useMemo(
    () => TF.map(tf => (
      <TfButton
        key={tf.value}
        label={tf.label}
        active={timeframe === tf.value}
        onClick={() => {
          if (tf.value === timeframe) return;
          const nextSeriesKey = makeSeriesKey(pairId, tf.value, invertPrice);
          const cached = queryClient.getQueryData<CandlesResponse>(
            getCandlesQueryKey(
              pairId,
              normalizedToken0,
              normalizedToken1,
              tf.value,
              token0Decimals,
              token1Decimals,
            ),
          );
          if (!cached?.candles?.length) clearChartForSeries(nextSeriesKey);
          setLoadingSeriesKey(nextSeriesKey);
          setTimeframe(tf.value);
        }}
      />
    )),
    [
      clearChartForSeries,
      invertPrice,
      normalizedToken0,
      normalizedToken1,
      pairId,
      queryClient,
      timeframe,
      token0Decimals,
      token1Decimals,
    ],
  );

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
      <div style={{ height: 32, background: COLORS.toolbarBg, borderBottom: `2px solid ${COLORS.border}`, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 4, flexShrink: 0 }}>
        <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.accent, letterSpacing: '0.05em' }}>
          {token0 ? `${token0.slice(0, 6)}...${token0.slice(-4)}` : '--'} / {token1 ? `${token1.slice(0, 6)}...${token1.slice(-4)}` : '--'}
        </span>

        {priceStats.lastPrice > 0 && (
          <>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: COLORS.textBright }}>{formatPrice(priceStats.lastPrice)}</span>
            <span style={{ fontFamily: "'Press Start 2P', monospace", fontSize: 7, color: priceStats.pctChange >= 0 ? COLORS.bullish : COLORS.bearish }}>
              {priceStats.pctChange >= 0 ? '+' : ''}{priceStats.pctChange.toFixed(2)}%
            </span>
          </>
        )}

        <div style={{ flex: 1 }} />
        {timeframeButtons}
      </div>

      <div
        ref={ohlcvRef}
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

      <div ref={chartContainerRef} style={{ flex: 1, minHeight: 0, width: '100%' }} />

      {showLoadingOverlay && (
        <ChartLoadingOverlay label={`LOADING ${TF.find(tf => tf.value === timeframe)?.label ?? ''}`} />
      )}

      {!showLoadingOverlay && !isSeriesLoading && !hasData && (
        <div style={{ position: 'absolute', top: 52, left: 0, right: 0, bottom: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: "'Press Start 2P', monospace", fontSize: 6, color: COLORS.text, gap: 4 }}>
          <span>NO DATA</span>
          <span style={{ color: '#2D2D44', fontSize: 5 }}>Swap on this pair to generate candles</span>
        </div>
      )}
    </div>
  );
}
