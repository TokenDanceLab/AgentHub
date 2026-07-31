import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBlock } from '../transcript';
import {
  applyTranscriptChromeSideEffects,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  createTranscriptChromeEffectHandlers,
  planContextAction,
  planMultiAction,
  planTranscriptBlockAction,
} from './workbenchTranscriptChromeActionMappers';

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

describe('workbenchTranscriptChromeActionMappers', () => {
  it('plans context and multi actions with stable toast labels', () => {
    const transcript = [textBlock({ id: 'b1', text: 'Alpha title here' })];
    const copy = planContextAction({ action: 'copy', blockId: 'b1', transcript, t });
    expect(copy.some((effect) => effect.type === 'copy')).toBe(true);
    expect(copy.some((effect) => effect.type === 'toast')).toBe(true);

    const multiEmpty = planMultiAction({ action: 'copy', selectedBlockIds: [], transcript, t });
    expect(multiEmpty).toEqual([{ type: 'toast', message: 'toast.noCardSelected' }]);

    const multiDelete = planMultiAction({
      action: 'delete',
      selectedBlockIds: ['b1'],
      transcript,
      t,
    });
    expect(multiDelete.some((effect) => effect.type === 'softHide')).toBe(true);
    expect(multiDelete.some((effect) => effect.type === 'exitSelection')).toBe(true);
  });

  it('plans permission and regenerate block actions', () => {
    const transcript = [permissionBlock(), textBlock({ id: 'agent' })];
    const approve = planTranscriptBlockAction({
      action: 'approve',
      blockId: 'perm-1',
      transcript,
      t,
    });
    expect(approve.some((effect) => effect.type === 'approval')).toBe(true);

    const regenerate = planTranscriptBlockAction({
      action: 'regenerate',
      blockId: 'agent',
      transcript,
      t,
    });
    expect(regenerate.some((effect) => effect.type === 'regenerate')).toBe(true);
  });

  it('builds menu/multi view models and applies side effects', () => {
    const onAction = vi.fn();
    const onEnterSelection = vi.fn();
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection,
    });
    expect(groups.flat().map((item) => item.label)).toContain('context.quote');
    groups[0]?.[0]?.onClick?.();
    expect(onAction).toHaveBeenCalledWith('copy', 'b1');

    const multi = buildTranscriptMultiSelectActions({
      t,
      onSelectAll: vi.fn(),
      onClear: vi.fn(),
      onMultiAction: vi.fn(),
      onExit: vi.fn(),
    });
    expect(multi.map((item) => item.label)).toContain('bar.exit');

    const handlers = {
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    };
    applyTranscriptChromeSideEffects([
      { type: 'copy', text: 'x' },
      { type: 'toast', message: 'y' },
      { type: 'exitSelection' },
    ], handlers);
    expect(handlers.copyText).toHaveBeenCalledWith('x');
    expect(handlers.showWorkbenchToast).toHaveBeenCalledWith('y');
    expect(handlers.exitSelection).toHaveBeenCalledOnce();
  });

  it('plans an edit action that backfills the composer and marks the message editing', () => {
    const transcript = [
      textBlock({ id: 'user-1', text: '请帮我重构', author: { id: 'u', role: 'human', name: 'You' } }),
    ];
    const effects = planContextAction({ action: 'edit', blockId: 'user-1', transcript, t });
    const composer = effects.find((e) => e.type === 'composer');
    expect(composer).toBeDefined();
    if (composer && composer.type === 'composer') {
      expect(composer.actions).toEqual([
        { type: 'setText', text: '请帮我重构' },
        { type: 'setEditingMessage', messageId: 'user-1' },
      ]);
      expect(composer.focusComposer).toBe(true);
    }
  });

  it('offers an edit menu item for user text blocks but not for agent text blocks', () => {
    const userBlock = textBlock({ id: 'u', author: { id: 'u', role: 'human', name: 'You' } });
    const agentBlock = textBlock({ id: 'a' });
    const userMenu = buildTranscriptContextMenuGroups({
      blockId: 'u',
      transcript: [userBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
    });
    expect(userMenu.flat().map((i) => i.label)).toContain('context.edit');

    const agentMenu = buildTranscriptContextMenuGroups({
      blockId: 'a',
      transcript: [agentBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
    });
    expect(agentMenu.flat().map((i) => i.label)).not.toContain('context.edit');
  });

  it('plans Hub REST message actions (pin/unpin/recall/react) when a session id is available', () => {
    const transcript = [textBlock({ id: 'b1' })];

    const pin = planContextAction({ action: 'pin', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(pin).toContainEqual({ type: 'pin', messageId: 'b1', sessionId: 'sess-1' });
    expect(pin.some((e) => e.type === 'toast')).toBe(true);
    expect(pin.some((e) => e.type === 'pulse')).toBe(true);

    const unpin = planContextAction({ action: 'unpin', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(unpin).toContainEqual({ type: 'unpin', messageId: 'b1', sessionId: 'sess-1' });

    const recall = planContextAction({ action: 'recall', blockId: 'b1', transcript, t });
    expect(recall).toContainEqual({ type: 'recall', messageId: 'b1' });

    const react = planContextAction({ action: 'react', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(react).toContainEqual({ type: 'react', messageId: 'b1', sessionId: 'sess-1', emoji: '👍' });
  });

  it('keeps the placeholder toast for pin/react without a session id (Desktop/demo)', () => {
    const transcript = [textBlock({ id: 'b1' })];
    const pin = planContextAction({ action: 'pin', blockId: 'b1', transcript, t });
    expect(pin.some((e) => e.type === 'pin')).toBe(false);
    expect(pin.some((e) => e.type === 'pulse')).toBe(true);
    expect(pin.some((e) => e.type === 'toast')).toBe(true);
  });

  it('keeps the forward placeholder toast until a target-conversation picker exists', () => {
    const transcript = [textBlock({ id: 'b1' })];
    const forward = planContextAction({ action: 'forward', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(forward.some((e) => e.type === 'forward')).toBe(false);
    expect(forward.some((e) => e.type === 'toast')).toBe(true);
    expect(forward.find((e) => e.type === 'toast')?.message).toBe('toast.forwardSelectTarget');
  });

  it('applies Hub REST side effects through the optional effect handlers', () => {
    const handlers = createTranscriptChromeEffectHandlers({
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
      onPinMessage: vi.fn(),
      onUnpinMessage: vi.fn(),
      onForwardMessage: vi.fn(),
      onRecallMessage: vi.fn(),
      onAddMessageReaction: vi.fn(),
    });
    applyTranscriptChromeSideEffects([
      { type: 'pin', messageId: 'm1', sessionId: 's1' },
      { type: 'unpin', messageId: 'm2', sessionId: 's2' },
      { type: 'forward', messageId: 'm3', targetSessionIds: ['s9'] },
      { type: 'recall', messageId: 'm4' },
      { type: 'react', messageId: 'm5', sessionId: 's5', emoji: '🔥' },
    ], handlers);
    expect(handlers.onPinMessage).toHaveBeenCalledWith('m1', 's1');
    expect(handlers.onUnpinMessage).toHaveBeenCalledWith('m2', 's2');
    expect(handlers.onForwardMessage).toHaveBeenCalledWith('m3', ['s9']);
    expect(handlers.onRecallMessage).toHaveBeenCalledWith('m4');
    expect(handlers.onAddMessageReaction).toHaveBeenCalledWith('m5', 's5', '🔥');
  });

  it('is a no-op for Hub REST side effects when handlers are not wired', () => {
    const handlers = createTranscriptChromeEffectHandlers({
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    });
    expect(() => applyTranscriptChromeSideEffects([
      { type: 'pin', messageId: 'm1', sessionId: 's1' },
      { type: 'recall', messageId: 'm2' },
    ], handlers)).not.toThrow();
    expect(handlers.showWorkbenchToast).not.toHaveBeenCalled();
  });
});
