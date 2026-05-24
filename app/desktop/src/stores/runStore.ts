// Run state store — active runs, tool calls, file changes, output.
// 参考: Kanna AgentCoordinator dual-Map (activeTurns + drainingStreams)
// P0-1: Uses formal RunStateMachine from @/utils/runStateMachine for validated transitions.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { RunState, RunStateMachine } from '@/utils/runStateMachine';

export type { RunState } from '@/utils/runStateMachine';
export { RunState as RunPhase } from '@/utils/runStateMachine';

export interface RunStateData {
  runId: string;
  status: RunState;
  outputText: string;
  toolCalls: Array<{ callId: string; toolName: string; status: string; timestamp: string }>;
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
}

interface RunStore {
  currentRun: RunStateData | null;
  isStreaming: boolean;
  setCurrentRun: (run: RunStateData | null) => void;
  /** Backward-compat: map legacy string → RunState, validate transition, then set. */
  updateRunStatus: (status: string) => void;
  /** Validate and perform a typed RunState transition. Returns false if rejected. */
  transitionStatus: (to: RunState) => boolean;
  appendOutput: (text: string) => void;
  addToolCall: (tc: RunStateData['toolCalls'][number]) => void;
  updateToolCallStatus: (callId: string, status: string) => void;
  addFileChange: (fc: RunStateData['changedFiles'][number]) => void;
  setIsStreaming: (v: boolean) => void;
  clear: () => void;
}

const sm = new RunStateMachine();

export const useRunStore = create<RunStore>()(
  subscribeWithSelector((set) => ({
    currentRun: null,
    isStreaming: false,

    setCurrentRun: (run) => {
      // Sync the singleton state machine with the incoming run's status.
      if (run && run.status !== sm.getState()) {
        if (!sm.transition(run.status)) {
          // Force-reset and transition for initial load / external sync
          sm.reset();
          sm.transition(run.status);
        }
      } else if (!run) {
        sm.reset();
      }
      set({ currentRun: run });
    },

    updateRunStatus: (raw) => {
      const mapped = RunStateMachine.fromLegacyStatus(raw);
      const ok = sm.transition(mapped);
      if (!ok) {
        console.warn(
          `[runStore] updateRunStatus rejected: current=${sm.getState()} incoming="${raw}" mapped=${mapped}`,
        );
      }
      set((s) =>
        s.currentRun ? { currentRun: { ...s.currentRun, status: mapped } } : {},
      );
    },

    transitionStatus: (to) => {
      const ok = sm.transition(to);
      if (ok) {
        set((s) =>
          s.currentRun ? { currentRun: { ...s.currentRun, status: to } } : {},
        );
      } else {
        console.warn(
          `[runStore] transitionStatus rejected: ${sm.getState()} → ${to}`,
        );
      }
      return ok;
    },

    appendOutput: (text) =>
      set((s) =>
        s.currentRun
          ? { currentRun: { ...s.currentRun, outputText: s.currentRun.outputText + text } }
          : {},
      ),

    addToolCall: (tc) =>
      set((s) =>
        s.currentRun
          ? { currentRun: { ...s.currentRun, toolCalls: [...s.currentRun.toolCalls, tc] } }
          : {},
      ),

    updateToolCallStatus: (callId, status) =>
      set((s) =>
        s.currentRun
          ? {
              currentRun: {
                ...s.currentRun,
                toolCalls: s.currentRun.toolCalls.map((t) =>
                  t.callId === callId ? { ...t, status } : t,
                ),
              },
            }
          : {},
      ),

    addFileChange: (fc) =>
      set((s) =>
        s.currentRun
          ? { currentRun: { ...s.currentRun, changedFiles: [...s.currentRun.changedFiles, fc] } }
          : {},
      ),

    setIsStreaming: (v) => set({ isStreaming: v }),

    clear: () => {
      sm.reset();
      set({ currentRun: null, isStreaming: false });
    },
  })),
);
