// UI state store — sidebar widths, theme, responsive toggles
// 参考: Multica tab-store.ts + OpCode Zustand subscribeWithSelector
import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

const SIDEBAR_MIN = 248;
const SIDEBAR_MAX = 420;
const RIGHT_PANEL_MIN = 238;
const RIGHT_PANEL_MAX = 360;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

interface UIState {
  sidebarWidth: number;
  rightPanelWidth: number;
  leftSidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  leftSidebarView: 'home' | 'thread';
  // Mobile toggles
  mobileSidebarOpen: boolean;
  mobileRightPanelOpen: boolean;
  setSidebarWidth: (w: number) => void;
  setRightPanelWidth: (w: number) => void;
  setLeftSidebarCollapsed: (v: boolean) => void;
  setRightPanelOpen: (v: boolean) => void;
  setLeftSidebarView: (v: 'home' | 'thread') => void;
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
        sidebarWidth: 320,
        rightPanelWidth: 360,
        leftSidebarCollapsed: false,
        rightPanelOpen: false,
        leftSidebarView: 'home',
        mobileSidebarOpen: false,
        mobileRightPanelOpen: false,

        setSidebarWidth: (w) => set({ sidebarWidth: clamp(w, SIDEBAR_MIN, SIDEBAR_MAX) }),
        setRightPanelWidth: (w) => set({ rightPanelWidth: clamp(w, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX) }),
        setLeftSidebarCollapsed: (v) => set({ leftSidebarCollapsed: v }),
        setRightPanelOpen: (v) => set({ rightPanelOpen: v }),
        setLeftSidebarView: (v) => set({ leftSidebarView: v }),
        setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
        setMobileRightPanelOpen: (v) => set({ mobileRightPanelOpen: v }),
        toggleLeftSidebar: () => set((s) => ({ leftSidebarCollapsed: !s.leftSidebarCollapsed })),
        toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
        toggleMobileSidebar: () => set((s) => ({ mobileSidebarOpen: !s.mobileSidebarOpen })),
        toggleMobileRightPanel: () => set((s) => ({ mobileRightPanelOpen: !s.mobileRightPanelOpen })),
      }),
      {
        name: 'agenthub-ui-shell',
        version: 2,
        migrate: (persisted) => {
          const state = (persisted && typeof persisted === 'object' && 'state' in persisted)
            ? (persisted as { state?: Partial<UIState> }).state
            : (persisted as Partial<UIState> | undefined);

          return {
            sidebarWidth: clamp(Number(state?.sidebarWidth ?? 320), SIDEBAR_MIN, SIDEBAR_MAX),
            rightPanelWidth: clamp(Number(state?.rightPanelWidth ?? 360), RIGHT_PANEL_MIN, RIGHT_PANEL_MAX),
            leftSidebarCollapsed: Boolean(state?.leftSidebarCollapsed),
            rightPanelOpen: Boolean(state?.rightPanelOpen),
            leftSidebarView: (state?.leftSidebarView === 'thread' ? 'thread' : 'home') as 'home' | 'thread',
            mobileSidebarOpen: false,
            mobileRightPanelOpen: false,
          };
        },
        partialize: (s) => ({
          sidebarWidth: clamp(s.sidebarWidth, SIDEBAR_MIN, SIDEBAR_MAX),
          rightPanelWidth: clamp(s.rightPanelWidth, RIGHT_PANEL_MIN, RIGHT_PANEL_MAX),
          leftSidebarCollapsed: s.leftSidebarCollapsed,
          rightPanelOpen: s.rightPanelOpen,
          leftSidebarView: s.leftSidebarView,
        }),
      },
    ),
  ),
);
