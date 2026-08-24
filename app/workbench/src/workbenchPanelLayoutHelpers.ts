import type React from 'react';
import type { AgentHubPlatform } from '@shared/platform';
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

/* ═══════════════════════════════════════════════════════════════════════
   workbenchPanelLayoutHelpers — pure residual slices from
   useWorkbenchPanelLayout (#721).

   Public option/return types, width clamps, restore/toggle/resize plans,
   workspace-pressure collapse checks, shell CSS vars, and rAF collapse
   scheduling. No React hooks / no intentional UX change.
   exactOptionalPropertyTypes: only assign `?: T` fields when defined,
   unless the public field type explicitly allows `| undefined`.
   ═══════════════════════════════════════════════════════════════════════ */

/** Global left rail width used when converting pointer X → sidebar width. */
export const GLOBAL_RAIL_WIDTH = 52;

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

export function clampInspectorWidth(value: number): number {
  return Math.min(INSPECTOR_MAX_WIDTH, Math.max(INSPECTOR_MIN_WIDTH, Math.round(value)));
}

export function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(value)));
}

/** Restore inspector width only when the current value is unreadable. */
export function resolveRestoredInspectorWidth(
  currentWidth: number,
  width = INSPECTOR_DEFAULT_WIDTH,
): number {
  return currentWidth < INSPECTOR_READABLE_WIDTH
    ? clampInspectorWidth(width)
    : currentWidth;
}

/** Restore sidebar width only when the current value is below the minimum. */
export function resolveRestoredSidebarWidth(
  currentWidth: number,
  width = SIDEBAR_DEFAULT_WIDTH,
): number {
  return currentWidth < SIDEBAR_MIN_WIDTH
    ? clampSidebarWidth(width)
    : currentWidth;
}

export function shouldCollapseSidebarForWorkspacePressure(params: {
  isChatPage: boolean;
  sidebarCollapsed: boolean;
  viewportWidth: number;
  sidebarWidth: number;
  nextInspectorWidth: number;
  railWidth?: number;
  minWorkspaceWidth?: number;
}): boolean {
  if (!params.isChatPage || params.sidebarCollapsed) return false;
  const railWidth = params.railWidth ?? GLOBAL_RAIL_WIDTH;
  const availableWorkspaceWidth =
    params.viewportWidth - railWidth - params.sidebarWidth - params.nextInspectorWidth;
  return availableWorkspaceWidth < (params.minWorkspaceWidth ?? WORKSPACE_AUTO_COLLAPSE_WIDTH);
}

export type ToggleCollapsedPlan =
  | { kind: 'expand'; width: number; collapsed: false }
  | { kind: 'collapse'; collapsed: true };

export function planToggleSidebar(params: {
  collapsed: boolean;
  sidebarWidth: number;
}): ToggleCollapsedPlan {
  if (params.collapsed || params.sidebarWidth < SIDEBAR_MIN_WIDTH) {
    return { kind: 'expand', width: SIDEBAR_DEFAULT_WIDTH, collapsed: false };
  }
  return { kind: 'collapse', collapsed: true };
}

export function planToggleInspector(params: {
  collapsed: boolean;
  inspectorWidth: number;
}): ToggleCollapsedPlan {
  if (params.collapsed || params.inspectorWidth < INSPECTOR_READABLE_WIDTH) {
    return { kind: 'expand', width: INSPECTOR_DEFAULT_WIDTH, collapsed: false };
  }
  return { kind: 'collapse', collapsed: true };
}

export type NavigateRailPlan =
  | { kind: 'chat'; page: 'chat'; expandSidebar: true }
  | { kind: 'other'; page: GlobalRailPage; expandSidebar: false };

export function planNavigateRail(page: GlobalRailPage): NavigateRailPlan {
  if (page === 'chat') {
    return { kind: 'chat', page: 'chat', expandSidebar: true };
  }
  return { kind: 'other', page, expandSidebar: false };
}

