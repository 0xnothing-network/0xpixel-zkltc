// ============================================================
// Hooks
// ============================================================

export { useCandleData, buildCandles } from './useCandleData';
export type {
  CandleData,
  SwapEvent,
  UseCandleDataParams,
  UseCandleDataReturn,
} from './useCandleData';

export { useRealtimeSwaps, useSwapEventInvalidator } from './useRealtimeSwaps';
export type {
  SwappedEvent,
  UseRealtimeSwapsParams,
  UseRealtimeSwapsReturn,
} from './useRealtimeSwaps';
