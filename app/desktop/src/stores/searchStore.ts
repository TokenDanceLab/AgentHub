// Global search state — client-side index
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

export interface SearchResult {
  id: string;
  type: 'thread' | 'message' | 'tool_call' | 'file';
  title: string;
  snippet: string;
  threadId?: string;
}

interface SearchState {
  open: boolean;
  query: string;
  results: SearchResult[];
  selectedIndex: number;
  openDialog: () => void;
  closeDialog: () => void;
  setQuery: (q: string) => void;
  setResults: (r: SearchResult[]) => void;
  setSelectedIndex: (i: number) => void;
}

export const useSearchStore = create<SearchState>()(
  subscribeWithSelector((set) => ({
  open: false,
  query: '',
  results: [],
  selectedIndex: 0,
  openDialog: () => set({ open: true, query: '', results: [], selectedIndex: 0 }),
  closeDialog: () => set({ open: false }),
  setQuery: (q) => set({ query: q, selectedIndex: 0 }),
  setResults: (r) => set({ results: r }),
  setSelectedIndex: (i) => set({ selectedIndex: i }),
  })),
);
