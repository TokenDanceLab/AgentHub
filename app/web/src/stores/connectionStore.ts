// Connection state store — Edge health, WebSocket status
// 参考: OpCode agentStore caching + Kanna connection tracking
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ConnectionStatusKind } from '@shared/workbench';
import type { HealthResponse } from '@shared/types';

/** Recovery state for stream recovery after WebSocket reconnection. */
export type RecoveryState = 'idle' | 'recovering' | 'failed';

interface ConnectionState {
  online: boolean;
  health: HealthResponse | null;
  isConnected: boolean;
  error: string | null;
  /** WebSocket ping-pong round-trip latency in milliseconds (QW-3). */
  wsLatency: number | null;
  /** Whether the WebSocket transport is currently attempting reconnection. */
  reconnecting: boolean;
  /** Per-task cursor tracking: last known event_seq for each active task run. */
  lastEventSeq: Record<string, number>;
  /** Recovery state after a reconnection: idle, recovering, or failed. */
  recoveryState: RecoveryState;
  /** Error message from the last recovery attempt, if any. */
  recoveryError: string | null;
  setOnline: (v: boolean, health?: HealthResponse | null) => void;
  setConnected: (v: boolean) => void;
  setError: (e: string | null) => void;
  setWsLatency: (v: number | null) => void;
  setReconnecting: (v: boolean) => void;
  setLastEventSeq: (taskId: string, seq: number) => void;
  clearLastEventSeq: (taskId: string) => void;
  setRecoveryState: (v: RecoveryState) => void;
  setRecoveryError: (e: string | null) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  subscribeWithSelector((set) => ({
    online: false,
    health: null,
    isConnected: false,
    error: null,
    wsLatency: null,
    reconnecting: false,
    lastEventSeq: {},
    recoveryState: 'idle',
    recoveryError: null,

    setOnline: (v, health) => set({ online: v, health: health ?? null }),
    setConnected: (v) => set({ isConnected: v }),
    setError: (e) => set({ error: e }),
    setWsLatency: (v) => set({ wsLatency: v }),
    setReconnecting: (v) => set({ reconnecting: v }),
    setLastEventSeq: (taskId, seq) =>
      set((s) => ({
        lastEventSeq: { ...s.lastEventSeq, [taskId]: seq },
      })),
    clearLastEventSeq: (taskId) =>
      set((s) => {
        const { [taskId]: _removed, ...next } = s.lastEventSeq;
        return { lastEventSeq: next };
      }),
    setRecoveryState: (v) => set({ recoveryState: v }),
    setRecoveryError: (e) => set({ recoveryError: e }),
  })),
);

/**
 * Maps the raw WebSocket flags to the workbench connection indicator kind
 * (#1816): connected → live; reconnecting → connecting (a recovery attempt
 * is in flight); anything else → disconnected.
 */
export function deriveWorkbenchConnectionStatus(
  state: Pick<ConnectionState, 'isConnected' | 'reconnecting'>,
): ConnectionStatusKind {
  if (state.isConnected) return 'connected';
  if (state.reconnecting) return 'connecting';
  return 'disconnected';
}
