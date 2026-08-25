import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkbenchPanelLayout } from './useWorkbenchPanelLayout';
import {
  canAutoOpenEngineeringColumn,
  engineeringColumnActivitySignal,
  useEngineeringColumnAutoOpen,
} from './useEngineeringColumnAutoOpen';
import {
  readEngineeringColumnPreference,
  writeEngineeringColumnPreference,
} from './workbenchPreferences';

function layoutMock(collapsed: boolean) {
  return {
    inspectorCollapsed: collapsed,
    openInspector: vi.fn(),
    closeInspector: vi.fn(),
    toggleInspector: vi.fn(),
  } as unknown as WorkbenchPanelLayout;
}

describe('engineeringColumnActivitySignal (#1964)', () => {
  it('stays idle for pure chat and changes for active runs or new artifacts', () => {
    expect(engineeringColumnActivitySignal({})).toBeNull();
    expect(engineeringColumnActivitySignal({ isAgentRunning: true })).toContain('run:active');
    expect(engineeringColumnActivitySignal({
      runtimeEvidence: {
        runId: 'run-1',
        diffs: [],
        artifacts: [{
          id: 'artifact-1', runId: 'run-1', threadId: 'thread-1', kind: 'file', path: 'out.md', sizeBytes: 2,
        }],
        previews: [],
      },
    })).toContain('artifact:artifact-1');
  });

  it('protects narrow layouts from automatic expansion', () => {
    expect(canAutoOpenEngineeringColumn('desktop', 800)).toBe(false);
    expect(canAutoOpenEngineeringColumn('desktop', 1440)).toBe(true);
    expect(canAutoOpenEngineeringColumn('web', 768)).toBe(true);
    expect(canAutoOpenEngineeringColumn('mobile', 1440)).toBe(false);
  });
});

describe('useEngineeringColumnAutoOpen (#1964)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
  });

  it('auto-expands for an active run', async () => {
    const layout = layoutMock(true);
    renderHook(() => useEngineeringColumnAutoOpen({
      conversationId: 'conv-a',
      isChatPage: true,
      platformSurface: 'desktop',
      activitySignal: 'run:active',
      layout,
    }));
    await waitFor(() => expect(layout.openInspector).toHaveBeenCalled());
    expect(readEngineeringColumnPreference('conv-a')).toEqual({
      collapsed: false,
      autoOpenSuppressed: false,
    });
  });

  it('persists manual collapse suppression and ignores later artifacts in that conversation', async () => {
    const expanded = layoutMock(false);
    const { result, rerender } = renderHook(
      ({ signal, layout }) => useEngineeringColumnAutoOpen({
        conversationId: 'conv-a',
        isChatPage: true,
        platformSurface: 'desktop',
        activitySignal: signal,
        layout,
      }),
      { initialProps: { signal: 'run:active', layout: expanded } },
    );
    await waitFor(() => expect(expanded.openInspector).toHaveBeenCalledTimes(1));
    act(() => result.current.toggleInspector());
    expect(expanded.closeInspector).toHaveBeenCalledTimes(1);
    expect(readEngineeringColumnPreference('conv-a')).toEqual({
      collapsed: true,
      autoOpenSuppressed: true,
    });

    const collapsed = layoutMock(true);
    rerender({ signal: 'run:active|artifact:new', layout: collapsed });
    await Promise.resolve();
    expect(collapsed.openInspector).not.toHaveBeenCalled();
  });

  it('restores isolated conversation preferences when switching sessions', async () => {
    writeEngineeringColumnPreference('conv-a', { collapsed: true, autoOpenSuppressed: true });
    writeEngineeringColumnPreference('conv-b', { collapsed: false, autoOpenSuppressed: false });
    const layout = layoutMock(false);
    const { rerender } = renderHook(
      ({ conversationId }) => useEngineeringColumnAutoOpen({
        conversationId,
        isChatPage: true,
        platformSurface: 'desktop',
        activitySignal: 'run:active',
        layout,
      }),
      { initialProps: { conversationId: 'conv-a' } },
    );
    await waitFor(() => expect(layout.closeInspector).toHaveBeenCalledTimes(1));

    rerender({ conversationId: 'conv-b' });
    await waitFor(() => expect(layout.openInspector).toHaveBeenCalled());

    rerender({ conversationId: 'conv-a' });
    await waitFor(() => expect(layout.closeInspector).toHaveBeenCalledTimes(2));
  });
});
