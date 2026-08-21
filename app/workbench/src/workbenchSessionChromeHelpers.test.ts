import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import type { WorkbenchAgent, WorkbenchConversation } from '@shared/platform';
import {
  LOCAL_CLI_DISCOVERY_FALLBACK,
  buildInspectorTranscriptViews,
  buildMainchainEvidenceExportPayload,
  findConversationById,
  isChatSearchShortcut,
  mapAgentsToComposerMentions,
  resolveComposerTargetLabel,
  resolveCurrentConversationId,
  serializeMainchainEvidenceExport,
  shouldClearSelectedExecutionTarget,
  shouldLoadLocalCliDiscovery,
  shouldLoadSessionImport,
} from './workbenchSessionChromeHelpers';

function conversation(id: string): WorkbenchConversation {
  return {
    id,
    title: id,
    kind: 'direct',
  };
}

function textBlock(id: string): TranscriptBlock {
  return {
    id,
    kind: 'text',
    author: { id: 'user', name: 'User', role: 'human' },
    text: 'hello',
  };
}

describe('workbenchSessionChromeHelpers', () => {
  it('exposes local CLI discovery fallback with three no-spend items', () => {
    expect(LOCAL_CLI_DISCOVERY_FALLBACK.mode).toBe('no-spend-discovery');
    expect(LOCAL_CLI_DISCOVERY_FALLBACK.items).toHaveLength(3);
    expect(LOCAL_CLI_DISCOVERY_FALLBACK.items.every((item) => item.noSpend)).toBe(true);
  });

  it('resolves controlled, local, then fallback conversation ids', () => {
    const conversations = [conversation('a'), conversation('b')];

    expect(resolveCurrentConversationId({
      conversations,
      activeConversationId: 'b',
      localConversationId: 'a',
      fallbackConversationId: 'default',
    })).toBe('b');

    expect(resolveCurrentConversationId({
      conversations,
      activeConversationId: 'missing',
      localConversationId: 'a',
      fallbackConversationId: 'default',
    })).toBe('a');

    expect(resolveCurrentConversationId({
      conversations,
      activeConversationId: 'missing',
      localConversationId: 'gone',
      fallbackConversationId: 'default',
    })).toBe('default');
  });

  it('maps agents to composer mentions without undefined optional fields', () => {
    const agents: WorkbenchAgent[] = [
      {
        id: 'agent-1',
        name: 'Coder',
        description: 'writes code',
        status: 'available',
        model: 'gpt',
        provider: 'openai',
        runtimeId: 'codex',
      },
      {
        id: 'agent-2',
        name: 'Sparse',
      },
    ];

    expect(mapAgentsToComposerMentions(agents)).toEqual([
      {
        id: 'agent-1',
        label: 'Coder',
        description: 'writes code',
        status: 'available',
        model: 'gpt',
        provider: 'openai',
        runtimeId: 'codex',
        dispatchRole: 'dispatch',
      },
      {
        id: 'agent-2',
        label: 'Sparse',
        dispatchRole: 'dispatch',
      },
    ]);
    expect(mapAgentsToComposerMentions(undefined)).toEqual([]);
  });

  it('projects inspector route/context/preview/result views from transcript', () => {
    const transcript: TranscriptBlock[] = [
      textBlock('t1'),
      {
        id: 'route-1',
        kind: 'route_decision',
        author: { id: 'router', name: 'Router', role: 'system' },
        action: 'delegate',
        targetAgent: 'coder',
      },
      {
        id: 'ctx-1',
        kind: 'context_usage',
        author: { id: 'ctx', name: 'Ctx', role: 'system' },
        modelLabel: 'gpt',
        inputTokens: 10,
        outputTokens: 4,
      },
      {
        id: 'preview-1',
        kind: 'preview',
        author: { id: 'preview', name: 'Preview', role: 'system' },
        previewId: 'p1',
        status: 'completed',
        url: 'https://example.test/old',
      },
      {
        id: 'preview-2',
        kind: 'preview',
        author: { id: 'preview', name: 'Preview', role: 'system' },
        previewId: 'p2',
        status: 'completed',
        url: 'https://example.test/new',
      },
      {
        id: 'result-1',
        kind: 'result',
        author: { id: 'result', name: 'Result', role: 'system' },
        success: true,
        summary: 'done',
        duration: '12s',
      },
    ];

    const views = buildInspectorTranscriptViews(transcript);
    expect(views.routeBlocks.map((block) => block.id)).toEqual(['route-1']);
    expect(views.contextBlocks.map((block) => block.id)).toEqual(['ctx-1']);
    expect(views.deployPreviewUrl).toBe('https://example.test/new');
    expect(views.runResult).toEqual({ success: true, summary: 'done', duration: '12s' });
  });

  it('prefers finished/failure run result blocks when no result block exists', () => {
    const finished = buildInspectorTranscriptViews([
      {
        id: 'fin',
        kind: 'finished',
        author: { id: 'done', name: 'Done', role: 'system' },
        title: 'Finished title',
        duration: '9s',
      },
    ]);
    expect(finished.runResult).toEqual({
      success: true,
      summary: 'Finished title',
      duration: '9s',
    });

    const failure = buildInspectorTranscriptViews([
      {
        id: 'fail',
        kind: 'failure',
        author: { id: 'fail', name: 'Fail', role: 'system' },
        title: 'Failed title',
        reason: 'boom',
      },
    ]);
    expect(failure.runResult).toEqual({ success: false, summary: 'boom' });
  });

  it('plans execution-target clear only for stale selections', () => {
    const targets = [
      { id: 't1', label: 'One' },
      { id: 't2', label: 'Two' },
    ];
    expect(shouldClearSelectedExecutionTarget(undefined, 't1')).toBe(false);
    expect(shouldClearSelectedExecutionTarget(targets, '')).toBe(false);
    expect(shouldClearSelectedExecutionTarget(targets, 't1')).toBe(false);
    expect(shouldClearSelectedExecutionTarget(targets, 'gone')).toBe(true);
  });

  it('gates local CLI discovery to desktop settings with host port', () => {
    expect(shouldLoadLocalCliDiscovery({
      activePage: 'settings',
      surface: 'desktop',
      hasLocalCliDiscovery: true,
    })).toBe(true);
    expect(shouldLoadLocalCliDiscovery({
      activePage: 'chat',
      surface: 'desktop',
      hasLocalCliDiscovery: true,
    })).toBe(false);
    expect(shouldLoadLocalCliDiscovery({
      activePage: 'settings',
      surface: 'web',
      hasLocalCliDiscovery: true,
    })).toBe(false);
    expect(shouldLoadLocalCliDiscovery({
      activePage: 'settings',
      surface: 'desktop',
      hasLocalCliDiscovery: false,
    })).toBe(false);
  });

  it('loads session import only on desktop settings with localEdge host port', () => {
    expect(shouldLoadSessionImport({
      activePage: 'settings',
      surface: 'desktop',
      localEdge: true,
      hasListRuntimeSessions: true,
    })).toBe(true);
    expect(shouldLoadSessionImport({
      activePage: 'chat',
      surface: 'desktop',
      localEdge: true,
      hasListRuntimeSessions: true,
    })).toBe(false);
    expect(shouldLoadSessionImport({
      activePage: 'settings',
      surface: 'web',
      localEdge: true,
      hasListRuntimeSessions: true,
    })).toBe(false);
    expect(shouldLoadSessionImport({
      activePage: 'settings',
      surface: 'desktop',
      localEdge: false,
      hasListRuntimeSessions: true,
    })).toBe(false);
    expect(shouldLoadSessionImport({
      activePage: 'settings',
      surface: 'desktop',
      localEdge: true,
      hasListRuntimeSessions: false,
    })).toBe(false);
  });

  it('detects chat search shortcut keys', () => {
    expect(isChatSearchShortcut({ key: 'f', ctrlKey: true, metaKey: false })).toBe(true);
    expect(isChatSearchShortcut({ key: 'F', ctrlKey: false, metaKey: true })).toBe(true);
    expect(isChatSearchShortcut({ key: 'f', ctrlKey: false, metaKey: false })).toBe(false);
    expect(isChatSearchShortcut({ key: 'k', ctrlKey: true, metaKey: false })).toBe(false);
  });

  it('builds and serializes mainchain evidence export payload', () => {
    const payload = buildMainchainEvidenceExportPayload({
      exportedAt: '2026-01-01T00:00:00.000Z',
      surface: 'desktop',
      status: { dataMode: 'mock' },
      nodes: [],
      evidence: [],
      runtimeEvidence: null,
    });
    expect(payload).toEqual({
      exportedAt: '2026-01-01T00:00:00.000Z',
      surface: 'desktop',
      status: { dataMode: 'mock' },
      nodes: [],
      evidence: [],
      runtimeEvidence: null,
    });
    expect(serializeMainchainEvidenceExport(payload)).toContain('"surface": "desktop"');
  });

  it('finds conversations and composer target labels', () => {
    const conversations = [conversation('a'), conversation('b')];
    expect(findConversationById(conversations, 'b')?.id).toBe('b');
    expect(findConversationById(conversations, 'missing')).toBeUndefined();

    const targets = [
      { id: 't1', label: 'One' },
      { id: 't2', label: 'Two' },
    ];
    expect(resolveComposerTargetLabel(targets, 't2')).toBe('Two');
    expect(resolveComposerTargetLabel(targets, 'gone')).toBeUndefined();
    expect(resolveComposerTargetLabel(undefined, 't1')).toBeUndefined();
  });
});
