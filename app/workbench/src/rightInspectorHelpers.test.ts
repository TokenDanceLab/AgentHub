import { describe, expect, it, vi } from 'vitest';
import type { EvidenceRef } from '@shared/transcript';
import type { RuntimeEvidenceSnapshot } from '@shared/inspector';
import {
  createInspectorResizerKeyDownHandler,
  createInspectorResizerPointerDownHandler,
  inspectorDataPreviewAttr,
  planCloseInspectorTab,
  planDeployAutoSwitch,
  planOpenPreviewUrl,
  planRestoreInspectorTab,
  planReviewFileRequest,
  resolveBrowserPreviewUrl,
  resolveDagNodesFromRouteBlocks,
  resolveFallbackInspectorMode,
  resolveFileClickTarget,
  resolveOverviewFiles,
  resolveOverviewTasks,
  resolveRuntimePreviewUrl,
  shellBooleanAttr,
  shouldAutoSwitchDeployPreview,
  withInspectorTab,
  withoutInspectorTab,
} from './rightInspectorHelpers';

function emptyRuntimeEvidence(overrides: Partial<RuntimeEvidenceSnapshot> = {}): RuntimeEvidenceSnapshot {
  return {
    runId: 'run-1',
    diffs: [],
    artifacts: [],
    previews: [],
    ...overrides,
  };
}

