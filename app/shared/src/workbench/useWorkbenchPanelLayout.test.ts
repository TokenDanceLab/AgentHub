// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentHubPlatform } from '../platform';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import type { GlobalRailPage } from './GlobalRail';
import { useWorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  INSPECTOR_DEFAULT_COLLAPSE_EVENT,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from './workbenchLayoutConstants';
import { GLOBAL_RAIL_WIDTH } from './workbenchPanelLayoutHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchPanelLayout — hook-level wiring over the #721 layout helpers.

   Covers default state, localStorage restore/persistence (including
   throwing storage), toggle/restore semantics, pointer + delta resizes,
   workspace-pressure sidebar collapse, and both window event shortcuts.
   ═══════════════════════════════════════════════════════════════════════ */

const DEFAULT_VIEWPORT_WIDTH = 1024;

interface PanelLayoutRenderOptions {
  activePage?: GlobalRailPage;
  isChatPage?: boolean;
  platformSurface?: AgentHubPlatform['surface'];
}

function renderPanelLayout(options: PanelLayoutRenderOptions = {}) {
  const setActivePage = vi.fn();
  const rendered = renderHook(() => useWorkbenchPanelLayout({
    activePage: options.activePage ?? 'chat',
    isChatPage: options.isChatPage ?? true,
    platformSurface: options.platformSurface ?? 'desktop',
    setActivePage,
  }));
  return { ...rendered, setActivePage };
}

/** Fire window pointer events, matching attachPanelPointerResizeListeners. */
function dispatchPointerEvent(type: string, clientX?: number): void {
  window.dispatchEvent(new PointerEvent(type, clientX === undefined ? {} : { clientX }));
}

/** Synchronous rAF so scheduled panel collapses land inside the same act block. */
function stubSynchronousRequestAnimationFrame(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  });
}

