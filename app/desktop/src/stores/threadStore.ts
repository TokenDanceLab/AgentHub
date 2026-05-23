// Thread store — thread list, active thread, and mutation helpers
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { ThreadInfo } from '@shared/types';

interface ThreadState {
  threads: ThreadInfo[];
  selectedThreadId: string | null;
  searchQuery: string;
  setThreads: (threads: ThreadInfo[]) => void;
  selectThread: (id: string) => void;
  setSearchQuery: (q: string) => void;
  removeThread: (id: string) => void;
  renameThread: (id: string, title: string) => void;
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector((set) => ({
    threads: [],
    selectedThreadId: null,
    searchQuery: '',

    setThreads: (threads) => set({ threads }),
    selectThread: (id) => set({ selectedThreadId: id }),
    setSearchQuery: (q) => set({ searchQuery: q }),
    removeThread: (id) =>
      set((state) => ({
        threads: state.threads.filter((t) => t.threadId !== id),
        selectedThreadId: state.selectedThreadId === id ? null : state.selectedThreadId,
      })),
    renameThread: (id, title) =>
      set((state) => ({
        threads: state.threads.map((t) =>
          t.threadId === id ? { ...t, title } : t,
        ),
      })),
  })),
);
