import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
  blockTitle,
  buildPermissionApprovalDecision,
  buildQuoteComposerText,
  cardActionLabel,
  cardLinkForBlock,
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
});
