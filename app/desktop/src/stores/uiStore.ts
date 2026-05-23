// UI state store — sidebar widths, theme, responsive toggles
// 参考: Multica tab-store.ts + OpCode Zustand subscribeWithSelector
import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';

interface UIState {
  sidebarWidth: number;
  rightPanelWidth: number;
  theme: 'dark' | 'light' | 'system';
  // Mobile toggles
  mobileSidebarOpen: boolean;
  mobileRightPanelOpen: boolean;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setTheme: (t: 'dark' | 'light' | 'system') => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setMobileRightPanelOpen: (v: boolean) => void;
  toggleMobileSidebar: () => void;
  toggleMobileRightPanel: () => void;
}

export const useUIStore = create<UIState>()(
  subscribeWithSelector((set) => ({
    sidebarWidth: 280,
    rightPanelWidth: 320,
    theme: 'dark',
    mobileSidebarOpen: false,
    mobileRightPanelOpen: false,

    setSidebarWidth: (w) => set({ sidebarWidth: w }),
    setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
    setTheme: (t) => {
      set({ theme: t });
      const root = document.documentElement;
      root.classList.toggle(
        'dark',
        t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches),
      );
    },
    setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
    setMobileRightPanelOpen: (v) => set({ mobileRightPanelOpen: v }),
    toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
    toggleMobileRightPanel: () => set((s) => ({ mobileRightPanelOpen: !s.mobileRightPanelOpen })),
  })),
);
