import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentHubPlatform } from '../platform';
import { DESKTOP_TOGGLE_SIDEBAR_EVENT } from './desktopChromeEvents';
import type { GlobalRailPage } from './GlobalRail';
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

export interface UseWorkbenchPanelLayoutOptions {
  activePage: GlobalRailPage;
  isChatPage: boolean;
  platformSurface: AgentHubPlatform['surface'];
  setActivePage: (page: GlobalRailPage) => void;
}

export interface WorkbenchPanelLayout {
  inspectorWidth: number;
  inspectorCollapsed: boolean;
  inspectorResizing: boolean;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarResizing: boolean;
  inspectorWidthRef: React.MutableRefObject<number>;
  sidebarWidthRef: React.MutableRefObject<number>;
  sidebarShouldCollapseRef: React.MutableRefObject<boolean>;
  setInspectorResizing: (value: boolean) => void;
  setSidebarResizing: (value: boolean) => void;
  toggleInspector: () => void;
  toggleSidebar: () => void;
  navigateRail: (page: GlobalRailPage) => void;
  beginInspectorResize: (clientX: number) => void;
  beginSidebarResize: (clientX: number) => void;
  resizeInspectorBy: (delta: number) => void;
  resizeSidebarBy: (delta: number) => void;
  openInspector: (width?: number) => void;
  restoreInspectorWidth: (width?: number) => void;
  restoreSidebarWidth: (width?: number) => void;
  shellStyle: React.CSSProperties;
}

