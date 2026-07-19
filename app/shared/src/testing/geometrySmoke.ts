/**
 * Pure geometry helpers for layout smoke (#1284).
 * Used by unit tests and Playwright bounding-box assertions.
 */

export interface GeometryRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DESKTOP_WORKSPACE_VIEWPORT = { width: 1440, height: 810 } as const;

export function rectBottom(rect: GeometryRect): number {
  return rect.y + rect.height;
}

export function rectRight(rect: GeometryRect): number {
  return rect.x + rect.width;
}

/** Axis-aligned intersection with a small epsilon for subpixel layout. */
export function rectsIntersect(
  a: GeometryRect,
  b: GeometryRect,
  epsilon = 0.5,
): boolean {
  return !(
    rectRight(a) <= b.x + epsilon ||
    rectRight(b) <= a.x + epsilon ||
    rectBottom(a) <= b.y + epsilon ||
    rectBottom(b) <= a.y + epsilon
  );
}

export interface SidebarDockGeometryResult {
  ok: boolean;
  reason?: string;
}

/**
 * Terminal dock must stay under workspace + inspector only:
 * conversation sidebar must not share area with the dock, and the dock
 * must start at or after the sidebar's right edge.
 */
export function evaluateSidebarVsTerminalDock(
  sidebar: GeometryRect,
  dock: GeometryRect,
  epsilon = 0.5,
): SidebarDockGeometryResult {
  if (sidebar.width <= 0 || sidebar.height <= 0) {
    return { ok: false, reason: 'sidebar box is empty' };
  }
  if (dock.width <= 0 || dock.height <= 0) {
    return { ok: false, reason: 'terminal dock box is empty' };
  }
  if (rectsIntersect(sidebar, dock, epsilon)) {
    return {
      ok: false,
      reason: `sidebar intersects terminal dock (sidebar bottom=${rectBottom(sidebar).toFixed(1)}, dock top=${dock.y.toFixed(1)})`,
    };
  }
  if (dock.x + epsilon < rectRight(sidebar)) {
    return {
      ok: false,
      reason: `terminal dock starts under sidebar column (dock.x=${dock.x.toFixed(1)} < sidebar right=${rectRight(sidebar).toFixed(1)})`,
    };
  }
  return { ok: true };
}

/**
 * Agents list signal is considered in-viewport when its top edge sits in
 * [0, viewportHeight] after settle (visual QA 1440×810 contract).
 */
export function isListSignalInViewport(
  box: GeometryRect | null | undefined,
  viewportHeight: number = DESKTOP_WORKSPACE_VIEWPORT.height,
): boolean {
  if (!box || box.width <= 0 || box.height <= 0) return false;
  return box.y >= 0 && box.y <= viewportHeight;
}

export function firstInViewportListSignal(
  boxes: ReadonlyArray<GeometryRect | null | undefined>,
  viewportHeight: number = DESKTOP_WORKSPACE_VIEWPORT.height,
): GeometryRect | null {
  for (const box of boxes) {
    if (box && isListSignalInViewport(box, viewportHeight)) {
      return box;
    }
  }
  return null;
}
