import { describe, expect, it } from 'vitest';
import {
  DESKTOP_WORKSPACE_VIEWPORT,
  evaluateSidebarVsTerminalDock,
  firstInViewportListSignal,
  isListSignalInViewport,
  rectsIntersect,
} from './geometrySmoke';

describe('geometrySmoke helpers (#1284)', () => {
  it('detects non-overlapping sidebar + dock (correct desktop columns)', () => {
    const sidebar = { x: 52, y: 0, width: 260, height: 810 };
    const dock = { x: 312, y: 590, width: 800, height: 220 };
    expect(rectsIntersect(sidebar, dock)).toBe(false);
    expect(evaluateSidebarVsTerminalDock(sidebar, dock)).toEqual({ ok: true });
  });

  it('fails when dock spans full width under the sidebar', () => {
    const sidebar = { x: 52, y: 0, width: 260, height: 590 };
    const dock = { x: 0, y: 590, width: 1440, height: 220 };
    const result = evaluateSidebarVsTerminalDock(sidebar, dock);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/under sidebar|intersects/i);
  });

  it('fails when sidebar bottom intersects dock top in the same columns', () => {
    const sidebar = { x: 312, y: 0, width: 400, height: 700 };
    const dock = { x: 312, y: 590, width: 800, height: 220 };
    const result = evaluateSidebarVsTerminalDock(sidebar, dock);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/intersect/i);
  });

  it('accepts agent rows whose top edge is inside the 810 viewport', () => {
    expect(
      isListSignalInViewport(
        { x: 80, y: 220, width: 280, height: 64 },
        DESKTOP_WORKSPACE_VIEWPORT.height,
      ),
    ).toBe(true);
    expect(
      isListSignalInViewport(
        { x: 80, y: 0, width: 280, height: 40 },
        DESKTOP_WORKSPACE_VIEWPORT.height,
      ),
    ).toBe(true);
    expect(
      isListSignalInViewport(
        { x: 80, y: 810, width: 280, height: 40 },
        DESKTOP_WORKSPACE_VIEWPORT.height,
      ),
    ).toBe(true);
  });

  it('rejects rows scrolled fully below the viewport', () => {
    expect(
      isListSignalInViewport(
        { x: 80, y: 900, width: 280, height: 64 },
        DESKTOP_WORKSPACE_VIEWPORT.height,
      ),
    ).toBe(false);
    expect(isListSignalInViewport(null)).toBe(false);
    expect(isListSignalInViewport({ x: 0, y: 10, width: 0, height: 10 })).toBe(false);
  });

  it('picks the first in-viewport list signal', () => {
    const hit = firstInViewportListSignal([
      { x: 0, y: 950, width: 100, height: 40 },
      { x: 0, y: 240, width: 100, height: 40 },
      { x: 0, y: 300, width: 100, height: 40 },
    ]);
    expect(hit).toEqual({ x: 0, y: 240, width: 100, height: 40 });
  });
});
