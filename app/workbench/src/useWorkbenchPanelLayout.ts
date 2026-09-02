import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import type { GlobalRailPage } from './GlobalRail';
import {
  INSPECTOR_COLLAPSED_STORAGE_KEY,
  INSPECTOR_DEFAULT_COLLAPSE_EVENT,
  type InspectorDefaultCollapseDetail,
  INSPECTOR_DEFAULT_WIDTH,
  INSPECTOR_WIDTH_STORAGE_KEY,
  SIDEBAR_DEFAULT_WIDTH,
  SPLIT_LAYOUT_STORAGE_KEY,
  WORKSPACE_MOUNT_COLLAPSE_INSPECTOR_WIDTH,
  WORKSPACE_MOUNT_COLLAPSE_WIDTH,
} from './workbenchLayoutConstants';
import {
  countLeaves,
  createLeaf,
  findLeafByConversation,
  listLeaves,
  moveConversationToPane,
  placeIncomingConversation,
  removePane,
  serializeSplitLayout,
  splitPane,
  tryParseSplitLayout,
  type SplitLayoutNode,
  type SplitOrientation,
} from './workbenchSplitLayout';
import type { WorkbenchSplitState } from './workbenchPanelLayoutHelpers';
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

// ── Split-view layout persistence (#1997, localStorage, best-effort) ──────
// Defensive hydration: any malformed/hostile blob is rejected by
// tryParseSplitLayout and falls back to a single group (no white screen).

function loadStoredSplitLayout(): SplitLayoutNode | null {
  if (typeof window === 'undefined') return null;
  try {
    return tryParseSplitLayout(window.localStorage.getItem(SPLIT_LAYOUT_STORAGE_KEY));
  } catch {
    return null;
  }
}

function storeSplitLayout(node: SplitLayoutNode | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (node === null) {
      window.localStorage.removeItem(SPLIT_LAYOUT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(SPLIT_LAYOUT_STORAGE_KEY, serializeSplitLayout(node));
    }
  } catch {
    // Quota / private-mode — persistence is best-effort.
  }
}