export type InspectorClientXPlan =
  | {
      kind: 'snap-collapse';
      width: number;
      clampedWidth: number;
      stopResizing: true;
      scheduleCollapse: true;
    }
  | {
      kind: 'resize';
      width: number;
      clampedWidth: number;
      stopResizing: false;
      scheduleCollapse: false;
    };

export function planInspectorWidthFromClientX(params: {
  clientX: number;
  viewportWidth: number;
}): InspectorClientXPlan {
  const nextWidth = params.viewportWidth - params.clientX;
  const clampedWidth = clampInspectorWidth(nextWidth);
  if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
    return {
      kind: 'snap-collapse',
      width: INSPECTOR_MIN_WIDTH,
      clampedWidth,
      stopResizing: true,
      scheduleCollapse: true,
    };
  }
  return {
    kind: 'resize',
    width: clampedWidth,
    clampedWidth,
    stopResizing: false,
    scheduleCollapse: false,
  };
}

export type SidebarClientXPlan =
  | { kind: 'snap-pending'; width: number; shouldCollapse: true }
  | { kind: 'resize'; width: number; shouldCollapse: false };

export function planSidebarWidthFromClientX(params: {
  clientX: number;
  railWidth?: number;
}): SidebarClientXPlan {
  const railWidth = params.railWidth ?? GLOBAL_RAIL_WIDTH;
  const nextWidth = params.clientX - railWidth;
  if (nextWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH) {
    return {
      kind: 'snap-pending',
      width: SIDEBAR_MIN_WIDTH,
      shouldCollapse: true,
    };
  }
  return {
    kind: 'resize',
    width: clampSidebarWidth(nextWidth),
    shouldCollapse: false,
  };
}

export type InspectorResizeByPlan =
  | { kind: 'collapse'; width: number; pressureWidth: number }
  | { kind: 'resize'; width: number; pressureWidth: number };

export function planInspectorResizeBy(params: {
  inspectorWidth: number;
  delta: number;
}): InspectorResizeByPlan {
  const nextWidth = clampInspectorWidth(params.inspectorWidth + params.delta);
  if (nextWidth <= INSPECTOR_COLLAPSE_SNAP_WIDTH) {
    return {
      kind: 'collapse',
      width: INSPECTOR_MIN_WIDTH,
      pressureWidth: nextWidth,
    };
  }
  return {
    kind: 'resize',
    width: nextWidth,
    pressureWidth: nextWidth,
  };
}

export type SidebarResizeByPlan =
  | { kind: 'collapse'; width: number }
  | { kind: 'resize'; width: number };

export function planSidebarResizeBy(params: {
  sidebarWidth: number;
  delta: number;
}): SidebarResizeByPlan {
  const rawWidth = params.sidebarWidth + params.delta;
  if (
    rawWidth <= SIDEBAR_COLLAPSE_SNAP_WIDTH
    || (params.sidebarWidth <= SIDEBAR_MIN_WIDTH && rawWidth < SIDEBAR_MIN_WIDTH)
  ) {
    return { kind: 'collapse', width: SIDEBAR_MIN_WIDTH };
  }
  return { kind: 'resize', width: clampSidebarWidth(rawWidth) };
}

export function canBeginPanelResize(collapsed: boolean): boolean {
  return !collapsed;
}

export function shouldCollapseInspectorOnResizeEnd(width: number): boolean {
  return width <= INSPECTOR_COLLAPSE_SNAP_WIDTH;
}

/** Prefer rAF when available so collapse paints after the final width write. */
export function schedulePanelCollapse(collapse: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(collapse);
    return;
  }
  collapse();
}

export function buildPanelShellStyle(params: {
  inspectorWidth: number;
  sidebarWidth: number;
}): React.CSSProperties {
  return {
    '--inspector-w': `${params.inspectorWidth}px`,
    '--sidebar-w': `${params.sidebarWidth}px`,
  } as React.CSSProperties;
}

