// Run state store — active runs, tool calls, file changes, output
// 参考: Kanna AgentCoordinator dual-Map (activeTurns + drainingStreams)
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface RunState {
  runId: string;
  status: string;
  outputText: string;
  toolCalls: Array<{ callId: string; toolName: string; status: string; timestamp: string }>;
  changedFiles: Array<{ path: string; action: string; timestamp: string }>;
}

interface RunStore {
  currentRun: RunState | null;
  isStreaming: boolean;
  setCurrentRun: (run: RunState | null) => void;
  updateRunStatus: (status: string) => void;
  appendOutput: (text: string) => void;
  addToolCall: (tc: RunState['toolCalls'][number]) => void;
  updateToolCallStatus: (callId: string, status: string) => void;
  addFileChange: (fc: RunState['changedFiles'][number]) => void;
  setIsStreaming: (v: boolean) => void;
  clear: () => void;
}

export const useRunStore = create<RunStore>()(
  subscribeWithSelector((set) => ({
    currentRun: null,
    isStreaming: false,

    setCurrentRun: (run) => set({ currentRun: run }),
    updateRunStatus: (status) =>
      set((s) => (s.currentRun ? { currentRun: { ...s.currentRun, status } } : {})),
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
    clear: () => set({ currentRun: null, isStreaming: false }),
  })),
);
