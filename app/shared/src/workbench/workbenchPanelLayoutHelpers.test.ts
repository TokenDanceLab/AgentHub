import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MutableRefObject } from 'react';
import {
  GLOBAL_RAIL_WIDTH,
  applyInspectorClientXPlan,
  applyInspectorResizeByPlan,
  applyNavigateRailPlan,
  applySidebarClientXPlan,
  applySidebarResizeByPlan,
  applyToggleCollapsedPlan,
  attachPanelPointerResizeListeners,
  buildPanelShellStyle,
  buildWorkbenchPanelLayoutResult,
  canBeginPanelResize,
  clampInspectorWidth,
  clampSidebarWidth,
  createSyncedWidthWriter,
  maybeCollapseSidebarForWorkspacePressure,
  planInspectorResizeBy,
  planInspectorWidthFromClientX,
  planNavigateRail,
  planSidebarResizeBy,
  planSidebarWidthFromClientX,
  planToggleInspector,
  planToggleSidebar,
  resolveRestoredInspectorWidth,
  resolveRestoredSidebarWidth,
  resolveWidthWithRefSync,
  schedulePanelCollapse,
  shouldCollapseInspectorOnResizeEnd,
  shouldCollapseSidebarForWorkspacePressure,
  stopInspectorPointerResize,
  stopSidebarPointerResize,
} from './workbenchPanelLayoutHelpers';
import {
  INSPECTOR_COLLAPSE_SNAP_WIDTH,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_MAX_WIDTH,
  INSPECTOR_MIN_WIDTH,
  INSPECTOR_READABLE_WIDTH,
  SIDEBAR_COLLAPSE_SNAP_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  WORKSPACE_AUTO_COLLAPSE_WIDTH,
} from './workbenchLayoutConstants';

describe('workbenchPanelLayoutHelpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clamps inspector and sidebar widths to configured bounds', () => {
    expect(clampInspectorWidth(INSPECTOR_MIN_WIDTH - 40)).toBe(INSPECTOR_MIN_WIDTH);
    expect(clampInspectorWidth(INSPECTOR_MAX_WIDTH + 40)).toBe(INSPECTOR_MAX_WIDTH);
    expect(clampInspectorWidth(412.6)).toBe(413);
    expect(clampSidebarWidth(SIDEBAR_MIN_WIDTH - 20)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(SIDEBAR_MAX_WIDTH + 20)).toBe(SIDEBAR_MAX_WIDTH);
    expect(clampSidebarWidth(240.4)).toBe(240);
  });

  it('restores panel widths only when below readability / min thresholds', () => {
    expect(resolveRestoredInspectorWidth(INSPECTOR_READABLE_WIDTH - 1)).toBe(INSPECTOR_DEFAULT_WIDTH);
    expect(resolveRestoredInspectorWidth(INSPECTOR_READABLE_WIDTH - 1, 500)).toBe(
      clampInspectorWidth(500),
    );
    expect(resolveRestoredInspectorWidth(INSPECTOR_READABLE_WIDTH)).toBe(INSPECTOR_READABLE_WIDTH);
    expect(resolveRestoredSidebarWidth(SIDEBAR_MIN_WIDTH - 1)).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(resolveRestoredSidebarWidth(SIDEBAR_MIN_WIDTH - 1, 300)).toBe(clampSidebarWidth(300));
    expect(resolveRestoredSidebarWidth(SIDEBAR_MIN_WIDTH)).toBe(SIDEBAR_MIN_WIDTH);
  });

  it('detects workspace-pressure sidebar collapse only on chat pages', () => {
    const sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
    const nextInspectorWidth = INSPECTOR_DEFAULT_WIDTH;
    const tightViewport =
      GLOBAL_RAIL_WIDTH + sidebarWidth + nextInspectorWidth + WORKSPACE_AUTO_COLLAPSE_WIDTH - 1;

    expect(shouldCollapseSidebarForWorkspacePressure({
      isChatPage: true,
      sidebarCollapsed: false,
      viewportWidth: tightViewport,
      sidebarWidth,
      nextInspectorWidth,
    })).toBe(true);

    expect(shouldCollapseSidebarForWorkspacePressure({
      isChatPage: false,
      sidebarCollapsed: false,
      viewportWidth: tightViewport,
      sidebarWidth,
      nextInspectorWidth,
    })).toBe(false);

    expect(shouldCollapseSidebarForWorkspacePressure({
      isChatPage: true,
      sidebarCollapsed: true,
      viewportWidth: tightViewport,
      sidebarWidth,
      nextInspectorWidth,
    })).toBe(false);

    const roomyViewport =
      GLOBAL_RAIL_WIDTH + sidebarWidth + nextInspectorWidth + WORKSPACE_AUTO_COLLAPSE_WIDTH;
    expect(shouldCollapseSidebarForWorkspacePressure({
      isChatPage: true,
      sidebarCollapsed: false,
      viewportWidth: roomyViewport,
      sidebarWidth,
      nextInspectorWidth,
    })).toBe(false);
  });

  it('plans sidebar and inspector toggles with expand-or-collapse semantics', () => {
    expect(planToggleSidebar({ collapsed: true, sidebarWidth: 0 })).toEqual({
      kind: 'expand',
      width: SIDEBAR_DEFAULT_WIDTH,
      collapsed: false,
    });
    expect(planToggleSidebar({ collapsed: false, sidebarWidth: SIDEBAR_MIN_WIDTH - 1 })).toEqual({
      kind: 'expand',
      width: SIDEBAR_DEFAULT_WIDTH,
      collapsed: false,
    });
    expect(planToggleSidebar({ collapsed: false, sidebarWidth: SIDEBAR_DEFAULT_WIDTH })).toEqual({
      kind: 'collapse',
      collapsed: true,
    });

    expect(planToggleInspector({ collapsed: true, inspectorWidth: 0 })).toEqual({
      kind: 'expand',
      width: INSPECTOR_DEFAULT_WIDTH,
      collapsed: false,
    });
    expect(planToggleInspector({
      collapsed: false,
      inspectorWidth: INSPECTOR_READABLE_WIDTH - 1,
    })).toEqual({
      kind: 'expand',
      width: INSPECTOR_DEFAULT_WIDTH,
      collapsed: false,
    });
    expect(planToggleInspector({
      collapsed: false,
      inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
    })).toEqual({
      kind: 'collapse',
      collapsed: true,
    });
  });

  it('plans rail navigation with chat-specific sidebar restore', () => {
    expect(planNavigateRail('chat')).toEqual({
      kind: 'chat',
      page: 'chat',
      expandSidebar: true,
    });
    expect(planNavigateRail('agents')).toEqual({
      kind: 'other',
      page: 'agents',
      expandSidebar: false,
    });
  });

  it('plans inspector pointer resize including snap-collapse', () => {
    const viewportWidth = 1200;
    const snapClientX = viewportWidth - INSPECTOR_COLLAPSE_SNAP_WIDTH;
    expect(planInspectorWidthFromClientX({
      clientX: snapClientX,
      viewportWidth,
    })).toEqual({
      kind: 'snap-collapse',
      width: INSPECTOR_MIN_WIDTH,
      clampedWidth: clampInspectorWidth(INSPECTOR_COLLAPSE_SNAP_WIDTH),
      stopResizing: true,
      scheduleCollapse: true,
    });

    const resizeClientX = viewportWidth - 420;
    expect(planInspectorWidthFromClientX({
      clientX: resizeClientX,
      viewportWidth,
    })).toEqual({
      kind: 'resize',
      width: 420,
      clampedWidth: 420,
      stopResizing: false,
      scheduleCollapse: false,
    });
  });

  it('plans sidebar pointer resize including pending collapse', () => {
    expect(planSidebarWidthFromClientX({
      clientX: GLOBAL_RAIL_WIDTH + SIDEBAR_COLLAPSE_SNAP_WIDTH,
    })).toEqual({
      kind: 'snap-pending',
      width: SIDEBAR_MIN_WIDTH,
      shouldCollapse: true,
    });

    expect(planSidebarWidthFromClientX({
      clientX: GLOBAL_RAIL_WIDTH + 240,
    })).toEqual({
      kind: 'resize',
      width: 240,
      shouldCollapse: false,
    });
  });

  it('plans keyboard/delta resize for inspector and sidebar', () => {
    expect(planInspectorResizeBy({
      inspectorWidth: INSPECTOR_MIN_WIDTH,
      delta: -10,
    })).toEqual({
      kind: 'collapse',
      width: INSPECTOR_MIN_WIDTH,
      pressureWidth: INSPECTOR_MIN_WIDTH,
    });

    expect(planInspectorResizeBy({
      inspectorWidth: INSPECTOR_DEFAULT_WIDTH,
      delta: 20,
    })).toEqual({
      kind: 'resize',
      width: INSPECTOR_DEFAULT_WIDTH + 20,
      pressureWidth: INSPECTOR_DEFAULT_WIDTH + 20,
    });

    expect(planSidebarResizeBy({
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      delta: -(SIDEBAR_DEFAULT_WIDTH - SIDEBAR_COLLAPSE_SNAP_WIDTH + 1),
    })).toEqual({
      kind: 'collapse',
      width: SIDEBAR_MIN_WIDTH,
    });

    expect(planSidebarResizeBy({
      sidebarWidth: SIDEBAR_MIN_WIDTH,
      delta: -1,
    })).toEqual({
      kind: 'collapse',
      width: SIDEBAR_MIN_WIDTH,
    });

    expect(planSidebarResizeBy({
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      delta: 12,
    })).toEqual({
      kind: 'resize',
      width: SIDEBAR_DEFAULT_WIDTH + 12,
    });
  });

  it('gates begin-resize and inspector end-collapse checks', () => {
    expect(canBeginPanelResize(true)).toBe(false);
    expect(canBeginPanelResize(false)).toBe(true);
    expect(shouldCollapseInspectorOnResizeEnd(INSPECTOR_COLLAPSE_SNAP_WIDTH)).toBe(true);
    expect(shouldCollapseInspectorOnResizeEnd(INSPECTOR_COLLAPSE_SNAP_WIDTH + 1)).toBe(false);
  });

  it('schedules collapse via requestAnimationFrame when available', () => {
    const collapse = vi.fn();
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);

    schedulePanelCollapse(collapse);

    expect(raf).toHaveBeenCalledTimes(1);
    expect(collapse).toHaveBeenCalledTimes(1);
  });

  it('falls back to synchronous collapse without requestAnimationFrame', () => {
    const collapse = vi.fn();
    vi.stubGlobal('requestAnimationFrame', undefined);

    schedulePanelCollapse(collapse);

    expect(collapse).toHaveBeenCalledTimes(1);
  });

  it('builds shell CSS custom properties for panel widths', () => {
    expect(buildPanelShellStyle({
      inspectorWidth: 400,
      sidebarWidth: 260,
    })).toEqual({
      '--inspector-w': '400px',
      '--sidebar-w': '260px',
    });
  });

  it('applies toggle/nav/resize plans without mutating unrelated state', () => {
    const setWidth = vi.fn();
    expect(applyToggleCollapsedPlan({
      kind: 'expand',
      width: SIDEBAR_DEFAULT_WIDTH,
      collapsed: false,
    }, setWidth)).toBe(false);
    expect(setWidth).toHaveBeenCalledWith(SIDEBAR_DEFAULT_WIDTH);
    expect(applyToggleCollapsedPlan({ kind: 'collapse', collapsed: true }, setWidth)).toBe(true);

    const setActivePage = vi.fn();
    const setSidebarCollapsed = vi.fn();
    const restoreSidebarWidth = vi.fn();
    applyNavigateRailPlan({
      plan: planNavigateRail('chat'),
      setActivePage,
      setSidebarCollapsed,
      restoreSidebarWidth,
    });
    expect(setActivePage).toHaveBeenCalledWith('chat');
    expect(setSidebarCollapsed).toHaveBeenCalledWith(false);
    expect(restoreSidebarWidth).toHaveBeenCalledTimes(1);

    setActivePage.mockClear();
    setSidebarCollapsed.mockClear();
    restoreSidebarWidth.mockClear();
    applyNavigateRailPlan({
      plan: planNavigateRail('agents'),
      setActivePage,
      setSidebarCollapsed,
      restoreSidebarWidth,
    });
    expect(setActivePage).toHaveBeenCalledWith('agents');
    expect(setSidebarCollapsed).not.toHaveBeenCalled();
    expect(restoreSidebarWidth).not.toHaveBeenCalled();
  });

  it('applies inspector and sidebar clientX / delta plans', () => {
    const setSyncedInspectorWidth = vi.fn();
    const setInspectorResizing = vi.fn();
    const setInspectorCollapsed = vi.fn();
    const collapseSidebarForWorkspacePressure = vi.fn();

    applyInspectorClientXPlan({
      plan: {
        kind: 'snap-collapse',
        width: INSPECTOR_MIN_WIDTH,
        clampedWidth: INSPECTOR_MIN_WIDTH,
        stopResizing: true,
        scheduleCollapse: true,
      },
      setSyncedInspectorWidth,
      setInspectorResizing,
      setInspectorCollapsed,
      collapseSidebarForWorkspacePressure,
    });
    expect(setInspectorCollapsed).toHaveBeenCalledWith(false);
    expect(collapseSidebarForWorkspacePressure).toHaveBeenCalledWith(INSPECTOR_MIN_WIDTH);
    expect(setSyncedInspectorWidth).toHaveBeenCalledWith(INSPECTOR_MIN_WIDTH);
    expect(setInspectorResizing).toHaveBeenCalledWith(false);

    setSyncedInspectorWidth.mockClear();
    setInspectorCollapsed.mockClear();
    collapseSidebarForWorkspacePressure.mockClear();
    applyInspectorResizeByPlan({
      plan: {
        kind: 'resize',
        width: 420,
        pressureWidth: 420,
      },
      setInspectorCollapsed,
      setSyncedInspectorWidth,
      collapseSidebarForWorkspacePressure,
    });
    expect(setSyncedInspectorWidth).toHaveBeenCalledWith(420);
    expect(setInspectorCollapsed).toHaveBeenCalledWith(false);

    const shouldCollapseRef: MutableRefObject<boolean> = { current: false };
    const setSidebarCollapsed = vi.fn();
    const setSyncedSidebarWidth = vi.fn();
    applySidebarClientXPlan({
      plan: { kind: 'snap-pending', width: SIDEBAR_MIN_WIDTH, shouldCollapse: true },
      shouldCollapseRef,
      setSidebarCollapsed,
      setSyncedSidebarWidth,
    });
    expect(shouldCollapseRef.current).toBe(true);
    expect(setSyncedSidebarWidth).toHaveBeenCalledWith(SIDEBAR_MIN_WIDTH);

    setSidebarCollapsed.mockClear();
    setSyncedSidebarWidth.mockClear();
    applySidebarResizeByPlan({
      plan: { kind: 'collapse', width: SIDEBAR_MIN_WIDTH },
      setSidebarCollapsed,
      setSyncedSidebarWidth,
    });
    expect(setSyncedSidebarWidth).toHaveBeenCalledWith(SIDEBAR_MIN_WIDTH);
    expect(setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('syncs width refs and collapses via pressure helper', () => {
    const widthRef: MutableRefObject<number> = { current: 0 };
    const setWidth = vi.fn();
    const write = createSyncedWidthWriter(widthRef, setWidth);
    write(320);
    expect(widthRef.current).toBe(320);
    expect(setWidth).toHaveBeenCalledWith(320);

    const resolver = resolveWidthWithRefSync((current) => current + 5, widthRef);
    expect(resolver(10)).toBe(15);
    expect(widthRef.current).toBe(15);

    const setSidebarCollapsed = vi.fn();
    const sidebarWidth = SIDEBAR_DEFAULT_WIDTH;
    const nextInspectorWidth = INSPECTOR_DEFAULT_WIDTH;
    const tightViewport =
      GLOBAL_RAIL_WIDTH + sidebarWidth + nextInspectorWidth + WORKSPACE_AUTO_COLLAPSE_WIDTH - 1;
    maybeCollapseSidebarForWorkspacePressure({
      isChatPage: true,
      sidebarCollapsed: false,
      viewportWidth: tightViewport,
      sidebarWidth,
      nextInspectorWidth,
      setSidebarCollapsed,
    });
    expect(setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('attaches pointer listeners and stops resize with collapse rules', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const onMoveClientX = vi.fn();
    const onStop = vi.fn();
    const detach = attachPanelPointerResizeListeners({ onMoveClientX, onStop });

    expect(add).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(add).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(add).toHaveBeenCalledWith('pointercancel', expect.any(Function));

    const moveHandler = add.mock.calls.find((call) => call[0] === 'pointermove')?.[1] as EventListener;
    moveHandler(new PointerEvent('pointermove', { clientX: 333 }));
    expect(onMoveClientX).toHaveBeenCalledWith(333);

    detach();
    expect(remove).toHaveBeenCalledWith('pointermove', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointerup', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('pointercancel', expect.any(Function));

    const setInspectorResizing = vi.fn();
    const setInspectorCollapsed = vi.fn();
    const raf = vi.fn((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', raf);
    stopInspectorPointerResize({
      currentWidth: INSPECTOR_COLLAPSE_SNAP_WIDTH,
      setInspectorResizing,
      setInspectorCollapsed,
    });
    expect(setInspectorResizing).toHaveBeenCalledWith(false);
    expect(setInspectorCollapsed).toHaveBeenCalledWith(true);

    const shouldCollapseRef: MutableRefObject<boolean> = { current: true };
    const setSidebarResizing = vi.fn();
    const setSidebarCollapsed = vi.fn();
    stopSidebarPointerResize({
      shouldCollapseRef,
      setSidebarResizing,
      setSidebarCollapsed,
    });
    expect(setSidebarResizing).toHaveBeenCalledWith(false);
    expect(shouldCollapseRef.current).toBe(false);
    expect(setSidebarCollapsed).toHaveBeenCalledWith(true);
  });

  it('builds the public layout result object with shell style', () => {
    const inspectorWidthRef: MutableRefObject<number> = { current: 400 };
    const sidebarWidthRef: MutableRefObject<number> = { current: 260 };
    const sidebarShouldCollapseRef: MutableRefObject<boolean> = { current: false };
    const result = buildWorkbenchPanelLayoutResult({
      inspectorWidth: 400,
      inspectorCollapsed: false,
      inspectorResizing: false,
      sidebarWidth: 260,
      sidebarCollapsed: false,
      sidebarResizing: false,
      inspectorWidthRef,
      sidebarWidthRef,
      sidebarShouldCollapseRef,
      setInspectorResizing: vi.fn(),
      setSidebarResizing: vi.fn(),
      toggleInspector: vi.fn(),
      toggleSidebar: vi.fn(),
      navigateRail: vi.fn(),
      beginInspectorResize: vi.fn(),
      beginSidebarResize: vi.fn(),
      resizeInspectorBy: vi.fn(),
      resizeSidebarBy: vi.fn(),
      openInspector: vi.fn(),
      restoreInspectorWidth: vi.fn(),
      restoreSidebarWidth: vi.fn(),
    });
    expect(result.shellStyle).toEqual({
      '--inspector-w': '400px',
      '--sidebar-w': '260px',
    });
    expect(result.inspectorWidth).toBe(400);
    expect(result.sidebarWidth).toBe(260);
  });
});