describe('useWorkbenchPanelLayout', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes with default panel state, refs, and shell CSS variables', () => {
    const { result } = renderPanelLayout();

    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.inspectorCollapsed).toBe(false);
    expect(result.current.inspectorResizing).toBe(false);
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.sidebarResizing).toBe(false);
    expect(result.current.inspectorWidthRef.current).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.sidebarWidthRef.current).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(result.current.sidebarShouldCollapseRef.current).toBe(false);
    expect(typeof result.current.setInspectorResizing).toBe('function');
    expect(typeof result.current.setSidebarResizing).toBe('function');
    expect(result.current.shellStyle).toEqual({
      '--inspector-w': `${INSPECTOR_DEFAULT_WIDTH}px`,
      '--sidebar-w': `${SIDEBAR_DEFAULT_WIDTH}px`,
    });
  });

  it('restores inspector width and collapsed state from localStorage', () => {
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, '520');
    window.localStorage.setItem(INSPECTOR_COLLAPSED_STORAGE_KEY, 'true');

    const { result } = renderPanelLayout();
    expect(result.current.inspectorWidth).toBe(520);
    expect(result.current.inspectorCollapsed).toBe(true);
    expect(result.current.inspectorWidthRef.current).toBe(520);
  });

  it('falls back to defaults for invalid or out-of-range stored widths', () => {
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, 'not-a-number');
    const invalid = renderPanelLayout();
    expect(invalid.result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);

    window.localStorage.clear();
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, '5000');
    const tooWide = renderPanelLayout();
    expect(tooWide.result.current.inspectorWidth).toBe(INSPECTOR_MAX_WIDTH);

    window.localStorage.clear();
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, '5');
    const tooNarrow = renderPanelLayout();
    expect(tooNarrow.result.current.inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);
  });

  it('survives a throwing localStorage and keeps default panel state', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    const { result } = renderPanelLayout();
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.inspectorCollapsed).toBe(false);
    expect(result.current.sidebarCollapsed).toBe(false);
  });

  it('toggles the inspector collapsed state and persists it', () => {
    const { result } = renderPanelLayout();

    act(() => {
      result.current.toggleInspector();
    });
    expect(result.current.inspectorCollapsed).toBe(true);
    expect(window.localStorage.getItem(INSPECTOR_COLLAPSED_STORAGE_KEY)).toBe('true');

    act(() => {
      result.current.toggleInspector();
    });
    expect(result.current.inspectorCollapsed).toBe(false);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(window.localStorage.getItem(INSPECTOR_COLLAPSED_STORAGE_KEY)).toBe('false');
  });

  it('toggles the sidebar collapsed state and restores its default width on expand', () => {
    const { result } = renderPanelLayout();

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.sidebarCollapsed).toBe(true);

    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('expands the sidebar when navigating to chat and only changes the page otherwise', () => {
    const { result, setActivePage } = renderPanelLayout();
    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.sidebarCollapsed).toBe(true);

    act(() => {
      result.current.navigateRail('chat');
    });
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(result.current.sidebarCollapsed).toBe(false);

    act(() => {
      result.current.toggleSidebar();
    });
    act(() => {
      result.current.navigateRail('agents');
    });
    expect(setActivePage).toHaveBeenLastCalledWith('agents');
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('begins, moves, and stops an inspector pointer resize', () => {
    const { result } = renderPanelLayout({ isChatPage: false });

    act(() => {
      result.current.beginInspectorResize(500);
    });
    expect(result.current.inspectorResizing).toBe(true);
    expect(result.current.inspectorWidth).toBe(DEFAULT_VIEWPORT_WIDTH - 500);

    act(() => {
      dispatchPointerEvent('pointermove', 700);
    });
    expect(result.current.inspectorWidth).toBe(DEFAULT_VIEWPORT_WIDTH - 700);
    expect(result.current.inspectorCollapsed).toBe(false);

    act(() => {
      dispatchPointerEvent('pointercancel');
    });
    expect(result.current.inspectorResizing).toBe(false);
    expect(result.current.inspectorCollapsed).toBe(false);
  });

  it('ignores beginInspectorResize while the inspector is collapsed', () => {
    const { result } = renderPanelLayout();
    act(() => {
      result.current.toggleInspector();
    });
    expect(result.current.inspectorCollapsed).toBe(true);

    act(() => {
      result.current.beginInspectorResize(300);
    });
    expect(result.current.inspectorResizing).toBe(false);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
  });

  it('snap-collapses the inspector when dragged below the collapse threshold', () => {
    stubSynchronousRequestAnimationFrame();
    const { result } = renderPanelLayout();

    // clientX leaves only 50px (< INSPECTOR_COLLAPSE_SNAP_WIDTH=96).
    act(() => {
      result.current.beginInspectorResize(DEFAULT_VIEWPORT_WIDTH - 50);
    });
    expect(result.current.inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);
    expect(result.current.inspectorResizing).toBe(false);
    expect(result.current.inspectorCollapsed).toBe(true);
  });

  it('begins and stops a sidebar pointer resize, collapsing on the pending snap', () => {
    stubSynchronousRequestAnimationFrame();
    const { result } = renderPanelLayout();

    act(() => {
      result.current.beginSidebarResize(GLOBAL_RAIL_WIDTH + 240);
    });
    expect(result.current.sidebarResizing).toBe(true);
    expect(result.current.sidebarWidth).toBe(240);

    // clientX leaves only 50px (< SIDEBAR_COLLAPSE_SNAP_WIDTH=96).
    act(() => {
      dispatchPointerEvent('pointermove', GLOBAL_RAIL_WIDTH + 50);
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
    expect(result.current.sidebarCollapsed).toBe(false);
    expect(result.current.sidebarShouldCollapseRef.current).toBe(true);

    act(() => {
      dispatchPointerEvent('pointerup');
    });
    expect(result.current.sidebarResizing).toBe(false);
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('ignores beginSidebarResize while the sidebar is collapsed', () => {
    const { result } = renderPanelLayout();
    act(() => {
      result.current.toggleSidebar();
    });
    expect(result.current.sidebarCollapsed).toBe(true);

    act(() => {
      result.current.beginSidebarResize(GLOBAL_RAIL_WIDTH + 240);
    });
    expect(result.current.sidebarResizing).toBe(false);
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('resizes panels by delta, persisting widths and collapsing below thresholds', () => {
    const { result } = renderPanelLayout({ isChatPage: false });

    act(() => {
      result.current.resizeInspectorBy(50);
    });
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH + 50);
    expect(window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY))
      .toBe(String(INSPECTOR_DEFAULT_WIDTH + 50));

    act(() => {
      result.current.resizeSidebarBy(40);
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH + 40);

    act(() => {
      result.current.resizeInspectorBy(-1000);
    });
    expect(result.current.inspectorCollapsed).toBe(true);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);

    act(() => {
      result.current.resizeSidebarBy(-1000);
    });
    expect(result.current.sidebarCollapsed).toBe(true);
    expect(result.current.sidebarWidth).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('opens the inspector and restores only unreadable panel widths', () => {
    const { result } = renderPanelLayout();

    // A readable width is left untouched by an explicit restore.
    act(() => {
      result.current.restoreInspectorWidth(500);
    });
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);

    // Collapse below the readable threshold, then restore with an explicit width.
    act(() => {
      result.current.resizeInspectorBy(-1000);
    });
    expect(result.current.inspectorCollapsed).toBe(true);
    expect(result.current.inspectorWidth).toBe(INSPECTOR_MIN_WIDTH);

    act(() => {
      result.current.restoreInspectorWidth(500);
    });
    expect(result.current.inspectorWidth).toBe(500);

    // openInspector restores the default width and always expands.
    act(() => {
      result.current.resizeInspectorBy(-1000);
    });
    act(() => {
      result.current.openInspector();
    });
    expect(result.current.inspectorWidth).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(result.current.inspectorCollapsed).toBe(false);

    // Sidebar restores are no-ops at valid widths.
    act(() => {
      result.current.resizeSidebarBy(40);
    });
    act(() => {
      result.current.restoreSidebarWidth();
    });
    expect(result.current.sidebarWidth).toBe(SIDEBAR_DEFAULT_WIDTH + 40);
  });

  it('auto-collapses the sidebar under workspace pressure on the chat page', () => {
    const { result } = renderPanelLayout();
    // 1024 - 52 rail - 260 sidebar - 600 inspector = 112 < 560 → collapse.
    act(() => {
      result.current.resizeInspectorBy(200);
    });
    expect(result.current.inspectorWidth).toBe(600);
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('keeps the sidebar open on non-chat pages regardless of workspace pressure', () => {
    const { result } = renderPanelLayout({ isChatPage: false });

    act(() => {
      result.current.resizeInspectorBy(200);
    });
    expect(result.current.inspectorWidth).toBe(600);
    expect(result.current.sidebarCollapsed).toBe(false);
  });

  it('collapses the inspector when the settings default-collapse event fires', () => {
    const { result } = renderPanelLayout();

    act(() => {
      window.dispatchEvent(new Event(INSPECTOR_DEFAULT_COLLAPSE_EVENT));
    });
    expect(result.current.inspectorCollapsed).toBe(true);
  });

  it('reacts to the desktop sidebar shortcut only on the active chat page', () => {
    const setActivePage = vi.fn();
    const { result, rerender } = renderHook(
      ({ activePage }: { activePage: GlobalRailPage }) => useWorkbenchPanelLayout({
        activePage,
        isChatPage: true,
        platformSurface: 'desktop',
        setActivePage,
      }),
      { initialProps: { activePage: 'agents' as GlobalRailPage } },
    );

    act(() => {
      window.dispatchEvent(new Event(DESKTOP_TOGGLE_SIDEBAR_EVENT));
    });
    expect(result.current.sidebarCollapsed).toBe(false);

    rerender({ activePage: 'chat' });
    act(() => {
      window.dispatchEvent(new Event(DESKTOP_TOGGLE_SIDEBAR_EVENT));
    });
    expect(result.current.sidebarCollapsed).toBe(true);
  });

  it('never registers the desktop sidebar shortcut on non-desktop surfaces', () => {
    const { result } = renderPanelLayout({ platformSurface: 'web' });

    act(() => {
      window.dispatchEvent(new Event(DESKTOP_TOGGLE_SIDEBAR_EVENT));
    });
    expect(result.current.sidebarCollapsed).toBe(false);
  });
});
