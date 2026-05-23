// Thread store — only UI state (selected thread).
// Thread list CRUD is now managed by TanStack Query (see @/api/threadQueries).
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface ThreadState {
  selectedThreadId: string | null;
  selectThread: (id: string) => void;
}

export const useThreadStore = create<ThreadState>()(
  subscribeWithSelector((set) => ({
    selectedThreadId: null,
    selectThread: (id) => set({ selectedThreadId: id }),
  })),
);
