import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
  blockTitle,
  buildContextMenuState,
  buildPermissionApprovalDecision,
  buildQuoteComposerText,
  cardActionLabel,
  cardLinkForBlock,
  isNestedInteractiveTarget,
  multiActionLabel,
  resolveBlockTitleById,
  resolveQuoteText,
  resolveSelectionHotkey,
} from './workbenchTranscriptChromeLabels';

const t = (key: string, options?: Record<string, unknown>) => (
  options?.count !== undefined ? `${key}:${options.count}` : key
);

function textBlock(overrides: Partial<Extract<TranscriptBlock, { kind: 'text' }>> = {}): TranscriptBlock {
  return {
    id: 'b1',
    kind: 'text',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    text: 'hello world from agent',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function permissionBlock(
  overrides: Partial<Extract<TranscriptBlock, { kind: 'permission_request' }>> = {},
): Extract<TranscriptBlock, { kind: 'permission_request' }> {
  return {
    id: 'perm-1',
    kind: 'permission_request',
    requestId: 'req-1',
    title: 'Allow bash?',
    status: 'pending',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('workbenchTranscriptChromeLabels', () => {
  it('keeps chrome timing constants stable', () => {
    expect(SELECTION_HOLD_DELAY_MS).toBe(520);
    expect(SELECTION_HOLD_CANCEL_DISTANCE).toBe(36);
    expect(WORKBENCH_TOAST_MS).toBe(1700);
    expect(WORKBENCH_PULSE_MS).toBe(900);
  });

  it('resolves titles and toast label maps', () => {
    expect(blockTitle(textBlock(), t)).toBe('hello world from agent');
    expect(blockTitle(textBlock({ text: '' }), t)).toBe('Agent');
    expect(resolveBlockTitleById([textBlock({ id: 'x' })], 'missing', t)).toBe('mainchain.selectedCard');
    expect(cardActionLabel('copy', 'title', t)).toBe('toast.cardCopied');
    expect(cardActionLabel('unknown', 'x', t)).toBe('toast.actionRecorded');
    expect(multiActionLabel('delete', 3, t)).toBe('toast.multiDelete:3');
  });

  it('builds an openable session link instead of the dead agenthub:// scheme (#1504)', () => {
    expect(cardLinkForBlock('b9', 'sess-1', 'https://app.example.com'))
      .toBe('https://app.example.com/#/session/sess-1?block=b9');
    // Without a session id (Desktop/demo) fall back to a block-level hash
    // that stays within the app origin.
    expect(cardLinkForBlock('b9', null, 'https://app.example.com'))
      .toBe('https://app.example.com/#/card/b9');
    // Never the dead custom scheme, and the default origin keeps it web-openable.
    const defaultOriginLink = cardLinkForBlock('b9');
    expect(defaultOriginLink).not.toContain('agenthub://');
    expect(defaultOriginLink).toMatch(/^https?:\/\//);
  });

  it('maps hotkeys, quote text, and permission decisions without undefined optionals', () => {
    expect(resolveSelectionHotkey({ key: 'Escape', ctrlKey: false, metaKey: false }))
      .toEqual({ type: 'escape' });
    expect(resolveQuoteText('abcdefghij', null, 4)).toBe('abcd');
    expect(buildQuoteComposerText('line1\nline2')).toBe('> line1\n> line2\n\n');

    const sparse = buildPermissionApprovalDecision(permissionBlock(), 'approve');
    expect(Object.keys(sparse).sort()).toEqual(['approvalId', 'decision']);
    expect(sparse).toEqual({ approvalId: 'req-1', decision: 'allow' });

    const full = buildPermissionApprovalDecision(permissionBlock({
      teamId: 'team-1',
      teamRunId: 'run-1',
    }), 'deny');
    expect(full.teamId).toBe('team-1');
    expect(full.teamRunId).toBe('run-1');
    expect(full.decision).toBe('deny');
  });

  it('carries every defined optional routing field into the approval decision', () => {
    const decision = buildPermissionApprovalDecision(permissionBlock({
      teamId: 'team-1',
      teamRunId: 'run-1',
      agentTaskId: 'task-1',
      targetId: 'target-1',
      edgeDeviceId: 'device-1',
      correlationId: 'corr-1',
    }), 'approve');
    expect(decision).toEqual({
      approvalId: 'req-1',
      decision: 'allow',
      teamId: 'team-1',
      teamRunId: 'run-1',
      agentTaskId: 'task-1',
      targetId: 'target-1',
      edgeDeviceId: 'device-1',
      correlationId: 'corr-1',
    });
  });
});

describe('blockTitle — per-kind fallbacks', () => {
  const author = { id: 'a1', role: 'agent' as const, name: 'Agent' };

  function block<K extends TranscriptBlock['kind']>(
    kind: K,
    overrides: Record<string, unknown>,
  ): TranscriptBlock {
    return { id: 'b', kind, author, createdAt: '2026-01-01T00:00:00.000Z', ...overrides } as TranscriptBlock;
  }

  it('titles tool calls, tool results and file changes from their identifiers', () => {
    expect(blockTitle(block('tool_call', { toolName: 'Shell', status: 'completed' }), t)).toBe('Shell');
    expect(blockTitle(block('tool_result', { toolName: 'Shell', status: 'completed' }), t)).toBe('Shell result');
    expect(blockTitle(block('file_change', { path: 'src/a.ts', action: 'modified' }), t)).toBe('src/a.ts');
  });

  it('titles permission/failure/finished and titled group blocks from their title', () => {
    expect(blockTitle(block('failure', { title: 'Run failed' }), t)).toBe('Run failed');
    expect(blockTitle(block('finished', { title: 'Run finished' }), t)).toBe('Run finished');
    expect(blockTitle(block('diff', { title: 'Diff', files: [] }), t)).toBe('Diff');
    expect(blockTitle(block('run_session', { title: 'Session' }), t)).toBe('Session');
  });

  it('prefers the preview url and falls back to the preview id', () => {
    expect(blockTitle(block('preview', { previewId: 'pv1', status: 'completed', url: 'https://x' }), t)).toBe('https://x');
    expect(blockTitle(block('preview', { previewId: 'pv1', status: 'completed' }), t)).toBe('pv1');
  });

  it('falls back to translated labels for timeline/result/thinking/route/context blocks', () => {
    expect(blockTitle(block('agent_timeline', { items: [] }), t)).toBe('mainchain.timeline');
    expect(blockTitle(block('agent_timeline', { title: 'TL', items: [] }), t)).toBe('TL');
    expect(blockTitle(block('result', { success: true }), t)).toBe('mainchain.result');
    expect(blockTitle(block('result', { success: false }), t)).toBe('mainchain.fail');
    expect(blockTitle(block('result', { success: true, summary: 'done' }), t)).toBe('done');
    expect(blockTitle(block('thinking', {}), t)).toBe('mainchain.thinking');
    expect(blockTitle(block('route_decision', { action: 'route' }), t)).toBe('route');
    expect(blockTitle(block('route_decision', { action: 'route', targetAgent: 'Builder' }), t)).toBe('Builder');
    expect(blockTitle(block('context_usage', { inputTokens: 1, outputTokens: 2 }), t)).toBe('mainchain.contextUsage');
    expect(blockTitle(block('context_usage', { inputTokens: 1, outputTokens: 2, modelLabel: 'gpt' }), t)).toBe('gpt');
  });
});

describe('isNestedInteractiveTarget', () => {
  it('rejects non-element targets and bare text inside the card', () => {
    const card = document.createElement('div');
    const span = document.createElement('span');
    card.appendChild(span);
    expect(isNestedInteractiveTarget(null, card)).toBe(false);
    expect(isNestedInteractiveTarget('text' as unknown as EventTarget, card)).toBe(false);
    expect(isNestedInteractiveTarget(span, card)).toBe(false);
  });

  it('detects nested interactive controls but not the card itself or selectable cards', () => {
    const card = document.createElement('div');
    const button = document.createElement('button');
    card.appendChild(button);
    expect(isNestedInteractiveTarget(button, card)).toBe(true);

    // The card itself being interactive is not a nested target.
    const interactiveCard = document.createElement('button');
    expect(isNestedInteractiveTarget(interactiveCard, interactiveCard)).toBe(false);

    const selectable = document.createElement('a');
    selectable.setAttribute('data-selectable-card', 'true');
    card.appendChild(selectable);
    expect(isNestedInteractiveTarget(selectable, card)).toBe(false);
  });
});

describe('buildContextMenuState', () => {
  it('captures the block id, title and pointer coordinates', () => {
    const state = buildContextMenuState(textBlock({ id: 'ctx-1', text: 'menu target' }), 120, 340, t);
    expect(state).toEqual({ blockId: 'ctx-1', title: 'menu target', x: 120, y: 340 });
  });
});

describe('resolveSelectionHotkey', () => {
  it('maps select-all, copy and delete chords, ignoring plain keys', () => {
    expect(resolveSelectionHotkey({ key: 'a', ctrlKey: true, metaKey: false }))
      .toEqual({ type: 'selectAll', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'A', ctrlKey: false, metaKey: true }))
      .toEqual({ type: 'selectAll', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'c', ctrlKey: true, metaKey: false }))
      .toEqual({ type: 'multiAction', action: 'copy', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'Delete', ctrlKey: false, metaKey: false }))
      .toEqual({ type: 'multiAction', action: 'delete', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'Backspace', ctrlKey: false, metaKey: false }))
      .toEqual({ type: 'multiAction', action: 'delete', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'a', ctrlKey: false, metaKey: false })).toBeNull();
    expect(resolveSelectionHotkey({ key: 'x', ctrlKey: true, metaKey: false })).toBeNull();
  });
});
