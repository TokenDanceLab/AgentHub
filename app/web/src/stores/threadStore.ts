// Thread UI store — selection state + agent-thread binding.
// Server state is managed by TanStack Query.
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface ThreadState {
  selectedThreadId: string | null;
  selectedAgentId: string | null;
  /** agentId → threadId mapping for the "click agent → open thread" model */
  agentThreadMap: Record<string, string>;
  selectThread: (id: string) => void;
  selectAgentThread: (agentId: string, threadId: string) => void;
  ensureAgentThread: (agentId: string) => string | null;
  clearSelection: () => void;
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector((set, get) => ({
    selectedThreadId: null,
    selectedAgentId: null,
    agentThreadMap: {},

    selectThread: (id) => set({ selectedThreadId: id, selectedAgentId: null }),

    selectAgentThread: (agentId, threadId) => {
      const { agentThreadMap } = get();
      set({
        selectedAgentId: agentId,
        selectedThreadId: threadId,
        agentThreadMap: { ...agentThreadMap, [agentId]: threadId },
      });
    },

    ensureAgentThread: (agentId) => {
      const { agentThreadMap } = get();
      return agentThreadMap[agentId] ?? null;
    },

    clearSelection: () => set({ selectedThreadId: null, selectedAgentId: null }),
  })),
);
