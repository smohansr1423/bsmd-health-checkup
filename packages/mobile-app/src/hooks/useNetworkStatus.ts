import { useCallback, useEffect, useRef, useState } from 'react';
import NetInfo, { NetInfoState } from '@react-native-community/netinfo';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NetworkStatus {
  /** Whether the device currently has network connectivity */
  isConnected: boolean;
  /** Whether the device was previously offline and just reconnected */
  isReconnecting: boolean;
  /** The type of network connection (wifi, cellular, etc.) */
  connectionType: string | null;
  /** Timestamp of the last connectivity change (epoch ms) */
  lastChangedAt: number | null;
}

export interface UseNetworkStatusResult {
  /** Current network status */
  status: NetworkStatus;
  /** Whether the device is offline */
  isOffline: boolean;
  /** Whether the device just reconnected (useful for triggering refresh) */
  isReconnecting: boolean;
  /** Register a callback to be invoked when connectivity is restored */
  onReconnect: (callback: () => void) => void;
  /** Manually check connectivity (returns current state) */
  checkConnectivity: () => Promise<boolean>;
}

// ─── useNetworkStatus Hook ───────────────────────────────────────────────────

/**
 * Hook that provides reactive network connectivity status using
 * @react-native-community/netinfo. Supports:
 * - Real-time connectivity monitoring via subscription
 * - Reconnection detection for auto-refresh triggers
 * - Callback registration for reconnect events
 *
 * Validates: Requirements 12.2, 12.4, 12.6
 */
export function useNetworkStatus(): UseNetworkStatusResult {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true, // Assume online initially
    isReconnecting: false,
    connectionType: null,
    lastChangedAt: null,
  });

  const previousConnectedRef = useRef<boolean>(true);
  const reconnectCallbacksRef = useRef<Array<() => void>>([]);
  const reconnectingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state: NetInfoState) => {
      const isConnected = state.isConnected ?? false;
      const wasDisconnected = !previousConnectedRef.current;
      const justReconnected = isConnected && wasDisconnected;

      setStatus({
        isConnected,
        isReconnecting: justReconnected,
        connectionType: state.type ?? null,
        lastChangedAt: Date.now(),
      });

      // If just reconnected, invoke registered callbacks
      if (justReconnected) {
        reconnectCallbacksRef.current.forEach((cb) => {
          try {
            cb();
          } catch {
            // Silently ignore callback errors
          }
        });

        // Clear the reconnecting flag after a short delay
        if (reconnectingTimeoutRef.current) {
          clearTimeout(reconnectingTimeoutRef.current);
        }
        reconnectingTimeoutRef.current = setTimeout(() => {
          setStatus((prev) => ({ ...prev, isReconnecting: false }));
        }, 3000);
      }

      previousConnectedRef.current = isConnected;
    });

    // Fetch initial state
    NetInfo.fetch().then((state: NetInfoState) => {
      const isConnected = state.isConnected ?? false;
      previousConnectedRef.current = isConnected;
      setStatus({
        isConnected,
        isReconnecting: false,
        connectionType: state.type ?? null,
        lastChangedAt: Date.now(),
      });
    });

    return () => {
      unsubscribe();
      if (reconnectingTimeoutRef.current) {
        clearTimeout(reconnectingTimeoutRef.current);
      }
    };
  }, []);

  const onReconnect = useCallback((callback: () => void) => {
    reconnectCallbacksRef.current.push(callback);
  }, []);

  const checkConnectivity = useCallback(async (): Promise<boolean> => {
    const state = await NetInfo.fetch();
    return state.isConnected ?? false;
  }, []);

  return {
    status,
    isOffline: !status.isConnected,
    isReconnecting: status.isReconnecting,
    onReconnect,
    checkConnectivity,
  };
}
