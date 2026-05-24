// Thread UI store — selection state only. Server state is managed by TanStack Query.
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
