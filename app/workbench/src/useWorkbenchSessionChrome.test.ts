// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentHubPlatform,
  LocalCliDiscoveryManifest,
  RuntimeSessionSummary,
  WorkbenchAgent,
  WorkbenchConversation,
} from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import { INSPECTOR_DEFAULT_COLLAPSE_EVENT } from './workbenchLayoutConstants';
import { WORKBENCH_MOCK_SETTINGS_DEFAULTS } from './mockData';
import {
  LOCAL_CLI_DISCOVERY_FALLBACK,
  useWorkbenchSessionChrome,
  type UseWorkbenchSessionChromeOptions,
} from './useWorkbenchSessionChrome';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchSessionChrome — hook-level wiring over the #674 helpers.

   Covers default state for an empty shell, conversation id resolution
   (controlled / local / fallback), selectConversation wiring, composer
   state + draft persistence, agent mention mapping, transcript evidence
   + mainchain summary derivation, inspector transcript projections,
   execution-target auto-clear, local CLI discovery and runtime session
   import gates (desktop settings only), chat search shortcut, settings
   service creation + inspector collapse default, theme toggle, inspector
   review/deploy callbacks, and the evidence export callback.
   ═══════════════════════════════════════════════════════════════════════ */

/** Key-echo translator matching the helper test convention. */
function t(key: string, options?: Record<string, unknown>): string {
  if (options && 'name' in options) return `${key}:${String(options.name)}`;
  if (options && 'count' in options) return `${key}:${String(options.count)}`;
  return key;
}

function conversation(
  partial: Partial<WorkbenchConversation> & Pick<WorkbenchConversation, 'id' | 'title'>,
): WorkbenchConversation {
  return { kind: 'direct', ...partial };
}

function routeDecisionBlock(id: string): TranscriptBlock {
  return {
    id,
    kind: 'route_decision',
    author: { id: 'router', name: 'Router', role: 'system' },
    action: 'delegate',
    targetAgent: 'coder',
  };
}

function contextUsageBlock(id: string): TranscriptBlock {
  return {
    id,
    kind: 'context_usage',
    author: { id: 'ctx', name: 'Ctx', role: 'system' },
    modelLabel: 'gpt-test',
    inputTokens: 100,
    outputTokens: 50,
  };
}

function previewBlock(id: string, url: string): TranscriptBlock {
  return {
    id,
    kind: 'preview',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    previewId: `pv-${id}`,
    status: 'completed',
    url,
  };
}

function resultBlock(id: string): TranscriptBlock {
  return {
    id,
    kind: 'result',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    success: true,
    summary: '任务完成',
    duration: '8m12s',
  };
}

function runSessionBlock(id: string): TranscriptBlock {
  return {
    id,
    kind: 'run_session',
    author: { id: 'builder', name: 'Builder', role: 'agent' },
    title: '构建任务',
    taskId: 'task-1',
    agentLabel: 'Builder',
  };
}

function makePlatform(overrides: Partial<AgentHubPlatform> = {}): AgentHubPlatform {
  return {
    surface: 'web',
    capabilities: { localEdge: false, localFiles: false, browserPreview: false },
    conversations: { list: async () => [] },
    runs: {
      submitComposerIntent: async () => ({ intentId: 'mock-intent' }),
    },
    ...overrides,
  };
}

/**
 * Stable default platform. The hook's discovery/import effects key on
 * `platform` identity, so a fresh object per render would re-run those
 * effects (and their state resets) forever.
 */
const DEFAULT_WEB_PLATFORM: AgentHubPlatform = makePlatform();

