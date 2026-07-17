import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBlock } from '../transcript';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  blockTitle,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  cardActionLabel,
  isNestedInteractiveTarget,
  multiActionLabel,
} from './workbenchTranscriptChromeHelpers';

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

describe('workbenchTranscriptChromeHelpers', () => {
  it('keeps selection hold constants stable', () => {
    expect(SELECTION_HOLD_DELAY_MS).toBe(520);
    expect(SELECTION_HOLD_CANCEL_DISTANCE).toBe(36);
  });

  it('resolves block titles for common kinds', () => {
    expect(blockTitle(textBlock(), t)).toBe('hello world from agent');
    expect(blockTitle(textBlock({ text: '' }), t)).toBe('Agent');
    expect(blockTitle({
      id: 'tool',
      kind: 'tool_call',
      toolName: 'bash',
      status: 'running',
      author: { id: 'agent-1', role: 'agent', name: 'Agent' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }, t)).toBe('bash');
    expect(blockTitle({
      id: 'think',
      kind: 'thinking',
      content: '…',
      author: { id: 'agent-1', role: 'agent', name: 'Agent' },
      createdAt: '2026-01-01T00:00:00.000Z',
    }, t)).toBe('mainchain.thinking');
  });

  it('labels card and multi actions through the same i18n keys', () => {
    expect(cardActionLabel('copy', 'title', t)).toBe('toast.cardCopied');
    expect(cardActionLabel('reply', 'Card A', t)).toBe('context.reply Card A');
    expect(cardActionLabel('unknown', 'x', t)).toBe('toast.actionRecorded');
    expect(multiActionLabel('delete', 3, t)).toBe('toast.multiDelete:3');
    expect(multiActionLabel('other', 2, t)).toBe('toast.multiProcessed:2');
  });

  it('detects nested interactive targets inside a selectable card', () => {
    const card = document.createElement('div');
    card.setAttribute('data-selectable-card', 'true');
    const button = document.createElement('button');
    card.appendChild(button);
    document.body.append(card);

    expect(isNestedInteractiveTarget(button, card)).toBe(true);
    expect(isNestedInteractiveTarget(card, card)).toBe(false);
    expect(isNestedInteractiveTarget(null, card)).toBe(false);

    card.remove();
  });

  it('builds context menu groups with quote/regenerate conditionals', () => {
    const onAction = vi.fn();
    const onEnterSelection = vi.fn();
    const agentText = textBlock({ id: 'agent-text' });
    const userText = textBlock({
      id: 'user-text',
      author: { id: 'user-1', role: 'human', name: 'You' },
    });

    const agentGroups = buildTranscriptContextMenuGroups({
      blockId: 'agent-text',
      transcript: [agentText],
      t,
      onAction,
      onEnterSelection,
    });
    const labels = agentGroups.flat().map((item) => item.label);
    expect(labels).toContain('context.quote');
    expect(labels).toContain('context.regenerate');
    expect(labels).toContain('context.copy');

    agentGroups[0]?.[0]?.onClick?.();
    expect(onAction).toHaveBeenCalledWith('copy', 'agent-text');

    const userGroups = buildTranscriptContextMenuGroups({
      blockId: 'user-text',
      transcript: [userText],
      t,
      onAction,
      onEnterSelection,
    });
    const userLabels = userGroups.flat().map((item) => item.label);
    expect(userLabels).toContain('context.quote');
    expect(userLabels).not.toContain('context.regenerate');

    const multi = userGroups.flat().find((item) => item.label === 'context.multiSelect');
    multi?.onClick?.();
    expect(onEnterSelection).toHaveBeenCalledWith('user-text');
  });

  it('builds multi-select bar actions with stable labels', () => {
    const onSelectAll = vi.fn();
    const onClear = vi.fn();
    const onMultiAction = vi.fn();
    const onExit = vi.fn();
    const actions = buildTranscriptMultiSelectActions({
      t,
      onSelectAll,
      onClear,
      onMultiAction,
      onExit,
    });

    expect(actions.map((action) => action.label)).toEqual([
      'bar.selectAll',
      'bar.clear',
      'context.copy',
      'context.forward',
      'context.addTask',
      'context.exportDoc',
      'context.delete',
      'bar.exit',
    ]);

    actions[0]?.onClick();
    actions[2]?.onClick();
    actions[7]?.onClick();
    expect(onSelectAll).toHaveBeenCalledOnce();
    expect(onMultiAction).toHaveBeenCalledWith('copy');
    expect(onExit).toHaveBeenCalledOnce();
  });
});
