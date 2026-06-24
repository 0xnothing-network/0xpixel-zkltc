/**
 * Custom hook for real-time swap event monitoring
 * Uses wagmi's useWatchContractEvent to listen for Swapped events
 * Automatically invalidates candlestick data queries when new swaps occur
 */
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchContractEvent } from 'wagmi';
import { ZeroXDexAbi } from '@/abi/ZeroXDex';

// ============================================================
// TYPES
// ============================================================

export interface SwappedEvent {
  args: {
    sender: `0x${string}`;
    amount0In: bigint;
    amount1Out: bigint;
    price: bigint;
    to?: `0x${string}`;
    pair?: `0x${string}`;
  };
  blockNumber: bigint;
  blockHash: `0x${string}`;
  transactionHash: `0x${string}`;
  logAddress: `0x${string}`;
}

export interface UseRealtimeSwapsParams {
  /** ZeroXDex contract address */
  contractAddress: `0x${string}`;
  /** Trading pair ID to filter events (optional) */
  pairId?: string;
  /** Callback function when a new swap is detected */
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
const CANDLE_QUERY_KEYS = ['candle-data'];

// ============================================================
// MAIN HOOK
// ============================================================

/**
 * Monitors real-time swap events from the ZeroXDex contract
 * Automatically invalidates cached candlestick data to trigger chart updates
 */
export function useRealtimeSwaps({
  contractAddress,
  pairId,
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
  const handleSwapEvent = useCallback((log: SwappedEvent) => {
    // Filter by pairId if specified
    if (pairId && log.args.pair && log.args.pair.toLowerCase() !== pairId.toLowerCase()) {
      return;
    }

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
  }, [pairId, onSwap, queryClient]);

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
  contractAddress,
  pairId,
  enabled = true,
}: Omit<UseRealtimeSwapsParams, 'onSwap'>): { isWatching: boolean } {
  const queryClient = useQueryClient();

  useWatchContractEvent({
    address: contractAddress,
    abi: ZeroXDexAbi,
    eventName: 'Swapped',
    onLogs: (logs) => {
      logs.forEach((log) => {
        const swapLog = log as unknown as SwappedEvent;

        // Filter by pairId if specified
        if (pairId && swapLog.args.pair &&
            swapLog.args.pair.toLowerCase() !== pairId.toLowerCase()) {
          return;
        }

        // Invalidate candle queries on new swap
        queryClient.invalidateQueries({
          queryKey: CANDLE_QUERY_KEYS,
        });
      });
    },
    enabled,
  });

  return {
    isWatching: enabled,
  };
}