describe('rightInspectorHelpers', () => {
  it('maps shell boolean attrs and preview mode attr', () => {
    expect(shellBooleanAttr(true)).toBe('true');
    expect(shellBooleanAttr(false)).toBe('false');
    expect(inspectorDataPreviewAttr('overview')).toBe('false');
    expect(inspectorDataPreviewAttr('browser')).toBe('true');
    expect(inspectorDataPreviewAttr('files')).toBe('true');
  });

  it('builds empty dag nodes without route blocks', () => {
    expect(resolveDagNodesFromRouteBlocks(undefined)).toEqual([]);
    expect(resolveDagNodesFromRouteBlocks([])).toEqual([]);
  });

  it('adds and removes inspector tabs immutably', () => {
    const base = new Set<'overview' | 'browser' | 'files'>(['overview']);
    const withBrowser = withInspectorTab(base, 'browser');
    expect([...withBrowser].sort()).toEqual(['browser', 'overview']);
    expect(base.has('browser')).toBe(false);

    const withoutOverview = withoutInspectorTab(withBrowser, 'overview');
    expect([...withoutOverview]).toEqual(['browser']);
    expect(withBrowser.has('overview')).toBe(true);
  });

  it('resolves fallback mode using pre-close visible tabs', () => {
    const tabs = [
      { mode: 'overview' as const },
      { mode: 'browser' as const },
      { mode: 'files' as const },
    ];
    const visible = new Set(tabs.map((tab) => tab.mode));

    expect(resolveFallbackInspectorMode('files', 'files', tabs, visible)).toBe('overview');
    expect(resolveFallbackInspectorMode('browser', 'files', tabs, visible)).toBe('browser');
    expect(
      resolveFallbackInspectorMode('browser', 'browser', tabs, new Set(['browser'])),
    ).toBe('overview');
  });

  it('plans tab close / restore / preview open transitions', () => {
    const tabs = [
      { mode: 'overview' as const },
      { mode: 'browser' as const },
      { mode: 'files' as const },
    ];
    const visible = new Set(tabs.map((tab) => tab.mode));

    const closeFiles = planCloseInspectorTab({
      mode: 'files',
      activeMode: 'files',
      visibleTabs: visible,
      inspectorTabs: tabs,
    });
    expect(closeFiles.clearPreviewFile).toBe(true);
    expect(closeFiles.clearBrowserUrl).toBe(false);
    expect(closeFiles.nextActiveMode).toBe('overview');
    expect(closeFiles.visibleTabs.has('files')).toBe(false);

    const closeBrowser = planCloseInspectorTab({
      mode: 'browser',
      activeMode: 'overview',
      visibleTabs: visible,
      inspectorTabs: tabs,
    });
    expect(closeBrowser.clearBrowserUrl).toBe(true);
    expect(closeBrowser.nextActiveMode).toBe('overview');

    const restore = planRestoreInspectorTab(new Set(['overview']), 'files');
    expect(restore.activeMode).toBe('files');
    expect(restore.quickOpenVisible).toBe(false);
    expect(restore.visibleTabs.has('files')).toBe(true);

    const openUrl = planOpenPreviewUrl(new Set(['overview']), 'https://preview.example');
    expect(openUrl).toEqual({
      visibleTabs: new Set(['overview', 'browser']),
      browserUrl: 'https://preview.example',
      activeMode: 'browser',
    });

    const review = planReviewFileRequest(new Set(['overview']), { name: 'a.ts', type: 'ts' });
    expect(review.activeMode).toBe('files');
    expect(review.previewFile.name).toBe('a.ts');
    expect(review.visibleTabs.has('files')).toBe(true);
  });

  it('gates deploy auto-switch to new real URLs only', () => {
    expect(shouldAutoSwitchDeployPreview(undefined, true, null)).toBe(false);
    expect(shouldAutoSwitchDeployPreview('https://a.test', false, null)).toBe(false);
    expect(shouldAutoSwitchDeployPreview('https://a.test', true, 'https://a.test')).toBe(false);
    expect(shouldAutoSwitchDeployPreview('https://a.test', true, null)).toBe(true);
    expect(shouldAutoSwitchDeployPreview('https://b.test', true, 'https://a.test')).toBe(true);
    /* P77 #1318: themed blank demo previews must not steal overview. */
    expect(shouldAutoSwitchDeployPreview('about:blank', true, null)).toBe(false);
    expect(shouldAutoSwitchDeployPreview(' about:blank# ', true, null)).toBe(false);
    expect(shouldAutoSwitchDeployPreview('', true, null)).toBe(false);

    const plan = planDeployAutoSwitch(new Set(['overview']), 'https://deploy.test');
    expect(plan.activeMode).toBe('browser');
    expect(plan.browserUrl).toBe('https://deploy.test');
    expect(plan.lastAutoSwitchedUrl).toBe('https://deploy.test');
    expect(plan.visibleTabs.has('browser')).toBe(true);
  });

  it('resolves browser preview URL precedence', () => {
    expect(resolveBrowserPreviewUrl('https://local', undefined, 'https://default')).toBe('https://local');
    expect(resolveBrowserPreviewUrl(null, undefined, 'https://default')).toBe('https://default');

    const runtime = emptyRuntimeEvidence({
      previews: [
        {
          id: 'p0',
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'starting',
          url: 'https://pending',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'p1',
          runId: 'run-1',
          threadId: 'thread-1',
          status: 'ready',
          url: 'https://ready',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    expect(resolveRuntimePreviewUrl(runtime)).toBe('https://ready');
    expect(resolveBrowserPreviewUrl(null, runtime, 'https://default')).toBe('https://ready');
  });

  it('marks open overview files and resolves file click targets', () => {
    const evidence: EvidenceRef[] = [
      {
        id: 'e1',
        kind: 'file',
        label: 'src/a.ts',
        status: 'completed',
      },
    ];
    const files = resolveOverviewFiles(evidence, undefined, 'src/a.ts');
    expect(files.some((file) => file.name.includes('a.ts') && file.isOpen === true)).toBe(true);

    const tasks = resolveOverviewTasks(evidence, undefined);
    expect(Array.isArray(tasks)).toBe(true);

    const rich = [{ name: 'src/a.ts', type: 'ts', content: 'export {}', isOpen: true }];
    expect(resolveFileClickTarget(rich, { name: 'src/a.ts' })).toEqual(rich[0]);
    expect(resolveFileClickTarget(rich, { name: 'missing.ts' })).toEqual({ name: 'missing.ts' });
  });

  it('handles inspector resizer keyboard and pointer events', () => {
    const resizeBy = vi.fn();
    const onKeyDown = createInspectorResizerKeyDownHandler(resizeBy);

    onKeyDown({
      key: 'ArrowUp',
      preventDefault: vi.fn(),
      shiftKey: false,
    } as never);
    expect(resizeBy).not.toHaveBeenCalled();

    const preventDefault = vi.fn();
    onKeyDown({
      key: 'ArrowLeft',
      preventDefault,
      shiftKey: false,
    } as never);
    expect(preventDefault).toHaveBeenCalled();
    expect(resizeBy).toHaveBeenCalledWith(16);

    onKeyDown({
      key: 'ArrowRight',
      preventDefault: vi.fn(),
      shiftKey: true,
    } as never);
    expect(resizeBy).toHaveBeenLastCalledWith(-40);

    const beginResize = vi.fn();
    const setPointerCapture = vi.fn();
    const onPointerDown = createInspectorResizerPointerDownHandler(false, beginResize);
    const prevent = vi.fn();
    onPointerDown({
      preventDefault: prevent,
      pointerId: 7,
      clientX: 420,
      currentTarget: { setPointerCapture },
    } as never);
    expect(prevent).toHaveBeenCalled();
    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(beginResize).toHaveBeenCalledWith(420);

    const blocked = createInspectorResizerPointerDownHandler(true, beginResize);
    blocked({
      preventDefault: vi.fn(),
      pointerId: 1,
      clientX: 1,
      currentTarget: { setPointerCapture: vi.fn() },
    } as never);
    expect(beginResize).toHaveBeenCalledTimes(1);
  });
});