export function useWorkbenchPanelLayout({
  activePage,
  isChatPage,
  platformSurface,
  setActivePage,
}: UseWorkbenchPanelLayoutOptions): WorkbenchPanelLayout {
  const [inspectorWidth, setInspectorWidth] = useState(INSPECTOR_DEFAULT_WIDTH);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
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

  const clampInspectorWidth = useCallback((value: number): number => {
    return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)));
  }, []);

  const clampSidebarWidth = useCallback((value: number): number => {
    return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
  }, []);

  const setSyncedInspectorWidth = useCallback((width: number): void => {
    inspectorWidthRef.current = width;
    setInspectorWidth(width);
  }, []);

  const setSyncedSidebarWidth = useCallback((width: number): void => {
    sidebarWidthRef.current = width;
    setSidebarWidth(width);
  }, []);

  const restoreInspectorWidth = useCallback((width = INSPECTOR_DEFAULT_WIDTH): void => {
    setInspectorWidth((currentWidth) => {
      const nextWidth = currentWidth < INSPECTOR_READABLE_WIDTH
        ? clampInspectorWidth(width)
        : currentWidth;
      inspectorWidthRef.current = nextWidth;
      return nextWidth;
    });
  }, [clampInspectorWidth]);

  const openInspector = useCallback((width = INSPECTOR_DEFAULT_WIDTH): void => {
    restoreInspectorWidth(width);
    setInspectorCollapsed(false);
  }, [restoreInspectorWidth]);

  const collapseSidebarForWorkspacePressure = useCallback((nextInspectorWidth: number): void => {
    if (!isChatPage || sidebarCollapsed) return;
    const availableWorkspaceWidth = window.innerWidth - 52 - sidebarWidthRef.current - nextInspectorWidth;
    if (availableWorkspaceWidth < WORKSPACE_AUTO_COLLAPSE_WIDTH) {
      setSidebarCollapsed(true);
    }
  }, [isChatPage, sidebarCollapsed]);

  const restoreSidebarWidth = useCallback((width = SIDEBAR_DEFAULT_WIDTH): void => {
    setSidebarWidth((currentWidth) => {
      const nextWidth = currentWidth < SIDEBAR_MIN_WIDTH
        ? clampSidebarWidth(width)
        : currentWidth;
      sidebarWidthRef.current = nextWidth;
      return nextWidth;
    });
  }, [clampSidebarWidth]);

  const toggleSidebar = useCallback((): void => {
    setSidebarCollapsed((collapsed) => {
      if (collapsed || sidebarWidth < SIDEBAR_MIN_WIDTH) {
        setSyncedSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
        return false;
      }
      return true;
    });
  }, [setSyncedSidebarWidth, sidebarWidth]);

  const navigateRail = useCallback((page: GlobalRailPage): void => {
    if (page === 'chat') {
      setActivePage('chat');
      setSidebarCollapsed(false);
      restoreSidebarWidth();
      return;
    }
    setActivePage(page);
  }, [restoreSidebarWidth, setActivePage]);

  const updateInspectorWidthFromClientX = useCallback((clientX: number): void => {
    const nextWidth = window.innerWidth - clientX;
    setInspectorCollapsed(false);
    const clampedWidth = clampInspectorWidth(nextWidth);
    collapseSidebarForWorkspacePressure(clampedWidth);
    if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
      setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH);
      setInspectorResizing(false);
      const collapse = () => setInspectorCollapsed(true);
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(collapse);
        return;
      }
      collapse();
      return;
    }
    setSyncedInspectorWidth(clampedWidth);
  }, [clampInspectorWidth, collapseSidebarForWorkspacePressure, setSyncedInspectorWidth]);

  const updateSidebarWidthFromClientX = useCallback((clientX: number): void => {
    const nextWidth = clientX - 52;
    setSidebarCollapsed(false);
    if (nextWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH) {
      sidebarShouldCollapseRef.current = true;
      setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH);
      return;
    }
    sidebarShouldCollapseRef.current = false;
    setSyncedSidebarWidth(clampSidebarWidth(nextWidth));
  }, [clampSidebarWidth, setSyncedSidebarWidth]);

  const beginInspectorResize = useCallback((clientX: number): void => {
    if (inspectorCollapsed) return;
    setInspectorResizing(true);
    updateInspectorWidthFromClientX(clientX);
  }, [inspectorCollapsed, updateInspectorWidthFromClientX]);

  const beginSidebarResize = useCallback((clientX: number): void => {
    if (sidebarCollapsed) return;
    sidebarShouldCollapseRef.current = false;
    setSidebarResizing(true);
    updateSidebarWidthFromClientX(clientX);
  }, [sidebarCollapsed, updateSidebarWidthFromClientX]);

  const resizeInspectorBy = useCallback((delta: number): void => {
    const nextWidth = clampInspectorWidth(inspectorWidth + delta);
    setInspectorCollapsed(false);
    collapseSidebarForWorkspacePressure(nextWidth);
    if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
      setSyncedInspectorWidth(INSPECTOR_MIN_WIDTH);
      setInspectorCollapsed(true);
      return;
    }
    setSyncedInspectorWidth(nextWidth);
  }, [clampInspectorWidth, collapseSidebarForWorkspacePressure, inspectorWidth, setSyncedInspectorWidth]);

  const resizeSidebarBy = useCallback((delta: number): void => {
    const rawWidth = sidebarWidth + delta;
    setSidebarCollapsed(false);
    if (rawWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH || (sidebarWidth <= SIDEBAR_MIN_WIDTH && rawWidth < SIDEBAR_MIN_WIDTH)) {
      setSyncedSidebarWidth(SIDEBAR_MIN_WIDTH);
      setSidebarCollapsed(true);
      return;
    }
    setSyncedSidebarWidth(clampSidebarWidth(rawWidth));
  }, [clampSidebarWidth, setSyncedSidebarWidth, sidebarWidth]);

  const toggleInspector = useCallback((): void => {
    setInspectorCollapsed((collapsed) => {
      if (collapsed || inspectorWidth < INSPECTOR_READABLE_WIDTH) {
        setInspectorWidth(INSPECTOR_DEFAULT_WIDTH);
        return false;
      }
      return true;
    });
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

    function updateFromPointer(event: PointerEvent): void {
      updateInspectorWidthFromClientX(event.clientX);
    }

    function stopResize(): void {
      setInspectorResizing(false);
      if (inspectorWidthRef.current <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
        const collapse = () => setInspectorCollapsed(true);
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(collapse);
          return;
        }
        collapse();
      }
    }

    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [inspectorResizing, updateInspectorWidthFromClientX]);

  useEffect(() => {
    if (!sidebarResizing) return;

    function updateFromPointer(event: PointerEvent): void {
      updateSidebarWidthFromClientX(event.clientX);
    }

    function stopResize(): void {
      setSidebarResizing(false);
      if (sidebarShouldCollapseRef.current) {
        sidebarShouldCollapseRef.current = false;
        const collapse = () => setSidebarCollapsed(true);
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(collapse);
          return;
        }
        collapse();
      }
    }

    window.addEventListener('pointermove', updateFromPointer);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', updateFromPointer);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
  }, [sidebarResizing, updateSidebarWidthFromClientX]);

  const shellStyle = {
    '--inspector-w': `${inspectorWidth}px`,
    '--sidebar-w': `${sidebarWidth}px`,
  } as React.CSSProperties;

  return {
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
    shellStyle,
  };
}
