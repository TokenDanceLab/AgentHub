// Connection state store — Edge health, WebSocket status
// 参考: OpCode agentStore caching + Kanna connection tracking
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { HealthResponse } from '@shared/types';

interface ConnectionState {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
  /** WebSocket ping-pong round-trip latency in milliseconds (QW-3). */
  wsLatency: number | null;
  setOnline: (v: boolean, health?: HealthResponse | null) => void;
  setConnected: (v: boolean) => void;
  setError: (e: string | null) => void;
  setWsLatency: (v: number | null) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  subscribeWithSelector((set) => ({
    online: false,
    health: null,
    isConnected: false,
    error: null,
    wsLatency: null,

    setOnline: (v, health) => set({ online: v, health: health ?? null }),
    setConnected: (v) => set({ isConnected: v }),
    setError: (e) => set({ error: e }),
    setWsLatency: (v) => set({ wsLatency: v }),
  })),
);
