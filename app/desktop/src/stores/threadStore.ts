// Thread UI store — selection state + agent-thread binding.
// Server state is managed by TanStack Query.
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

interface ThreadState {
  selectedThreadId: string | null;
  selectedAgentId: string | null;
  /** agentId → threadId mapping for the "click agent → open thread" model */
  agentThreadMap: Record<string, string>;
  selectAgent: (agentId: string) => void;
  selectThread: (id: string) => void;
  selectAgentThread: (agentId: string, threadId: string) => void;
  ensureAgentThread: (agentId: string) => string | null;
  pruneMissingThreads: (threadIds: string[]) => void;
  clearSelection: () => void;
}

function agentForThread(agentThreadMap: Record<string, string>, threadId: string): string | null {
  const match = Object.entries(agentThreadMap).find(([, mappedThreadId]) => mappedThreadId === threadId);
  return match?.[0] ?? null;
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        selectedThreadId: null,
        selectedAgentId: null,
        agentThreadMap: {},

        selectAgent: (agentId) => {
          const { agentThreadMap } = get();
          set({
            selectedAgentId: agentId,
            selectedThreadId: agentThreadMap[agentId] ?? null,
          });
        },

        selectThread: (id) => {
          const { agentThreadMap } = get();
          set({
            selectedThreadId: id,
            selectedAgentId: agentForThread(agentThreadMap, id),
          });
        },

        selectAgentThread: (agentId, threadId) => {
          const { agentThreadMap } = get();
          const nextMap = { ...agentThreadMap };
          if (threadId) {
            nextMap[agentId] = threadId;
          } else {
            delete nextMap[agentId];
          }
          set({
            selectedAgentId: agentId,
            selectedThreadId: threadId || null,
            agentThreadMap: nextMap,
          });
        },

        ensureAgentThread: (agentId) => {
          const { agentThreadMap } = get();
          return agentThreadMap[agentId] ?? null;
        },

        pruneMissingThreads: (threadIds) => {
          const existing = new Set(threadIds);
          const { agentThreadMap, selectedThreadId } = get();
          const nextMap = Object.fromEntries(
            Object.entries(agentThreadMap).filter(([, threadId]) => existing.has(threadId)),
          );
          const nextThreadId = selectedThreadId && existing.has(selectedThreadId) ? selectedThreadId : null;
          set({
            selectedThreadId: nextThreadId,
            selectedAgentId: nextThreadId ? agentForThread(nextMap, nextThreadId) : null,
            agentThreadMap: nextMap,
          });
        },

        clearSelection: () => set({ selectedThreadId: null, selectedAgentId: null }),
      }),
      {
        name: 'agenthub-thread-selection',
        version: 1,
        partialize: (state) => ({
          selectedThreadId: state.selectedThreadId,
          selectedAgentId: state.selectedAgentId,
          agentThreadMap: state.agentThreadMap,
        }),
      },
    ),
  ),
);
