// File search modal state
import { create } from 'zustand';

export type FileSearchMode = 'filename' | 'content';

interface FileSearchState {
  open: boolean;
  query: string;
  selectedIndex: number;
  mode: FileSearchMode;
  workspaceDir: string;
  searching: boolean;

  openDialog: (mode?: FileSearchMode, workspaceDir?: string) => void;
  closeDialog: () => void;
  setQuery: (q: string) => void;
  setSelectedIndex: (i: number) => void;
  setMode: (m: FileSearchMode) => void;
  setWorkspaceDir: (dir: string) => void;
  setSearching: (v: boolean) => void;
}

export const useFileSearchStore = create<FileSearchState>()((set) => ({
  open: false,
  query: '',
  selectedIndex: 0,
  mode: 'filename',
  workspaceDir: '',
  searching: false,

  openDialog: (mode = 'filename', workspaceDir = '') =>
    set({
      open: true,
      query: '',
      selectedIndex: 0,
      mode,
      workspaceDir,
      searching: false,
    }),
  closeDialog: () => set({ open: false }),
  setQuery: (q) => set({ query: q, selectedIndex: 0 }),
  setSelectedIndex: (i) => set({ selectedIndex: i }),
  setMode: (m) => set({ mode: m, selectedIndex: 0 }),
  setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
  setSearching: (v) => set({ searching: v }),
}));