/** Shared pointer-resize subscription used by inspector + sidebar effects. */
export function attachPanelPointerResizeListeners(params: {
  onMoveClientX: (clientX: number) => void;
  onStop: () => void;
}): () => void {
  function updateFromPointer(event: PointerEvent): void {
    params.onMoveClientX(event.clientX);
  }

  function stopResize(): void {
    params.onStop();
  }

  window.addEventListener('pointermove', updateFromPointer);
  window.addEventListener('pointerup', stopResize);
  window.addEventListener('pointercancel', stopResize);
  return () => {
    window.removeEventListener('pointermove', updateFromPointer);
    window.removeEventListener('pointerup', stopResize);
    window.removeEventListener('pointercancel', stopResize);
  };
}

export function stopInspectorPointerResize(params: {
  currentWidth: number;
  setInspectorResizing: (value: boolean) => void;
  setInspectorCollapsed: (value: boolean) => void;
}): void {
  params.setInspectorResizing(false);
  if (shouldCollapseInspectorOnResizeEnd(params.currentWidth)) {
    schedulePanelCollapse(() => params.setInspectorCollapsed(true));
  }
}

export function stopSidebarPointerResize(params: {
  shouldCollapseRef: React.MutableRefObject<boolean>;
  setSidebarResizing: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
}): void {
  params.setSidebarResizing(false);
  if (params.shouldCollapseRef.current) {
    params.shouldCollapseRef.current = false;
    schedulePanelCollapse(() => params.setSidebarCollapsed(true));
  }
}

/** Apply expand/collapse toggle plan; returns next collapsed flag. */
export function applyToggleCollapsedPlan(
  plan: ToggleCollapsedPlan,
  setWidth: (width: number) => void,
): boolean {
  if (plan.kind === 'expand') {
    setWidth(plan.width);
    return plan.collapsed;
  }
  return plan.collapsed;
}

export function applyInspectorClientXPlan(params: {
  plan: InspectorClientXPlan;
  setSyncedInspectorWidth: (width: number) => void;
  setInspectorResizing: (value: boolean) => void;
  setInspectorCollapsed: (value: boolean) => void;
  collapseSidebarForWorkspacePressure: (nextInspectorWidth: number) => void;
}): void {
  params.setInspectorCollapsed(false);
  params.collapseSidebarForWorkspacePressure(params.plan.clampedWidth);
  if (params.plan.kind === 'snap-collapse') {
    params.setSyncedInspectorWidth(params.plan.width);
    params.setInspectorResizing(false);
    schedulePanelCollapse(() => params.setInspectorCollapsed(true));
    return;
  }
  params.setSyncedInspectorWidth(params.plan.width);
}

export function applySidebarClientXPlan(params: {
  plan: SidebarClientXPlan;
  shouldCollapseRef: React.MutableRefObject<boolean>;
  setSidebarCollapsed: (value: boolean) => void;
  setSyncedSidebarWidth: (width: number) => void;
}): void {
  params.setSidebarCollapsed(false);
  params.shouldCollapseRef.current = params.plan.shouldCollapse;
  params.setSyncedSidebarWidth(params.plan.width);
}

export function applyInspectorResizeByPlan(params: {
  plan: InspectorResizeByPlan;
  setInspectorCollapsed: (value: boolean) => void;
  setSyncedInspectorWidth: (width: number) => void;
  collapseSidebarForWorkspacePressure: (nextInspectorWidth: number) => void;
}): void {
  params.setInspectorCollapsed(false);
  params.collapseSidebarForWorkspacePressure(params.plan.pressureWidth);
  if (params.plan.kind === 'collapse') {
    params.setSyncedInspectorWidth(params.plan.width);
    params.setInspectorCollapsed(true);
    return;
  }
  params.setSyncedInspectorWidth(params.plan.width);
}

