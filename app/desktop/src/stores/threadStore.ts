// Thread store — thread list, active thread, search filter
// 参考: LibreChat groupConversationsByDate + Multica persist partialize
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
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector((set) => ({
    threads: [],
    selectedThreadId: null,
    searchQuery: '',

    setThreads: (threads) => set({ threads }),
    selectThread: (id) => set({ selectedThreadId: id }),
    setSearchQuery: (q) => set({ searchQuery: q }),
  }))
);
