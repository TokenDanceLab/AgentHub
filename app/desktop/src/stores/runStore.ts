// Run UI store — client-only state for the active run session.
// P0-1: Server data (outputText, toolCalls, changedFiles) removed —
// those belong in TanStack Query (run metadata) and useChatMessages reducer (streaming).
// RunState and AgentLoopState are formal state machine types from @/utils/runStateMachine.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { RunState, RunStateMachine } from '@/utils/runStateMachine';

export type { RunState } from '@/utils/runStateMachine';
export { RunState as RunPhase } from '@/utils/runStateMachine';

export type AgentLoopState =
  | 'NO_TASK'
  | 'RUNNING'
  | 'STREAMING'
  | 'WAITING_FOR_INPUT'
  | 'DRAINING'
  | 'IDLE'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

/** Live token usage snapshot, updated on each context_usage event. */
export interface TokenStats {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  contextLimit?: number | undefined;
  usagePercent?: number | undefined;
}

function agentLoopFromRunState(rs: RunState): AgentLoopState {
  switch (rs) {
    case RunState.RUNNING: return 'RUNNING';
    case RunState.STREAMING: return 'STREAMING';
    case RunState.WAITING_FOR_INPUT: return 'WAITING_FOR_INPUT';
    case RunState.DRAINING: return 'DRAINING';
    case RunState.COMPLETED: return 'COMPLETED';
    case RunState.FAILED: return 'FAILED';
    case RunState.CANCELLED: return 'CANCELLED';
    default: return 'NO_TASK';
  }
}

interface RunUIStore {
  isStreaming: boolean;
  currentRunId: string | null;
  runState: AgentLoopState;
  loopCount: number;
  errorCount: number;
  abortController: AbortController | null;
  fileReadCache: Map<string, { readCount: number; mtime: number }>;
  /** Latest token usage snapshot from context_usage events. */
  tokenStats: TokenStats | null;

  setRunState: (state: RunState) => void;
  setStreaming: (v: boolean) => void;
  setRun: (runId: string) => void;
  incrementLoopCount: () => void;
  incrementErrorCount: () => void;
  setAbortController: (ctrl: AbortController | null) => void;
  checkFileReadCache: (path: string, mtime: number) => boolean;
  setTokenStats: (stats: TokenStats | null) => void;
  clear: () => void;
}

const sm = new RunStateMachine();

export const useRunStore = create<RunUIStore>()(
  subscribeWithSelector((set, get) => ({
    isStreaming: false,
    currentRunId: null,
    runState: 'NO_TASK',
    loopCount: 0,
    errorCount: 0,
    abortController: null,
    fileReadCache: new Map(),
    tokenStats: null,

    setRunState: (rs) => {
      const ok = sm.transition(rs);
      if (!ok) {
        console.warn(`[runStore] Invalid transition: ${sm.getState()} → ${rs}`);
      }
      set({ runState: agentLoopFromRunState(rs), isStreaming: !sm.isTerminal() && rs !== RunState.IDLE });
    },

    setStreaming: (isStreaming) => set({ isStreaming }),

    setRun: (runId) => {
      sm.reset();
      sm.transition(RunState.RUNNING);
      set({ currentRunId: runId, runState: 'RUNNING', isStreaming: true, loopCount: 0, errorCount: 0 });
    },

    incrementLoopCount: () => set((s) => ({ loopCount: s.loopCount + 1 })),
    incrementErrorCount: () => set((s) => ({ errorCount: s.errorCount + 1 })),

    setAbortController: (ctrl) => {
      const prev = get().abortController;
      if (prev) prev.abort();
      set({ abortController: ctrl });
    },

    setTokenStats: (stats) => set({ tokenStats: stats }),

    checkFileReadCache: (path, mtime) => {
      const cached = get().fileReadCache.get(path);
      if (cached && cached.mtime === mtime) {
        set((s) => {
          const next = new Map(s.fileReadCache);
          next.set(path, { readCount: cached.readCount + 1, mtime });
          return { fileReadCache: next };
        });
        return true;
      }
      return false;
    },

    clear: () => {
      sm.reset();
      const ctrl = get().abortController;
      if (ctrl) ctrl.abort();
      set({
        isStreaming: false,
        currentRunId: null,
        runState: 'NO_TASK',
        loopCount: 0,
        errorCount: 0,
        abortController: null,
        fileReadCache: new Map(),
        tokenStats: null,
      });
    },
  })),
);