/** Flush promise chains scheduled by host-port effects. */
async function flushAsyncWork(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

function renderSessionChrome(initialProps: Partial<UseWorkbenchSessionChromeOptions> = {}) {
  const openInspector = vi.fn();
  const showWorkbenchToast = vi.fn();
  const copyText = vi.fn();
  const resetSelection = vi.fn();
  const onActiveConversationChange = vi.fn();

  const rendered = renderHook(
    (props: Partial<UseWorkbenchSessionChromeOptions>) => useWorkbenchSessionChrome({
      platform: DEFAULT_WEB_PLATFORM,
      conversations: [],
      transcript: [],
      activePage: 'chat',
      isChatPage: true,
      openInspector,
      showWorkbenchToast,
      copyText,
      resetSelection,
      t,
      ...props,
    }),
    { initialProps },
  );

  return {
    ...rendered,
    openInspector,
    showWorkbenchToast,
    copyText,
    resetSelection,
    onActiveConversationChange,
  };
}

describe('useWorkbenchSessionChrome', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    window.localStorage.clear();
  });

  it('exposes default session chrome state for an empty shell', () => {
    const { result } = renderSessionChrome();

    expect(result.current.settingsService).toBeNull();
    expect(result.current.currentConversationId).toBe('default');
    expect(result.current.activeConversation).toBeUndefined();
    expect(result.current.selectedExecutionTargetId).toBe('');
    expect(result.current.dismissedPinnedIds).toEqual(new Set());
    expect(result.current.localCliDiscovery).toBeNull();
    expect(result.current.sessionImportItems).toEqual([]);
    expect(result.current.sessionImportLoading).toBe(false);
    expect(result.current.sessionImportError).toBeNull();
    expect(result.current.sessionImportVisible).toBe(false);
    expect(result.current.reviewFileRequest).toBeNull();
    expect(result.current.searchOpen).toBe(false);
    expect(result.current.searchHighlightId).toBeNull();
    expect(result.current.composer).toMatchObject({
      conversationId: 'default',
      text: '',
      mode: 'ask',
      mentions: [],
      attachments: [],
    });
    expect(result.current.evidence).toEqual([]);
    expect(result.current.mainchainSummary.exportEnabled).toBe(false);
    expect(result.current.mainchainSummary.exportLabel).toBe('mainchain.waitingEvidence');
    expect(result.current.mainchainSummary.nodes).toHaveLength(9);
    expect(result.current.inspectorRouteBlocks).toEqual([]);
    expect(result.current.inspectorContextBlocks).toEqual([]);
    expect(result.current.inspectorDeployPreviewUrl).toBeUndefined();
    expect(result.current.inspectorRunResult).toBeUndefined();
    expect(result.current.mentionableAgents).toEqual([]);

    expect(typeof result.current.selectConversation).toBe('function');
    expect(typeof result.current.setSelectedExecutionTargetId).toBe('function');
    expect(typeof result.current.setDismissedPinnedIds).toBe('function');
    expect(typeof result.current.refreshSessionImport).toBe('function');
    expect(typeof result.current.setSearchOpen).toBe('function');
    expect(typeof result.current.setSearchHighlightId).toBe('function');
    expect(typeof result.current.dispatchComposer).toBe('function');
    expect(typeof result.current.handleToggleTheme).toBe('function');
    expect(typeof result.current.openReviewFile).toBe('function');
    expect(typeof result.current.handleDeploySubmit).toBe('function');
    expect(typeof result.current.exportMainchainEvidence).toBe('function');
  });

  it('resolves the first conversation as the fallback session', () => {
    const conversations = [conversation({ id: 'a', title: 'A' }), conversation({ id: 'b', title: 'B' })];
    const { result } = renderSessionChrome({ conversations });

    expect(result.current.currentConversationId).toBe('a');
    expect(result.current.activeConversation).toMatchObject({ id: 'a', title: 'A' });
    expect(result.current.composer.conversationId).toBe('a');
  });

  it('prefers a valid controlled activeConversationId', () => {
    const conversations = [conversation({ id: 'a', title: 'A' }), conversation({ id: 'b', title: 'B' })];
    const { result } = renderSessionChrome({ conversations, activeConversationId: 'b' });

    expect(result.current.currentConversationId).toBe('b');
    expect(result.current.activeConversation?.title).toBe('B');
  });

  it('falls back when the controlled activeConversationId is stale', () => {
    const conversations = [conversation({ id: 'a', title: 'A' })];
    const { result } = renderSessionChrome({ conversations, activeConversationId: 'missing' });
    expect(result.current.currentConversationId).toBe('a');

    const empty = renderSessionChrome({ conversations: [], activeConversationId: 'missing' });
    expect(empty.result.current.currentConversationId).toBe('default');
    expect(empty.result.current.activeConversation).toBeUndefined();
  });

  it('selectConversation updates the session, resets selection, and notifies the shell', () => {
    const conversations = [conversation({ id: 'a', title: 'A' }), conversation({ id: 'b', title: 'B' })];
    const onConversationChange = vi.fn();
    const { result, resetSelection } = renderSessionChrome({
      conversations,
      onActiveConversationChange: onConversationChange,
    });

    act(() => {
      result.current.selectConversation('b');
    });

    expect(result.current.currentConversationId).toBe('b');
    expect(result.current.activeConversation?.id).toBe('b');
    expect(resetSelection).toHaveBeenCalledTimes(1);
    expect(onConversationChange).toHaveBeenCalledWith('b');
  });

  it('dispatches composer actions against the current conversation', () => {
    const { result } = renderSessionChrome();

    act(() => {
      result.current.dispatchComposer({ type: 'setText', text: 'hello agent' });
      result.current.dispatchComposer({ type: 'setMode', mode: 'code' });
      result.current.dispatchComposer({
        type: 'addMention',
        mention: { id: 'agent-1', label: 'Coder', dispatchRole: 'dispatch' },
      });
    });

    expect(result.current.composer).toMatchObject({
      conversationId: 'default',
      text: 'hello agent',
      mode: 'code',
      mentions: [{ id: 'agent-1', label: 'Coder' }],
    });
  });

  it('saves a draft before resetting the composer on conversation switch', () => {
    const conversations = [conversation({ id: 'a', title: 'A' }), conversation({ id: 'b', title: 'B' })];
    const { result } = renderSessionChrome({ conversations });

    act(() => {
      result.current.dispatchComposer({ type: 'setText', text: 'draft text' });
    });
    act(() => {
      result.current.selectConversation('b');
    });

    expect(result.current.composer.conversationId).toBe('b');
    expect(result.current.composer.text).toBe('');
    expect(window.localStorage.getItem('agenthub.composer.draft.a')).toBe(
      JSON.stringify({ text: 'draft text', mentions: [] }),
    );
  });

  it('maps runtime agents into composer mentions', () => {
    const agents: WorkbenchAgent[] = [
      {
        id: 'builder',
        name: 'Builder',
        description: '代码实现',
        status: 'available',
        model: 'glm',
      },
      { id: 'sparse', name: 'Sparse' },
    ];
    const { result } = renderSessionChrome({ agents });

    expect(result.current.mentionableAgents).toEqual([
      {
        id: 'builder',
        label: 'Builder',
        description: '代码实现',
        status: 'available',
        model: 'glm',
        dispatchRole: 'dispatch',
      },
      { id: 'sparse', label: 'Sparse', dispatchRole: 'dispatch' },
    ]);
  });

  it('collects transcript evidence into the mainchain summary', () => {
    const evidenceBlock: TranscriptBlock = {
      id: 'approval-1',
      kind: 'approval',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: '允许写入',
      status: 'completed',
      evidenceRefs: [{ id: 'ev-1', kind: 'approval', label: 'Allow bash' }],
    };
    const transcript = [runSessionBlock('run-1'), evidenceBlock];
    const { result } = renderSessionChrome({ transcript });

    expect(result.current.evidence).toEqual([
      { id: 'ev-1', kind: 'approval', label: 'Allow bash' },
    ]);
    expect(result.current.mainchainSummary.exportEnabled).toBe(true);
    expect(result.current.mainchainSummary.exportLabel).toBe('mainchain.exportJson');

    const nodes = result.current.mainchainSummary.nodes;
    expect(nodes.find((node) => node.id === 'hub-task')).toMatchObject({
      detail: 'task-1',
      state: 'done',
    });
    expect(nodes.find((node) => node.id === 'replay')).toMatchObject({
      detail: '2 transcript blocks',
      state: 'done',
    });
    // Approval evidence makes the evidence path active.
    expect(nodes.find((node) => node.id === 'evidence-path')?.state).toBe('active');
  });

  it('projects inspector route/context/preview/result views from the transcript', () => {
    const transcript = [
      routeDecisionBlock('route-1'),
      contextUsageBlock('ctx-1'),
      previewBlock('pv-old', 'http://127.0.0.1/old'),
      resultBlock('result-1'),
      previewBlock('pv-new', 'http://127.0.0.1/new'),
    ];
    const { result } = renderSessionChrome({ transcript });

    expect(result.current.inspectorRouteBlocks.map((block) => block.id)).toEqual(['route-1']);
    expect(result.current.inspectorContextBlocks.map((block) => block.id)).toEqual(['ctx-1']);
    // The last preview block wins.
    expect(result.current.inspectorDeployPreviewUrl).toBe('http://127.0.0.1/new');
    expect(result.current.inspectorRunResult).toEqual({
      success: true,
      summary: '任务完成',
      duration: '8m12s',
    });
  });

  it('clears the selected execution target when it disappears from the list', () => {
    const { result, rerender } = renderSessionChrome({
      composerExecutionTargets: [{ id: 't1', label: 'Target 1' }],
    });

    act(() => {
      result.current.setSelectedExecutionTargetId('t1');
    });
    expect(result.current.selectedExecutionTargetId).toBe('t1');
    expect(result.current.mainchainSummary.nodes.find((node) => node.id === 'target'))
      .toMatchObject({ detail: 'Target 1', state: 'done' });

    rerender({ composerExecutionTargets: [{ id: 't2', label: 'Target 2' }] });
    expect(result.current.selectedExecutionTargetId).toBe('');
  });

  it('auto-selects the first healthy execution target by default (#1819)', () => {
    const { result } = renderSessionChrome({
      composerExecutionTargets: [
        { id: 't1', label: 'Target 1', healthy: true },
        { id: 't2', label: 'Target 2', healthy: true },
      ],
    });

    expect(result.current.selectedExecutionTargetId).toBe('t1');
  });

  it('skips explicitly unhealthy targets when auto-selecting (#1819)', () => {
    const { result } = renderSessionChrome({
      composerExecutionTargets: [
        { id: 'down', label: 'Down', healthy: false },
        { id: 'up', label: 'Up', healthy: true },
      ],
    });

    expect(result.current.selectedExecutionTargetId).toBe('up');
  });

  it('leaves the target unselected when every candidate is unhealthy (#1819)', () => {
    const { result } = renderSessionChrome({
      composerExecutionTargets: [
        { id: 'a', label: 'A', healthy: false },
        { id: 'b', label: 'B', healthy: false },
      ],
    });

    expect(result.current.selectedExecutionTargetId).toBe('');
  });

  it('does not override an explicit user selection with the default (#1819)', () => {
    const { result, rerender } = renderSessionChrome({
      composerExecutionTargets: [{ id: 't1', label: 'Target 1', healthy: true }],
    });

    act(() => {
      result.current.setSelectedExecutionTargetId('');
    });
    // User cleared it — the default must not re-select behind their back.
    expect(result.current.selectedExecutionTargetId).toBe('');

    rerender({ composerExecutionTargets: [{ id: 't2', label: 'Target 2', healthy: true }] });
    expect(result.current.selectedExecutionTargetId).toBe('');
  });

  it('replaces an auto-selected target when it turns unhealthy (#1856)', () => {
    const { result, rerender } = renderSessionChrome({
      composerExecutionTargets: [
        { id: 't1', label: 'Target 1', healthy: true },
        { id: 't2', label: 'Target 2', healthy: true },
      ],
    });

    expect(result.current.selectedExecutionTargetId).toBe('t1');

    rerender({
      composerExecutionTargets: [
        { id: 't1', label: 'Target 1', healthy: false },
        { id: 't2', label: 'Target 2', healthy: true },
      ],
    });
    expect(result.current.selectedExecutionTargetId).toBe('t2');
  });

  it('keeps an explicitly selected target even when it turns unhealthy (#1856)', () => {
    const { result, rerender } = renderSessionChrome({
      composerExecutionTargets: [{ id: 't1', label: 'Target 1', healthy: true }],
    });

    act(() => {
      result.current.setSelectedExecutionTargetId('t1');
    });

    rerender({
      composerExecutionTargets: [
        { id: 't1', label: 'Target 1', healthy: false },
        { id: 't2', label: 'Target 2', healthy: true },
      ],
    });
    expect(result.current.selectedExecutionTargetId).toBe('t1');
  });

  it('loads local CLI discovery on desktop settings and clears it elsewhere', async () => {
    const discovery: LocalCliDiscoveryManifest = {
      mode: 'no-spend-discovery',
      readinessManifest: '.tmp/evidence/manifest.json',
      readinessScript: 'scripts/verify.py',
      generatedAt: '2026-08-19T00:00:00.000Z',
      items: [
        { id: 'codex', name: 'Codex CLI', installed: true, version: '1.2.3', path: '/usr/bin/codex', noSpend: true },
      ],
    };
    const listDiscovery = vi.fn().mockResolvedValue(discovery);
    const platform = makePlatform({
      surface: 'desktop',
      host: { localCliDiscovery: listDiscovery },
    });
    const { result, rerender } = renderSessionChrome({ platform, activePage: 'settings' });

    // Optimistic fallback appears before the host resolves.
    expect(result.current.localCliDiscovery).toBe(LOCAL_CLI_DISCOVERY_FALLBACK);
    await flushAsyncWork();
    expect(result.current.localCliDiscovery).toBe(discovery);
    expect(listDiscovery).toHaveBeenCalledTimes(1);

    rerender({ platform, activePage: 'chat' });
    expect(result.current.localCliDiscovery).toBeNull();
  });

  it('keeps the local CLI fallback when discovery rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const platform = makePlatform({
      surface: 'desktop',
      host: { localCliDiscovery: vi.fn().mockRejectedValue(new Error('host down')) },
    });
    const { result } = renderSessionChrome({ platform, activePage: 'settings' });

    await flushAsyncWork();
    expect(result.current.localCliDiscovery).toBe(LOCAL_CLI_DISCOVERY_FALLBACK);
    errorSpy.mockRestore();
  });

  it('loads runtime session import only for desktop localEdge settings', async () => {
    const items: RuntimeSessionSummary[] = [
      { runtime: 'codex', id: 's1', title: 'Session 1' },
    ];
    const listRuntimeSessions = vi.fn().mockResolvedValue(items);
    const platform = makePlatform({
      surface: 'desktop',
      capabilities: { localEdge: true, localFiles: false, browserPreview: false },
      host: { listRuntimeSessions },
    });
    const { result } = renderSessionChrome({ platform, activePage: 'settings' });

    expect(result.current.sessionImportVisible).toBe(true);
    expect(result.current.sessionImportLoading).toBe(true);
    await flushAsyncWork();
    expect(result.current.sessionImportItems).toEqual(items);
    expect(result.current.sessionImportLoading).toBe(false);
    expect(result.current.sessionImportError).toBeNull();

    // A web surface without localEdge stays inert.
    const web = renderSessionChrome({ activePage: 'settings' });
    expect(web.result.current.sessionImportVisible).toBe(false);
    expect(web.result.current.sessionImportItems).toEqual([]);
    expect(web.result.current.sessionImportLoading).toBe(false);
  });

  it('surfaces session import errors and refreshes the list', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listRuntimeSessions = vi.fn()
      .mockRejectedValueOnce(new Error('edge offline'))
      .mockResolvedValueOnce([{ runtime: 'codex', id: 's9', title: 'Recovered' }]);
    const platform = makePlatform({
      surface: 'desktop',
      capabilities: { localEdge: true, localFiles: false, browserPreview: false },
      host: { listRuntimeSessions },
    });
    const { result } = renderSessionChrome({ platform, activePage: 'settings' });

    await flushAsyncWork();
    expect(result.current.sessionImportError).toBe('edge offline');
    expect(result.current.sessionImportItems).toEqual([]);
    expect(result.current.sessionImportLoading).toBe(false);

    act(() => {
      result.current.refreshSessionImport();
    });
    await flushAsyncWork();
    expect(listRuntimeSessions).toHaveBeenCalledTimes(2);
    expect(result.current.sessionImportError).toBeNull();
    expect(result.current.sessionImportItems).toEqual([
      { runtime: 'codex', id: 's9', title: 'Recovered' },
    ]);
    errorSpy.mockRestore();
  });

  it('opens search with Ctrl/Cmd+F only while on the chat page', () => {
    const { result, rerender } = renderSessionChrome({ isChatPage: false });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    });
    expect(result.current.searchOpen).toBe(false);

    rerender({ isChatPage: true });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    });
    expect(result.current.searchOpen).toBe(true);

    act(() => {
      result.current.setSearchOpen(false);
    });
    expect(result.current.searchOpen).toBe(false);

    act(() => {
      result.current.setSearchHighlightId('b1');
    });
    expect(result.current.searchHighlightId).toBe('b1');
  });

  it('creates the settings service from the platform port with mock defaults', () => {
    const readSettings = vi.fn().mockResolvedValue({});
    const writeSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderSessionChrome({
      platform: makePlatform({ settings: { readSettings, writeSettings } }),
    });

    expect(result.current.settingsService).not.toBeNull();
    expect(result.current.settingsService?.initialized).toBe(false);
    expect(result.current.settingsService?.readAll().theme).toBe(WORKBENCH_MOCK_SETTINGS_DEFAULTS.theme);
    expect(result.current.settingsService?.readAll().inspectorVisible).toBe(
      WORKBENCH_MOCK_SETTINGS_DEFAULTS.inspectorVisible,
    );
  });

  it('asks the layout to collapse the inspector when inspectorVisible is false', async () => {
    const collapseListener = vi.fn();
    window.addEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, collapseListener);
    const readSettings = vi.fn().mockResolvedValue({ inspectorVisible: 'false' });
    const writeSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderSessionChrome({
      platform: makePlatform({ settings: { readSettings, writeSettings } }),
    });

    expect(collapseListener).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.settingsService!.init();
    });
    expect(result.current.settingsService?.initialized).toBe(true);
    expect(result.current.settingsService?.readAll().inspectorVisible).toBe(false);
    expect(collapseListener).toHaveBeenCalledTimes(1);
    // #2154 P2-6: the payload tells the layout which direction was requested.
    expect((collapseListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ collapse: true });
    window.removeEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, collapseListener);
  });

  it('asks the layout to expand again when inspectorVisible is true (#2154 P2-6)', async () => {
    const collapseListener = vi.fn();
    window.addEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, collapseListener);
    const readSettings = vi.fn().mockResolvedValue({ inspectorVisible: 'true' });
    const writeSettings = vi.fn().mockResolvedValue(undefined);
    const { result } = renderSessionChrome({
      platform: makePlatform({ settings: { readSettings, writeSettings } }),
    });

    expect(collapseListener).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.settingsService!.init();
    });
    expect(result.current.settingsService?.readAll().inspectorVisible).toBe(true);
    // The switch is symmetric now: turning it on dispatches an expand intent.
    // Whether that expands is the layout hook's call — it only undoes a
    // collapse the setting itself caused, so a manual collapse still wins.
    expect(collapseListener).toHaveBeenCalledTimes(1);
    expect((collapseListener.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({ collapse: false });
    window.removeEventListener(INSPECTOR_DEFAULT_COLLAPSE_EVENT, collapseListener);
  });

  it('toggles the applied theme via handleToggleTheme', () => {
    const { result } = renderSessionChrome();
    expect(document.documentElement.getAttribute('data-theme')).toBeNull();

    act(() => {
      result.current.handleToggleTheme();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem('agenthub-v4-theme')).toBe('dark');

    act(() => {
      result.current.handleToggleTheme();
    });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem('agenthub-v4-theme')).toBe('light');
  });

  it('opens the inspector and emits an exact one-shot focus request for deploy submissions', () => {
    const { result, openInspector, showWorkbenchToast } = renderSessionChrome({
      transcript: [{
        id: 'deploy-focus',
        kind: 'deploy',
        createdAt: '2026-08-24T08:00:00.000Z',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        runId: 'run-1',
        status: 'deployed',
        url: 'https://preview.example/focus',
      }],
    });
    const file = { name: 'README.md', type: 'md', isPrimary: true };

    act(() => {
      result.current.openReviewFile(file);
    });
    expect(openInspector).toHaveBeenCalledTimes(1);
    expect(result.current.reviewFileRequest).toEqual(file);

    act(() => {
      result.current.handleDeploySubmit('deploy-focus');
    });
    expect(openInspector).toHaveBeenCalledTimes(2);
    expect(result.current.inspectorBrowserFocusRequest).toEqual({
      sequence: 1,
      url: 'https://preview.example/focus',
    });

    act(() => {
      result.current.handleDeploySubmit('deploy-focus');
    });
    expect(result.current.inspectorBrowserFocusRequest).toEqual({
      sequence: 2,
      url: 'https://preview.example/focus',
    });
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.deployPreviewOpened');
    // #2154 P2-15: the success copy must not be paired with the warning copy.
    expect(showWorkbenchToast).not.toHaveBeenCalledWith('toast.deployPreviewUnavailable');
  });

  it('warns instead of claiming success when the run has no preview URL (#2154 P2-15)', () => {
    const { result, openInspector, showWorkbenchToast } = renderSessionChrome({
      transcript: [{
        id: 'deploy-no-url',
        kind: 'deploy',
        createdAt: '2026-08-24T08:00:00.000Z',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        runId: 'run-1',
        status: 'deployed',
      }],
    });

    act(() => {
      result.current.handleDeploySubmit('deploy-no-url');
    });

    // No focus request was emitted, so no preview opened.
    expect(result.current.inspectorBrowserFocusRequest).toBeNull();
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.deployPreviewUnavailable');
    expect(showWorkbenchToast).not.toHaveBeenCalledWith('toast.deployPreviewOpened');
    // The inspector still opens so the run's other evidence stays reachable.
    expect(openInspector).toHaveBeenCalledTimes(1);
  });

  it('warns for an unknown deploy block id instead of reporting success (#2154 P2-15)', () => {
    const { result, showWorkbenchToast } = renderSessionChrome({ transcript: [] });

    act(() => {
      result.current.handleDeploySubmit('missing-block');
    });

    expect(result.current.inspectorBrowserFocusRequest).toBeNull();
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.deployPreviewUnavailable');
  });

  it('toasts instead of copying when there is no evidence to export', () => {
    const { result, showWorkbenchToast, copyText } = renderSessionChrome();

    act(() => {
      result.current.exportMainchainEvidence();
    });

    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.noEvidence');
    expect(copyText).not.toHaveBeenCalled();
  });

  it('copies serialized mainchain evidence when export is enabled', () => {
    const { result, showWorkbenchToast, copyText } = renderSessionChrome({
      transcript: [runSessionBlock('run-1')],
      workbenchStatus: { replayLabel: 'replay-9' },
    });

    act(() => {
      result.current.exportMainchainEvidence();
    });

    expect(copyText).toHaveBeenCalledTimes(1);
    const serialized = copyText.mock.calls[0]?.[0];
    expect(typeof serialized).toBe('string');
    const payload = JSON.parse(serialized as string) as Record<string, unknown>;
    expect(payload.surface).toBe('web');
    expect(payload.exportedAt).toEqual(expect.any(String));
    expect(payload.status).toEqual({ replayLabel: 'replay-9' });
    expect(payload.nodes).toEqual(result.current.mainchainSummary.nodes);
    expect(payload.evidence).toEqual([]);
    expect(showWorkbenchToast).toHaveBeenCalledWith('toast.evidenceCopied');
  });
});
