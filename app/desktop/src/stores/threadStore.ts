// Thread UI store — selection state + agent-thread binding.
// Server state is managed by TanStack Query.
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

interface ThreadState {
  selectedThreadId: string | null;
  selectedAgentId: string | null;
  /** agentId → threadId mapping for the "click agent → open thread" model */
  agentThreadMap: Record<string, string>;
  /** threadId → list of agent IDs that have participated in this thread (ordered by join time) */
  threadAgents: Record<string, string[]>;
  selectAgent: (agentId: string) => void;
  selectThread: (id: string) => void;
  selectAgentThread: (agentId: string, threadId: string) => void;
  ensureAgentThread: (agentId: string) => string | null;
  /**
   * Switch the active agent for a thread mid-conversation.
   * Returns handoff context { previousAgentId, newAgentId } so the caller can inject a system message.
   */
  switchThreadAgent: (threadId: string, agentId: string) => { previousAgentId: string | null; newAgentId: string };
  pruneMissingThreads: (threadIds: string[]) => void;
  clearSelection: () => void;
}

function agentForThread(agentThreadMap: Record<string, string>, threadId: string): string | null {
  const match = Object.entries(agentThreadMap).find(([, mappedThreadId]) => mappedThreadId === threadId);
  return match?.[0] ?? null;
}

/** Derive the active agent for a thread: last entry in threadAgents, falling back to agentThreadMap reverse lookup. */
function resolveThreadAgent(
  threadId: string | null,
  threadAgents: Record<string, string[]>,
  agentThreadMap: Record<string, string>,
): string | null {
  if (!threadId) return null;
  const list = threadAgents[threadId];
  if (list && list.length > 0) return list[list.length - 1]!;
  return agentForThread(agentThreadMap, threadId);
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        selectedThreadId: null,
        selectedAgentId: null,
        agentThreadMap: {},
        threadAgents: {},

        selectAgent: (agentId) => {
          const { agentThreadMap } = get();
          set({
            selectedAgentId: agentId,
            selectedThreadId: agentThreadMap[agentId] ?? null,
          });
        },

        selectThread: (id) => {
          const { agentThreadMap, threadAgents } = get();
          set({
            selectedThreadId: id,
            selectedAgentId: resolveThreadAgent(id, threadAgents, agentThreadMap),
          });
        },

        selectAgentThread: (agentId, threadId) => {
          const { agentThreadMap, threadAgents } = get();
          const nextMap = { ...agentThreadMap };
          const nextThreadAgents = { ...threadAgents };
          if (threadId) {
            nextMap[agentId] = threadId;
            // Add agent to the thread's agent list, moving to end if already present
            const existing = nextThreadAgents[threadId] ?? [];
            nextThreadAgents[threadId] = [...existing.filter((id) => id !== agentId), agentId];
          } else {
            delete nextMap[agentId];
          }
          set({
            selectedAgentId: agentId,
            selectedThreadId: threadId || null,
            agentThreadMap: nextMap,
            threadAgents: nextThreadAgents,
          });
        },

        ensureAgentThread: (agentId) => {
          const { agentThreadMap } = get();
          return agentThreadMap[agentId] ?? null;
        },

        switchThreadAgent: (threadId, agentId) => {
          const { threadAgents } = get();
          const previousAgentId = get().selectedAgentId;
          const nextThreadAgents = { ...threadAgents };
          const existing = nextThreadAgents[threadId] ?? [];
          nextThreadAgents[threadId] = [...existing.filter((id) => id !== agentId), agentId];
          set({
            selectedAgentId: agentId,
            threadAgents: nextThreadAgents,
          });
          return { previousAgentId, newAgentId: agentId };
        },

        pruneMissingThreads: (threadIds) => {
          const existing = new Set(threadIds);
          const { agentThreadMap, threadAgents, selectedThreadId } = get();
          const nextMap = Object.fromEntries(
            Object.entries(agentThreadMap).filter(([, threadId]) => existing.has(threadId)),
          );
          const nextThreadAgents: Record<string, string[]> = {};
          for (const [tid, agentIds] of Object.entries(threadAgents)) {
            if (existing.has(tid)) {
              nextThreadAgents[tid] = agentIds;
            }
          }
          const nextThreadId = selectedThreadId && existing.has(selectedThreadId) ? selectedThreadId : null;
          const nextAgentId = resolveThreadAgent(nextThreadId, nextThreadAgents, nextMap);
          set({
            selectedThreadId: nextThreadId,
            selectedAgentId: nextAgentId,
            agentThreadMap: nextMap,
            threadAgents: nextThreadAgents,
          });
        },

        clearSelection: () => set({ selectedThreadId: null, selectedAgentId: null }),
      }),
      {
        name: 'agenthub-thread-selection',
        version: 2,
        migrate: (persisted) => {
          const state = (persisted && typeof persisted === 'object' && 'state' in persisted)
            ? (persisted as { state?: Partial<ThreadState> }).state
            : (persisted as Partial<ThreadState> | undefined);
          return {
            selectedThreadId: state?.selectedThreadId ?? null,
            selectedAgentId: state?.selectedAgentId ?? null,
            agentThreadMap: state?.agentThreadMap ?? {},
            threadAgents: state?.threadAgents ?? {},
          };
        },
        partialize: (state) => ({
          selectedThreadId: state.selectedThreadId,
          selectedAgentId: state.selectedAgentId,
          agentThreadMap: state.agentThreadMap,
          threadAgents: state.threadAgents,
        }),
      },
    ),
  ),
);
