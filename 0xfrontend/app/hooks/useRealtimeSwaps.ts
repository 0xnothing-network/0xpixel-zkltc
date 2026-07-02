/**
 * Custom hook for real-time swap event monitoring
 * Uses wagmi's useWatchContractEvent to listen for Swapped events
 * Automatically invalidates candlestick data queries when new swaps occur
 *
 * NOTE: The 0xDex contract (ZeroDex) emits Swapped with:
 *   user (indexed), tokenIn, tokenOut, amountIn, amountOut, fee
 * — this differs from a typical UniswapV2 Swap event.
 */
'use client';

import { useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchContractEvent } from 'wagmi';
import { ZeroXDexAbi, ZEROXDEX_ADDRESS } from '@/abi/ZeroXDex';

// ============================================================
// TYPES — match 0xDex.sol Swapped event signature exactly
// ============================================================

export interface SwappedEventArgs {
  user: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
}

export interface SwappedEvent {
  args: SwappedEventArgs;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logAddress: `0x${string}`;
}

export interface UseRealtimeSwapsParams {
  /** 0xDex contract address. Defaults to ZEROXDEX_ADDRESS (0x873c...C818) */
  contractAddress?: `0x${string}`;
  /** Optional callback when a new swap is detected */
  onSwap?: (event: SwappedEvent) => void;
  /** Enable real-time monitoring */
  enabled?: boolean;
}

export interface UseRealtimeSwapsReturn {
  /** Latest swap event */
  latestSwap: SwappedEvent | null;
  /** Whether the watcher is actively listening */
  isWatching: boolean;
}

// ============================================================
// CONSTANTS
// ============================================================

// Query keys to invalidate when new swaps occur
const CANDLE_QUERY_KEYS = ['candles-edge-v12'];

// ============================================================
// MAIN HOOK
// ============================================================

/**
 * Monitors real-time swap events from the 0xDex contract
 * Automatically invalidates cached candlestick data to trigger chart updates
 */
export function useRealtimeSwaps({
  contractAddress = ZEROXDEX_ADDRESS,
  onSwap,
  enabled = true,
}: UseRealtimeSwapsParams): UseRealtimeSwapsReturn {
  const queryClient = useQueryClient();

  // Use ref to store latest swap without causing re-renders
  const latestSwapRef = useRef<SwappedEvent | null>(null);

  /**
   * Handle incoming swap events
   * - Stores the event in ref
   * - Calls optional callback
   * - Invalidates candlestick queries to trigger refetch
   */
  const handleSwapEvent = useCallback(
    (log: SwappedEvent) => {
      latestSwapRef.current = log;

      // Notify external handlers
      if (onSwap) {
        onSwap(log);
      }

      // Invalidate all candle data queries to trigger background refetch
      queryClient.invalidateQueries({
        queryKey: CANDLE_QUERY_KEYS,
        refetchType: 'active',
      });
    },
    [onSwap, queryClient],
  );

  // Set up the contract event watcher
  useWatchContractEvent({
    address: contractAddress,
    abi: ZeroXDexAbi,
    eventName: 'Swapped',
    onLogs: (logs) => {
      logs.forEach((log) => {
        handleSwapEvent(log as unknown as SwappedEvent);
      });
    },
    enabled,
  });

  return {
    latestSwap: latestSwapRef.current,
    isWatching: enabled,
  };
}

// ============================================================
// SIMPLIFIED INVALIDATOR HOOK
// ============================================================

/**
 * Simplified hook that only invalidates candlestick queries
 * Use when you don't need to track individual swap events
 */
export function useSwapEventInvalidator({
  contractAddress = ZEROXDEX_ADDRESS,
  enabled = true,
}: Omit<UseRealtimeSwapsParams, 'onSwap'>): { isWatching: boolean } {
  const queryClient = useQueryClient();

  useWatchContractEvent({
    address: contractAddress,
    abi: ZeroXDexAbi,
    eventName: 'Swapped',
    onLogs: () => {
      // Invalidate candle queries on new swap
      queryClient.invalidateQueries({
        queryKey: CANDLE_QUERY_KEYS,
      });
    },
    enabled,
  });

  return {
    isWatching: enabled,
  };
}