export function useWorkbenchPanelLayout({
  activePage,
  isChatPage,
  platformSurface,
  setActivePage,
  activeConversationId,
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
  const sidebarCollapsedRef = useRef(false);
  const isChatPageRef = useRef(isChatPage);
  // #2154 P2-6: provenance marker for the inspector collapse. True only while
  // the current collapse was caused by the `inspectorVisible` setting, so
  // turning that setting back on can undo its own collapse without overriding
  // a collapse the user made by hand.
  const inspectorCollapsedBySettingRef = useRef(false);

  /** Collapse/expand from any non-settings path (user toggle, resize snap,
   *  narrow-window mount): clears the settings marker so a later
   *  `inspectorVisible=true` never force-opens a panel the user closed. */
  const setInspectorCollapsedByUser = useCallback((next: SetStateAction<boolean>): void => {
    inspectorCollapsedBySettingRef.current = false;
    setInspectorCollapsed(next);
  }, []);

  useEffect(() => {
    inspectorWidthRef.current = inspectorWidth;
  }, [inspectorWidth]);

  useEffect(() => {
    sidebarWidthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  useEffect(() => {
    sidebarCollapsedRef.current = sidebarCollapsed;
  }, [sidebarCollapsed]);

  useEffect(() => {
    isChatPageRef.current = isChatPage;
  }, [isChatPage]);

  // Persist inspector layout across restarts (mirror of the state machine).
  useEffect(() => {
    storeInspectorWidth(inspectorWidth);
  }, [inspectorWidth]);

  useEffect(() => {
    storeInspectorCollapsed(inspectorCollapsed);
  }, [inspectorCollapsed]);

  // Settings gate (inspectorVisible): collapse the inspector by default, and
  // — since #2154 P2-6 — expand it again when the setting is switched back on.
  // Dispatched by useWorkbenchSessionChrome once settings load / on toggle.
  // Expansion is conditional on the collapse provenance marker above so a
  // manually collapsed inspector stays collapsed.
  useEffect(() => {
    function handleInspectorDefaultCollapse(event: Event): void {
      const detail = (event as CustomEvent<InspectorDefaultCollapseDetail | undefined>).detail;
      // Legacy dispatches carried no detail and always meant "collapse".
      if (detail?.collapse !== false) {
        inspectorCollapsedBySettingRef.current = true;
        setInspectorCollapsed(true);
        return;
      }
      if (inspectorCollapsedBySettingRef.current) {
        inspectorCollapsedBySettingRef.current = false;
        setInspectorCollapsed(false);
      }
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
    setInspectorCollapsedByUser(false);
  }, [restoreInspectorWidth, setInspectorCollapsedByUser]);

  const closeInspector = useCallback((): void => {
    setInspectorCollapsedByUser(true);
  }, [setInspectorCollapsedByUser]);

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
      setInspectorCollapsed: setInspectorCollapsedByUser,
      collapseSidebarForWorkspacePressure,
    });
  }, [collapseSidebarForWorkspacePressure, setInspectorCollapsedByUser, setSyncedInspectorWidth]);

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
      setInspectorCollapsed: setInspectorCollapsedByUser,
      setSyncedInspectorWidth,
      collapseSidebarForWorkspacePressure,
    });
  }, [collapseSidebarForWorkspacePressure, inspectorWidth, setInspectorCollapsedByUser, setSyncedInspectorWidth]);

  const resizeSidebarBy = useCallback((delta: number): void => {
    applySidebarResizeByPlan({
      plan: planSidebarResizeBy({ sidebarWidth, delta }),
      setSidebarCollapsed,
      setSyncedSidebarWidth,
    });
  }, [setSyncedSidebarWidth, sidebarWidth]);

  const toggleInspector = useCallback((): void => {
    setInspectorCollapsedByUser((collapsed) => applyToggleCollapsedPlan(
      planToggleInspector({ collapsed, inspectorWidth }),
      setInspectorWidth,
    ));
  }, [inspectorWidth, setInspectorCollapsedByUser]);

  useEffect(() => {
    if (platformSurface !== 'desktop' || activePage !== 'chat') return undefined;

    function handleDesktopToggleSidebar(): void {
      toggleSidebar();
    }

    window.addEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
    return () => window.removeEventListener(DESKTOP_TOGGLE_SIDEBAR_EVENT, handleDesktopToggleSidebar);
  }, [activePage, platformSurface, toggleSidebar]);

  // #1874: the resize listener below only fires on subsequent resizes, so a fresh
  // Desktop load at a narrow window paints the expanded sidebar and crushes the chat
  // column until the window is resized. Evaluate workspace pressure once on mount
  // with a tighter crush threshold (not the live-resize comfort threshold); collapse
  // is one-directional + idempotent and Desktop-only.
  useEffect(() => {
    if (typeof window === 'undefined' || platformSurface !== 'desktop') return;
    maybeCollapseSidebarForWorkspacePressure({
      isChatPage,
      sidebarCollapsed,
      viewportWidth: window.innerWidth,
      sidebarWidth,
      nextInspectorWidth: inspectorWidth,
      minWorkspaceWidth: WORKSPACE_MOUNT_COLLAPSE_WIDTH,
      setSidebarCollapsed,
    });
    // At a genuinely narrow Desktop window the fixed 400px inspector column
    // still crushes the chat main area after the sidebar collapses. Collapse it
    // on mount as well (one-directional + idempotent); the user can re-open it.
    if (window.innerWidth < WORKSPACE_MOUNT_COLLAPSE_INSPECTOR_WIDTH) {
      setInspectorCollapsedByUser(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Window resize → re-evaluate workspace-pressure sidebar collapse (#1827).
  // The check used to run only during pointer resizes, so shrinking the
  // window below the 3-panel comfort zone kept the chat main area squeezed
  // (~560px at 1280px windows) until the inspector was touched. Collapse is
  // one-directional (dedupe with the pointer-resize plan), reads the latest
  // widths through refs, and is rAF-throttled per frame.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let framePending = false;
    let rafId = 0;

    function evaluateWorkspacePressure(): void {
      framePending = false;
      maybeCollapseSidebarForWorkspacePressure({
        isChatPage: isChatPageRef.current,
        sidebarCollapsed: sidebarCollapsedRef.current,
        viewportWidth: window.innerWidth,
        sidebarWidth: sidebarWidthRef.current,
        nextInspectorWidth: inspectorWidthRef.current,
        setSidebarCollapsed,
      });
    }

    function handleViewportResize(): void {
      if (framePending) return;
      framePending = true;
      if (typeof window.requestAnimationFrame === 'function') {
        rafId = window.requestAnimationFrame(evaluateWorkspacePressure);
      } else {
        evaluateWorkspacePressure();
      }
    }

    window.addEventListener('resize', handleViewportResize);
    return () => {
      window.removeEventListener('resize', handleViewportResize);
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, [setSidebarCollapsed]);

  useEffect(() => {
    if (!inspectorResizing) return;
    return attachPanelPointerResizeListeners({
      onMoveClientX: updateInspectorWidthFromClientX,
      onStop: () => stopInspectorPointerResize({
        currentWidth: inspectorWidthRef.current,
        setInspectorResizing,
        setInspectorCollapsed: setInspectorCollapsedByUser,
      }),
    });
  }, [inspectorResizing, setInspectorCollapsedByUser, updateInspectorWidthFromClientX]);

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

  // ── Split-view layout state (#1997, UX F3) ──────────────────────────────
  // Stored tree + render-time placement derivation (pure). The active pane is
  // whichever leaf holds the active conversation; when the selection lands on
  // a conversation absent from the tree it is placed into the first empty
  // pane, else the first pane that is not the previously active one (parallel
  // review must not evict what the user is looking at).
  const [splitTree, setSplitTree] = useState<SplitLayoutNode | null>(loadStoredSplitLayout);
  const previousSplitConversationRef = useRef<string | undefined>(undefined);

  const effectiveSplitTree = useMemo(() => {
    if (!splitTree) return null;
    if (!activeConversationId) return splitTree;
    return placeIncomingConversation(
      splitTree,
      activeConversationId,
      previousSplitConversationRef.current,
    ).tree;
  }, [splitTree, activeConversationId]);

  useEffect(() => {
    previousSplitConversationRef.current = activeConversationId ?? undefined;
  }, [activeConversationId]);

  useEffect(() => {
    storeSplitLayout(effectiveSplitTree);
  }, [effectiveSplitTree]);

  const splitActive = effectiveSplitTree !== null && countLeaves(effectiveSplitTree) >= 2;

  const splitActivePane = useCallback((orientation: SplitOrientation): void => {
    const base = effectiveSplitTree
      ?? (activeConversationId ? createLeaf('split-pane-main', activeConversationId) : null);
    if (!base) return;
    const activeLeaf = (activeConversationId
      ? findLeafByConversation(base, activeConversationId)
      : null) ?? listLeaves(base)[0] ?? null;
    if (!activeLeaf) return;
    const next = splitPane(base, activeLeaf.paneId, orientation);
    if (next) setSplitTree(next);
  }, [activeConversationId, effectiveSplitTree]);

  const unsplitPane = useCallback((paneId: string): void => {
    if (!effectiveSplitTree) return;
    const activeLeaf = activeConversationId
      ? findLeafByConversation(effectiveSplitTree, activeConversationId)
      : null;
    if (activeLeaf?.paneId === paneId) {
      // Unsplit on the active pane collapses back to a single group.
      setSplitTree(null);
      return;
    }
    const next = removePane(effectiveSplitTree, paneId);
    setSplitTree(next !== null && countLeaves(next) >= 2 ? next : null);
  }, [activeConversationId, effectiveSplitTree]);

  const collapseAll = useCallback((): void => {
    setSplitTree(null);
  }, []);

  const placeConversation = useCallback((conversationId: string): boolean => {
    if (!effectiveSplitTree || !splitActive) return false;
    if (findLeafByConversation(effectiveSplitTree, conversationId)) return true;
    const placed = placeIncomingConversation(
      effectiveSplitTree,
      conversationId,
      activeConversationId ?? undefined,
    );
    if (placed.changed) setSplitTree(placed.tree);
    return true;
  }, [activeConversationId, effectiveSplitTree, splitActive]);

  const movePaneConversationToPane = useCallback((sourcePaneId: string, targetPaneId: string): void => {
    if (!effectiveSplitTree) return;
    const moved = moveConversationToPane(effectiveSplitTree, sourcePaneId, targetPaneId);
    if (moved) setSplitTree(countLeaves(moved) >= 2 ? moved : null);
  }, [effectiveSplitTree]);

  // Memoized so the state object survives shell re-renders (keystrokes,
  // toasts) — downstream ConversationHost memo gates stay intact (#perf).
  const splitState: WorkbenchSplitState = useMemo(() => ({
    tree: effectiveSplitTree,
    active: splitActive,
    panes: effectiveSplitTree
      ? listLeaves(effectiveSplitTree).map((leaf) => ({
          paneId: leaf.paneId,
          conversationId: leaf.conversationId,
        }))
      : [],
    splitActivePane,
    unsplitPane,
    collapseAll,
    placeConversation,
    moveConversationToPane: movePaneConversationToPane,
  }), [
    effectiveSplitTree,
    splitActive,
    splitActivePane,
    unsplitPane,
    collapseAll,
    placeConversation,
    movePaneConversationToPane,
  ]);

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
    closeInspector,
    restoreInspectorWidth,
    restoreSidebarWidth,
    split: splitState,
  });
}
