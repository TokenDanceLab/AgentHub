// UI state store — sidebar widths, theme, responsive toggles
// 参考: Multica tab-store.ts + OpCode Zustand subscribeWithSelector
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

interface UIState {
  sidebarWidth: number;
  rightPanelWidth: number;
  leftSidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  // Mobile toggles
  mobileSidebarOpen: boolean;
  mobileRightPanelOpen: boolean;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setLeftSidebarCollapsed: (v: boolean) => void;
  setRightPanelOpen: (v: boolean) => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setMobileRightPanelOpen: (v: boolean) => void;
  toggleLeftSidebar: () => void;
  toggleRightPanel: () => void;
  toggleMobileSidebar: () => void;
  toggleMobileRightPanel: () => void;
}

export const useUIStore = create<UIState>()(
  subscribeWithSelector(
    persist(
      (set) => ({
        sidebarWidth: 396,
        rightPanelWidth: 360,
        leftSidebarCollapsed: false,
        rightPanelOpen: false,
        mobileSidebarOpen: false,
        mobileRightPanelOpen: false,

        setSidebarWidth: (w) => set({ sidebarWidth: w }),
        setRightPanelWidth: (w) => set({ rightPanelWidth: w }),
        setLeftSidebarCollapsed: (v) => set({ leftSidebarCollapsed: v }),
        setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
        setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
        setMobileRightPanelOpen: (v) => set({ mobileRightPanelOpen: v }),
        toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
        toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
        toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
        toggleMobileRightPanel: () => set((s) => ({ mobileRightPanelOpen: !s.mobileRightPanelOpen })),
      }),
      {
        name: 'agenthub-ui-shell',
        partialize: (s) => ({
          sidebarWidth: s.sidebarWidth,
          rightPanelWidth: s.rightPanelWidth,
          leftSidebarCollapsed: s.leftSidebarCollapsed,
          rightPanelOpen: s.rightPanelOpen,
        }),
      },
    ),
  ),
);