export function applySidebarResizeByPlan(params: {
  plan: SidebarResizeByPlan;
  setSidebarCollapsed: (value: boolean) => void;
  setSyncedSidebarWidth: (width: number) => void;
}): void {
  params.setSidebarCollapsed(false);
  if (params.plan.kind === 'collapse') {
    params.setSyncedSidebarWidth(params.plan.width);
    params.setSidebarCollapsed(true);
    return;
  }
  params.setSyncedSidebarWidth(params.plan.width);
}

export function applyNavigateRailPlan(params: {
  plan: NavigateRailPlan;
  setActivePage: (page: GlobalRailPage) => void;
  setSidebarCollapsed: (value: boolean) => void;
  restoreSidebarWidth: () => void;
}): void {
  if (params.plan.kind === 'chat') {
    params.setActivePage(params.plan.page);
    params.setSidebarCollapsed(false);
    params.restoreSidebarWidth();
    return;
  }
  params.setActivePage(params.plan.page);
}

export function maybeCollapseSidebarForWorkspacePressure(params: {
  isChatPage: boolean;
  sidebarCollapsed: boolean;
  viewportWidth: number;
  sidebarWidth: number;
  nextInspectorWidth: number;
  minWorkspaceWidth?: number;
  setSidebarCollapsed: (value: boolean) => void;
}): void {
  if (shouldCollapseSidebarForWorkspacePressure({
    isChatPage: params.isChatPage,
    sidebarCollapsed: params.sidebarCollapsed,
    viewportWidth: params.viewportWidth,
    sidebarWidth: params.sidebarWidth,
    nextInspectorWidth: params.nextInspectorWidth,
    ...(params.minWorkspaceWidth === undefined
      ? {}
      : { minWorkspaceWidth: params.minWorkspaceWidth }),
  })) {
    params.setSidebarCollapsed(true);
  }
}

export function createSyncedWidthWriter(
  widthRef: React.MutableRefObject<number>,
  setWidth: (width: number) => void,
): (width: number) => void {
  return (width: number): void => {
    widthRef.current = width;
    setWidth(width);
  };
}

export function resolveWidthWithRefSync(
  resolveNext: (currentWidth: number) => number,
  widthRef: React.MutableRefObject<number>,
): (currentWidth: number) => number {
  return (currentWidth: number): number => {
    const nextWidth = resolveNext(currentWidth);
    widthRef.current = nextWidth;
    return nextWidth;
  };
}

export function buildWorkbenchPanelLayoutResult(params: {
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
}): WorkbenchPanelLayout {
  return {
    inspectorWidth: params.inspectorWidth,
    inspectorCollapsed: params.inspectorCollapsed,
    inspectorResizing: params.inspectorResizing,
    sidebarWidth: params.sidebarWidth,
    sidebarCollapsed: params.sidebarCollapsed,
    sidebarResizing: params.sidebarResizing,
    inspectorWidthRef: params.inspectorWidthRef,
    sidebarWidthRef: params.sidebarWidthRef,
    sidebarShouldCollapseRef: params.sidebarShouldCollapseRef,
    setInspectorResizing: params.setInspectorResizing,
    setSidebarResizing: params.setSidebarResizing,
    toggleInspector: params.toggleInspector,
    toggleSidebar: params.toggleSidebar,
    navigateRail: params.navigateRail,
    beginInspectorResize: params.beginInspectorResize,
    beginSidebarResize: params.beginSidebarResize,
    resizeInspectorBy: params.resizeInspectorBy,
    resizeSidebarBy: params.resizeSidebarBy,
    openInspector: params.openInspector,
    restoreInspectorWidth: params.restoreInspectorWidth,
    restoreSidebarWidth: params.restoreSidebarWidth,
    shellStyle: buildPanelShellStyle({
      inspectorWidth: params.inspectorWidth,
      sidebarWidth: params.sidebarWidth,
    }),
  };
}
