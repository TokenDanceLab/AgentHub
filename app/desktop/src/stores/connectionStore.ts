// Connection state store — Edge health, WebSocket status
// 参考: OpCode agentStore caching + Kanna connection tracking
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { HealthResponse } from '@shared/types';
import type { TransportStatus } from '@/api/transport';

interface ConnectionState {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  /** Granular WebSocket transport status (connecting/reconnecting/connected/disconnected). */
  connectionStatus: TransportStatus;
  error: string | null;
  /** WebSocket ping-pong round-trip latency in milliseconds (QW-3). */
  wsLatency: number | null;
  /**
   * Set when the Hub reports this device session was kicked
   * (`device.kicked`, e.g. replaced by a login on another device).
   * The shell observes it, surfaces feedback and returns to the login entry.
   */
  kickedReason: string | null;
  setOnline: (v: boolean, health?: HealthResponse | null) => void;
  setConnected: (v: boolean) => void;
  /** Update granular WebSocket transport status. Derived `isConnected` is set automatically. */
  setConnectionStatus: (s: TransportStatus) => void;
  setError: (e: string | null) => void;
  setWsLatency: (v: number | null) => void;
  markKicked: (reason: string) => void;
  clearKicked: () => void;
}

export const useConnectionStore = create<ConnectionState>()(
  subscribeWithSelector((set) => ({
    online: false,
    health: null,
    isConnected: false,
    connectionStatus: 'disconnected',
    error: null,
    wsLatency: null,
    kickedReason: null,

    setOnline: (v, health) => set({ online: v, health: health ?? null }),
    setConnected: (v) => set({ isConnected: v }),
    setConnectionStatus: (s) =>
      set({
        connectionStatus: s,
        isConnected: s === 'connected',
      }),
    setError: (e) => set({ error: e }),
    setWsLatency: (v) => set({ wsLatency: v }),
    markKicked: (reason) => set({ kickedReason: reason, isConnected: false }),
    clearKicked: () => set({ kickedReason: null }),
  })),
);
