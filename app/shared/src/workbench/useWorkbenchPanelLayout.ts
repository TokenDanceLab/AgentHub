import { useCallback, useEffect, useRef, useState } from 'react';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import type { GlobalRailPage } from './GlobalRail';
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  INSPECTOR_DEFAULT_COLLAPSE_EVENT,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
} from './workbenchLayoutConstants';
import {
  applyInspectorClientXPlan,
  applyInspectorResizeByPlan,
  applyNavigateRailPlan,
  applySidebarClientXPlan,
  applySidebarResizeByPlan,
  applyToggleCollapsedPlan,
  attachPanelPointerResizeListeners,
  buildWorkbenchPanelLayoutResult,
  canBeginPanelResize,
  clampInspectorWidth,
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
  stopInspectorPointerResize,
  stopSidebarPointerResize,
  type UseWorkbenchPanelLayoutOptions,
  type WorkbenchPanelLayout,
} from './workbenchPanelLayoutHelpers';

export type {
  UseWorkbenchPanelLayoutOptions,
  WorkbenchPanelLayout,
} from './workbenchPanelLayoutHelpers';

// ── Inspector layout persistence (localStorage, best-effort) ────────────────
// Follows the ConversationSidebar conversationSort pattern: load in the
// useState initializer, write in a useEffect on change.

function loadStoredInspectorWidth(): number {
  if (typeof window === 'undefined') return INSPECTOR_DEFAULT_WIDTH;
  try {
    const raw = window.localStorage.getItem(INSPECTOR_WIDTH_STORAGE_KEY);
    if (raw === null) return INSPECTOR_DEFAULT_WIDTH;
    const width = Number.parseInt(raw, 10);
    return Number.isFinite(width) ? clampInspectorWidth(width) : INSPECTOR_DEFAULT_WIDTH;
  } catch {
    return INSPECTOR_DEFAULT_WIDTH;
  }
}

function loadStoredInspectorCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(INSPECTOR_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeInspectorWidth(width: number): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSPECTOR_WIDTH_STORAGE_KEY, String(clampInspectorWidth(width)));
  } catch {
    // Quota / private-mode — persistence is best-effort.
  }
}

function storeInspectorCollapsed(collapsed: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(INSPECTOR_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // Quota / private-mode — persistence is best-effort.
  }
}

