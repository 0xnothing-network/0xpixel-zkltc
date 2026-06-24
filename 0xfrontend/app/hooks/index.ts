// ============================================================
// Hooks
// ============================================================

export { useCandleData, TIMEFRAME_OPTIONS } from './useCandleData';
export type {
  CandleData,
  SwapEvent,
  UseCandleDataParams,
  UseCandleDataReturn,
  TimeframeValue,
} from './useCandleData';

export { useRealtimeSwaps, useSwapEventInvalidator } from './useRealtimeSwaps';
export type {
  SwappedEvent,
  UseRealtimeSwapsParams,
  UseRealtimeSwapsReturn,
} from './useRealtimeSwaps';