export function useWorkbenchPanelLayout({
  activePage,
  isChatPage,
  platformSurface,
  setActivePage,
}: UseWorkbenchPanelLayoutOptions): WorkbenchPanelLayout {
  const [inspectorWidth, setInspectorWidth] = useState(loadStoredInspectorWidth);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(loadStoredInspectorCollapsed);
  const [inspectorResizing, setInspectorResizing] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const inspectorWidthRef = useRef(INSPECTOR_DEFAULT_WIDTH);
  const sidebarWidthRef = useRef(SIDEBAR_DEFAULT_WIDTH);
  const sidebarShouldCollapseRef = useRef(false);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  // Persist inspector layout across restarts (mirror of the state machine).
  useEffect(() => {
    storeInspectorWidth(inspectorWidth);
  }, [inspectorWidth]);

  useEffect(() => {
    storeInspectorCollapsed(inspectorCollapsed);
  }, [inspectorCollapsed]);

  // Settings gate (inspectorVisible=false): collapse the inspector by default.
  // Dispatched by useWorkbenchSessionChrome once settings load / on toggle-off.
  useEffect(() => {
    function handleInspectorDefaultCollapse(): void {
      setInspectorCollapsed(true);
    }

    window.addEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, handleInspectorDefaultCollapse);
    return () => window.removeEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, handleInspectorDefaultCollapse);
  }, []);

  const setSyncedInspectorWidth = useCallback(
    createSyncedWidthWriter(inspectorWidthRef, setInspectorWidth),
    [],
  );

  const setSyncedSidebarWidth = useCallback(
    createSyncedWidthWriter(sidebarWidthRef, setSidebarWidth),
    [],
  );

  const restoreInspectorWidth = useCallback((width = INSPECTOR_DEFAULT_WIDTH): void => {
    setInspectorWidth(resolveWidthWithRefSync(
      (currentWidth) => resolveRestoredInspectorWidth(currentWidth, width),
      inspectorWidthRef,
    ));
  }, []);

  const openInspector = useCallback((width = INSPECTOR_DEFAULT_WIDTH): void => {
    restoreInspectorWidth(width);
    setInspectorCollapsed(false);
  }, [restoreInspectorWidth]);

  const collapseSidebarForWorkspacePressure = useCallback((nextInspectorWidth: number): void => {
    maybeCollapseSidebarForWorkspacePressure({
      isChatPage,
      sidebarCollapsed,
      viewportWidth: window.innerWidth,
      sidebarWidth: sidebarWidthRef.current,
      nextInspectorWidth,
      setSidebarCollapsed,
    });
  }, [isChatPage, sidebarCollapsed]);

  const restoreSidebarWidth = useCallback((width = SIDEBAR_DEFAULT_WIDTH): void => {
    setSidebarWidth(resolveWidthWithRefSync(
      (currentWidth) => resolveRestoredSidebarWidth(currentWidth, width),
      sidebarWidthRef,
    ));
  }, []);

  const toggleSidebar = useCallback((): void => {
    setSidebarCollapsed((collapsed) => applyToggleCollapsedPlan(
      planToggleSidebar({ collapsed, sidebarWidth }),
      setSyncedSidebarWidth,
    ));
  }, [setSyncedSidebarWidth, sidebarWidth]);

  const navigateRail = useCallback((page: GlobalRailPage): void => {
    applyNavigateRailPlan({
      plan: planNavigateRail(page),
      setActivePage,
      setSidebarCollapsed,
      restoreSidebarWidth,
    });
  }, [restoreSidebarWidth, setActivePage]);

  const updateInspectorWidthFromClientX = useCallback((clientX: number): void => {
    applyInspectorClientXPlan({
      plan: planInspectorWidthFromClientX({
        clientX,
        viewportWidth: window.innerWidth,
      }),
      setSyncedInspectorWidth,
      setInspectorResizing,
      setInspectorCollapsed,
      collapseSidebarForWorkspacePressure,
    });
  }, [collapseSidebarForWorkspacePressure, setSyncedInspectorWidth]);

  const updateSidebarWidthFromClientX = useCallback((clientX: number): void => {
    applySidebarClientXPlan({
      plan: planSidebarWidthFromClientX({ clientX }),
      shouldCollapseRef: sidebarShouldCollapseRef,
      setSidebarCollapsed,
      setSyncedSidebarWidth,
    });
  }, [setSyncedSidebarWidth]);

  const beginInspectorResize = useCallback((clientX: number): void => {
    if (!canBeginPanelResize(inspectorCollapsed)) return;
    setInspectorResizing(true);
    updateInspectorWidthFromClientX(clientX);
  }, [inspectorCollapsed, updateInspectorWidthFromClientX]);

  const beginSidebarResize = useCallback((clientX: number): void => {
    if (!canBeginPanelResize(sidebarCollapsed)) return;
    sidebarShouldCollapseRef.current = false;
    setSidebarResizing(true);
    updateSidebarWidthFromClientX(clientX);
  }, [sidebarCollapsed, updateSidebarWidthFromClientX]);

  const resizeInspectorBy = useCallback((delta: number): void => {
    applyInspectorResizeByPlan({
      plan: planInspectorResizeBy({ inspectorWidth, delta }),
      setInspectorCollapsed,
      setSyncedInspectorWidth,
      collapseSidebarForWorkspacePressure,
    });
  }, [collapseSidebarForWorkspacePressure, inspectorWidth, setSyncedInspectorWidth]);

  const resizeSidebarBy = useCallback((delta: number): void => {
    applySidebarResizeByPlan({
      plan: planSidebarResizeBy({ sidebarWidth, delta }),
      setSidebarCollapsed,
      setSyncedSidebarWidth,
    });
  }, [setSyncedSidebarWidth, sidebarWidth]);

  const toggleInspector = useCallback((): void => {
    setInspectorCollapsed((collapsed) => applyToggleCollapsedPlan(
      planToggleInspector({ collapsed, inspectorWidth }),
      setInspectorWidth,
    ));
  }, [inspectorWidth]);

  useEffect(() => {
    if (platformSurface !== 'desktop' || activePage !== 'chat') return undefined;

    function handleDesktopToggleSidebar(): void {
      toggleSidebar();
    }

    window.addEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
    return () => window.removeEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
  }, [activePage, platformSurface, toggleSidebar]);

  useEffect(() => {
    if (!inspectorResizing) return;
    return attachPanelPointerResizeListeners({
      onMoveClientX: updateInspectorWidthFromClientX,
      onStop: () => stopInspectorPointerResize({
        currentWidth: inspectorWidthRef.current,
        setInspectorResizing,
        setInspectorCollapsed,
      }),
    });
  }, [inspectorResizing, updateInspectorWidthFromClientX]);

  useEffect(() => {
    if (!sidebarResizing) return;
    return attachPanelPointerResizeListeners({
      onMoveClientX: updateSidebarWidthFromClientX,
      onStop: () => stopSidebarPointerResize({
        shouldCollapseRef: sidebarShouldCollapseRef,
        setSidebarResizing,
        setSidebarCollapsed,
      }),
    });
  }, [sidebarResizing, updateSidebarWidthFromClientX]);

  return buildWorkbenchPanelLayoutResult({
    inspectorWidth,
    inspectorCollapsed,
    inspectorResizing,
    sidebarWidth,
    sidebarCollapsed,
    sidebarResizing,
    inspectorWidthRef,
    sidebarWidthRef,
    sidebarShouldCollapseRef,
    setInspectorResizing,
    setSidebarResizing,
    toggleInspector,
    toggleSidebar,
    navigateRail,
    beginInspectorResize,
    beginSidebarResize,
    resizeInspectorBy,
    resizeSidebarBy,
    openInspector,
    restoreInspectorWidth,
    restoreSidebarWidth,
  });
}
