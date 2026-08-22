import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { fireEvent, render } from '@testing-library/react';
import type { TranscriptBlock } from '@shared/transcript';
import {
  applyTranscriptChromeSideEffects,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  createTranscriptChromeEffectHandlers,
  forwardActionForTargets,
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

  it('copies the full text of text blocks instead of the truncated title', () => {
    const longText = 'a'.repeat(60);
    const transcript = [textBlock({ id: 'b1', text: longText })];
    const copy = planContextAction({ action: 'copy', blockId: 'b1', transcript, t });
    expect(copy).toContainEqual({ type: 'copy', text: longText });
    expect(copy.some((effect) => effect.type === 'toast')).toBe(true);

    // Non-text blocks keep the short blockTitle copy.
    const permTranscript = [permissionBlock({ id: 'perm-1', title: 'Allow bash?' })];
    const permCopy = planContextAction({ action: 'copy', blockId: 'perm-1', transcript: permTranscript, t });
    expect(permCopy).toContainEqual({ type: 'copy', text: 'Allow bash?' });
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

  it('awaits approval decisions before success and reports failures (#1821)', async () => {
    const baseHandlers = {
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    };

    // Resolve-controlled decision: no toast before the request settles.
    let resolveDecision: (() => void) | undefined;
    const slowDecision = vi.fn(() => new Promise<void>((resolve) => {
      resolveDecision = () => resolve();
    }));
    applyTranscriptChromeSideEffects([
      {
        type: 'approval',
        decision: { approvalId: 'req-1', decision: 'allow' },
        successMessage: 'approved-ok',
        failureMessage: 'approval-failed',
      },
    ], {
      ...baseHandlers,
      onApprovalDecision: slowDecision,
    });
    expect(slowDecision).toHaveBeenCalledWith({ approvalId: 'req-1', decision: 'allow' });
    expect(baseHandlers.showWorkbenchToast).not.toHaveBeenCalled();
    resolveDecision?.();
    await vi.waitFor(() => {
      expect(baseHandlers.showWorkbenchToast).toHaveBeenCalledWith('approved-ok');
    });

    // Rejecting decision: the failure message (or the error text) is shown.
    const rejectingDecision = vi.fn().mockRejectedValue(new Error('network down'));
    applyTranscriptChromeSideEffects([
      {
        type: 'approval',
        decision: { approvalId: 'req-2', decision: 'deny' },
        successMessage: 'denied-ok',
        failureMessage: 'approval-failed',
      },
    ], {
      ...baseHandlers,
      onApprovalDecision: rejectingDecision,
    });
    await vi.waitFor(() => {
      expect(baseHandlers.showWorkbenchToast).toHaveBeenCalledWith('network down');
    });
  });

  it('copies an openable http(s) link instead of the dead agenthub:// scheme (#1504)', () => {
    const transcript = [textBlock({ id: 'b1' })];

    const effects = planContextAction({
      action: 'link',
      blockId: 'b1',
      transcript,
      t,
      sessionId: 'sess-1',
    });
    const copyEffect = effects.find((effect) => effect.type === 'copy');
    expect(copyEffect?.type).toBe('copy');
    if (copyEffect?.type === 'copy') {
      expect(copyEffect.text).toMatch(/^https?:\/\//);
      expect(copyEffect.text).not.toContain('agenthub://');
      expect(copyEffect.text).toContain('#/session/sess-1?block=b1');
    }

    // The clipboard write goes through the copy effect handler.
    const copyText = vi.fn();
    applyTranscriptChromeSideEffects(effects, {
      copyText,
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    });
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith(expect.stringMatching(/^https?:\/\//));
    expect(copyText.mock.calls[0]?.[0]).not.toContain('agenthub://');
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

  it('offers a recall menu item for user messages but not for agent messages', () => {
    const userBlock = textBlock({ id: 'u', author: { id: 'u', role: 'human', name: 'You' } });
    const agentBlock = textBlock({ id: 'a' });

    const onAction = vi.fn();
    const userMenu = buildTranscriptContextMenuGroups({
      blockId: 'u',
      transcript: [userBlock],
      t,
      onAction,
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    const recallItem = userMenu.flat().find((i) => i.label === 'context.recall');
    expect(recallItem).toBeDefined();
    expect(recallItem?.danger).toBe(true);
    recallItem?.onClick?.();
    expect(onAction).toHaveBeenCalledWith('recall', 'u');

    const agentMenu = buildTranscriptContextMenuGroups({
      blockId: 'a',
      transcript: [agentBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    expect(agentMenu.flat().map((i) => i.label)).not.toContain('context.recall');
  });

  it('omits recall/pin/react menu entries without Hub message actions (#1818)', () => {
    const userBlock = textBlock({ id: 'u', author: { id: 'u', role: 'human', name: 'You' } });
    const menu = buildTranscriptContextMenuGroups({
      blockId: 'u',
      transcript: [userBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
    });
    const labels = menu.flat().map((i) => i.label);
    expect(labels).not.toContain('context.recall');
    expect(labels).not.toContain('context.pinMessage');
    expect(labels).not.toContain('context.react');
  });

  it('toggles the pin menu item between pin and unpin off block.pinned (#1449)', () => {
    const userBlock = textBlock({ id: 'u', author: { id: 'u', role: 'human', name: 'You' } });
    const agentBlock = textBlock({ id: 'a' });
    const pinnedBlock = textBlock({ id: 'p', pinned: true });

    // Unpinned blocks keep the pin item and the pin action.
    const userMenu = buildTranscriptContextMenuGroups({
      blockId: 'u',
      transcript: [userBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    expect(userMenu.flat().map((i) => i.label)).toContain('context.pinMessage');
    const agentMenu = buildTranscriptContextMenuGroups({
      blockId: 'a',
      transcript: [agentBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    expect(agentMenu.flat().map((i) => i.label)).toContain('context.pinMessage');
    const pinOnAction = vi.fn();
    const pinCapture = buildTranscriptContextMenuGroups({
      blockId: 'u',
      transcript: [userBlock],
      t,
      onAction: pinOnAction,
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    pinCapture.flat().find((i) => i.label === 'context.pinMessage')?.onClick?.();
    expect(pinOnAction).toHaveBeenCalledWith('pin', 'u');

    // Pinned blocks switch the entry to the unpin action.
    const pinnedMenu = buildTranscriptContextMenuGroups({
      blockId: 'p',
      transcript: [pinnedBlock],
      t,
      onAction: vi.fn(),
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    const labels = pinnedMenu.flat().map((i) => i.label);
    expect(labels).toContain('context.unpin');
    expect(labels).not.toContain('context.pinMessage');
    const unpinOnAction = vi.fn();
    const unpinCapture = buildTranscriptContextMenuGroups({
      blockId: 'p',
      transcript: [pinnedBlock],
      t,
      onAction: unpinOnAction,
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    unpinCapture.flat().find((i) => i.label === 'context.unpin')?.onClick?.();
    expect(unpinOnAction).toHaveBeenCalledWith('unpin', 'p');
  });

  it('plans Hub REST message actions (pin/unpin/recall/react) when a session id is available', () => {
    const transcript = [textBlock({ id: 'b1' })];

    // #1821: the success toast rides the effect itself — it fires only after
    // the REST call resolves, and a rejection shows the failure message.
    const pin = planContextAction({ action: 'pin', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(pin).toContainEqual({
      type: 'pin',
      messageId: 'b1',
      sessionId: 'sess-1',
      successMessage: 'toast.pinUpdated',
      failureMessage: 'toast.pinFailed',
    });
    expect(pin.some((e) => e.type === 'toast')).toBe(false);
    expect(pin.some((e) => e.type === 'pulse')).toBe(true);

    const unpin = planContextAction({ action: 'unpin', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(unpin).toContainEqual({
      type: 'unpin',
      messageId: 'b1',
      sessionId: 'sess-1',
      successMessage: 'toast.unpinned',
      failureMessage: 'toast.unpinFailed',
    });

    const recall = planContextAction({ action: 'recall', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(recall).toContainEqual({
      type: 'recall',
      messageId: 'b1',
      successMessage: 'toast.recalled',
      failureMessage: 'toast.recallFailed',
    });

    const react = planContextAction({ action: 'react', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(react).toContainEqual({
      type: 'react',
      messageId: 'b1',
      sessionId: 'sess-1',
      emoji: '👍',
      successMessage: 'toast.reactionAdded',
      failureMessage: 'toast.reactionFailed',
    });
  });

  it('plans the react effect with the emoji carried by the picker action string', () => {
    const transcript = [textBlock({ id: 'b1' })];

    const picked = planContextAction({
      action: 'react:🔥',
      blockId: 'b1',
      transcript,
      t,
      sessionId: 'sess-1',
    });
    expect(picked).toContainEqual({
      type: 'react',
      messageId: 'b1',
      sessionId: 'sess-1',
      emoji: '🔥',
      successMessage: 'toast.reactionAdded',
      failureMessage: 'toast.reactionFailed',
    });
    expect(picked.some((e) => e.type === 'toast')).toBe(false);

    // Without a session id (Desktop/demo) the picker action plans nothing —
    // no fake success toast for an effect that cannot run (#1818).
    const demo = planContextAction({ action: 'react:🎉', blockId: 'b1', transcript, t });
    expect(demo).toEqual([]);
  });

  it('wires the react menu item to an emoji picker submenu that plans the chosen emoji', () => {
    const onAction = vi.fn();
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection: vi.fn(),
      hubMessageActions: true,
    });
    const reactItem = groups[0]?.find((item) => item.label === 'context.react');
    expect(reactItem?.chevron).toBe(true);
    expect(typeof reactItem?.submenu).toBe('function');

    const close = vi.fn();
    const submenu = reactItem!.submenu as (close: () => void) => ReactNode;
    const { getByRole } = render(submenu(close));
    fireEvent.click(getByRole('gridcell', { name: '❤️' }));
    expect(onAction).toHaveBeenCalledWith('react:❤️', 'b1');
    expect(close).toHaveBeenCalledOnce();
  });

  it('plans nothing for pin/recall without a session id instead of a fake toast (#1818)', () => {
    const transcript = [
      textBlock({ id: 'b1' }),
      textBlock({ id: 'u1', author: { id: 'u', role: 'human', name: 'You' } }),
    ];
    const pin = planContextAction({ action: 'pin', blockId: 'b1', transcript, t });
    expect(pin).toEqual([]);
    const react = planContextAction({ action: 'react', blockId: 'b1', transcript, t });
    expect(react).toEqual([]);
    const recall = planContextAction({ action: 'recall', blockId: 'u1', transcript, t });
    expect(recall).toEqual([]);
  });

  it('keeps the forward placeholder toast for the plain forward action (direct callers)', () => {
    const transcript = [textBlock({ id: 'b1' })];
    const forward = planContextAction({ action: 'forward', blockId: 'b1', transcript, t, sessionId: 'sess-1' });
    expect(forward.some((e) => e.type === 'forward')).toBe(false);
    expect(forward.some((e) => e.type === 'toast')).toBe(true);
    expect(forward.find((e) => e.type === 'toast')?.message).toBe('toast.forwardSelectTarget');
  });

  it('plans a forward effect with target ids for the picker action (#1385)', () => {
    const transcript = [textBlock({ id: 'b1' })];
    const picked = planContextAction({
      action: forwardActionForTargets(['s9', 's10']),
      blockId: 'b1',
      transcript,
      t,
      sessionId: 'sess-1',
    });
    expect(picked).toContainEqual({
      type: 'forward',
      messageId: 'b1',
      targetSessionIds: ['s9', 's10'],
      successMessage: 'toast.forwardQueued',
      failureMessage: 'toast.forwardFailed',
    });
    expect(picked.some((e) => e.type === 'pulse')).toBe(true);
    expect(picked.some((e) => e.type === 'toast')).toBe(false);
  });

  it('round-trips forward target ids through the action string encoding', () => {
    // Ids with characters that are URL-sensitive survive the round trip.
    const ids = ['sess/1', 'sess 2', 'sess,3', 'sess%4'];
    const encoded = forwardActionForTargets(ids);
    expect(encoded.startsWith('forward:')).toBe(true);
    expect(encoded).not.toBe('forward:'); // non-empty payload
    expect(planContextAction({
      action: encoded,
      blockId: 'b1',
      transcript: [textBlock({ id: 'b1' })],
      t,
    })).toContainEqual({
      type: 'forward',
      messageId: 'b1',
      targetSessionIds: ids,
      successMessage: 'toast.forwardQueued',
      failureMessage: 'toast.forwardFailed',
    });
  });

  it('wires the forward menu item to a picker submenu that plans the chosen targets (#1385)', () => {
    const onAction = vi.fn();
    const conversations: Array<{ id: string; title: string; kind: 'direct' | 'group' }> = [
      { id: 's1', title: '需求', kind: 'direct' },
      { id: 's2', title: '评审', kind: 'group' },
    ];
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection: vi.fn(),
      conversations,
    });
    const forwardItem = groups[0]?.find((item) => item.label === 'context.forward');
    expect(forwardItem?.chevron).toBe(true);
    expect(typeof forwardItem?.submenu).toBe('function');

    const close = vi.fn();
    const submenu = forwardItem!.submenu as (close: () => void) => ReactNode;
    const { getByRole, getAllByRole } = render(submenu(close));
    expect(getByRole('listbox')).toHaveAttribute('aria-multiselectable', 'true');
    expect(getAllByRole('option').map((option) => option.textContent)).toEqual(['需求', '评审']);

    fireEvent.click(getAllByRole('option')[1]!);
    fireEvent.click(getByRole('button', { name: 'forward.confirm' }));
    expect(onAction).toHaveBeenCalledWith('forward:s2', 'b1');
    expect(close).toHaveBeenCalledOnce();
  });

  it('omits the forward menu item when no conversations are wired (#1385, #1818)', () => {
    const onAction = vi.fn();
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection: vi.fn(),
    });
    // A plain forward without a target picker only ever produced a
    // placeholder toast, so shells without conversations get no entry.
    const forwardItem = groups[0]?.find((item) => item.label === 'context.forward');
    expect(forwardItem).toBeUndefined();
    expect(onAction).not.toHaveBeenCalled();
  });

  it('shows the empty picker state when the conversation list is empty (#1385)', () => {
    const onAction = vi.fn();
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection: vi.fn(),
      conversations: [],
    });
    const forwardItem = groups[0]?.find((item) => item.label === 'context.forward');
    const close = vi.fn();
    const submenu = forwardItem!.submenu as (close: () => void) => ReactNode;
    const { getByRole } = render(submenu(close));
    expect(getByRole('status')).toHaveTextContent('forward.empty');
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
      { type: 'pin', messageId: 'm1', sessionId: 's1', successMessage: 'pin-ok', failureMessage: 'pin-fail' },
      { type: 'unpin', messageId: 'm2', sessionId: 's2', successMessage: 'unpin-ok', failureMessage: 'unpin-fail' },
      { type: 'forward', messageId: 'm3', targetSessionIds: ['s9'], successMessage: 'fwd-ok', failureMessage: 'fwd-fail' },
      { type: 'recall', messageId: 'm4', successMessage: 'recall-ok', failureMessage: 'recall-fail' },
      { type: 'react', messageId: 'm5', sessionId: 's5', emoji: '🔥', successMessage: 'react-ok', failureMessage: 'react-fail' },
    ], handlers);
    expect(handlers.onPinMessage).toHaveBeenCalledWith('m1', 's1');
    expect(handlers.onUnpinMessage).toHaveBeenCalledWith('m2', 's2');
    expect(handlers.onForwardMessage).toHaveBeenCalledWith('m3', ['s9']);
    expect(handlers.onRecallMessage).toHaveBeenCalledWith('m4');
    expect(handlers.onAddMessageReaction).toHaveBeenCalledWith('m5', 's5', '🔥');
  });

  it('awaits Hub message actions before the success toast and reports failures (#1821)', async () => {
    const baseHandlers = {
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    };

    // Resolve-controlled pin: no toast before the request settles.
    let resolvePin: (() => void) | undefined;
    const slowPin = vi.fn(() => new Promise<void>((resolve) => {
      resolvePin = () => resolve();
    }));
    applyTranscriptChromeSideEffects([
      { type: 'pin', messageId: 'm1', sessionId: 's1', successMessage: 'pin-ok', failureMessage: 'pin-fail' },
    ], { ...baseHandlers, onPinMessage: slowPin });
    expect(slowPin).toHaveBeenCalledWith('m1', 's1');
    expect(baseHandlers.showWorkbenchToast).not.toHaveBeenCalled();
    resolvePin?.();
    await vi.waitFor(() => {
      expect(baseHandlers.showWorkbenchToast).toHaveBeenCalledWith('pin-ok');
    });

    // Rejecting pin: the error message (or the failure copy) is shown.
    const rejectingPin = vi.fn().mockRejectedValue(new Error('hub 503'));
    applyTranscriptChromeSideEffects([
      { type: 'pin', messageId: 'm1', sessionId: 's1', successMessage: 'pin-ok', failureMessage: 'pin-fail' },
    ], { ...baseHandlers, onPinMessage: rejectingPin });
    await vi.waitFor(() => {
      expect(baseHandlers.showWorkbenchToast).toHaveBeenCalledWith('hub 503');
    });

    // Rejecting regenerate: no soft-hide, no pulse — the message stays
    // visible and the failure is announced (#1821 honest state).
    const regenerateHandlers = {
      ...baseHandlers,
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      onRegenerate: vi.fn().mockRejectedValue(new Error('regen refused')),
    };
    applyTranscriptChromeSideEffects([
      { type: 'regenerate', blockId: 'b1', successMessage: 'regen-ok', failureMessage: 'regen-fail' },
    ], regenerateHandlers);
    await vi.waitFor(() => {
      expect(regenerateHandlers.showWorkbenchToast).toHaveBeenCalledWith('regen refused');
    });
    expect(regenerateHandlers.softHideBlocks).not.toHaveBeenCalled();
    expect(regenerateHandlers.pulseBlock).not.toHaveBeenCalled();

    // Resolving regenerate: soft-hide + pulse + success toast land together.
    const okRegenerateHandlers = {
      ...baseHandlers,
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      onRegenerate: vi.fn().mockResolvedValue(undefined),
    };
    applyTranscriptChromeSideEffects([
      { type: 'regenerate', blockId: 'b2', successMessage: 'regen-ok', failureMessage: 'regen-fail' },
    ], okRegenerateHandlers);
    await vi.waitFor(() => {
      expect(okRegenerateHandlers.showWorkbenchToast).toHaveBeenCalledWith('regen-ok');
    });
    expect(okRegenerateHandlers.softHideBlocks).toHaveBeenCalledWith(['b2']);
    expect(okRegenerateHandlers.pulseBlock).toHaveBeenCalledWith('b2');

    // Synchronous regenerate handler keeps the immediate legacy behavior.
    const syncRegenerateHandlers = {
      ...baseHandlers,
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      onRegenerate: vi.fn(),
    };
    applyTranscriptChromeSideEffects([
      { type: 'regenerate', blockId: 'b3', successMessage: 'regen-ok', failureMessage: 'regen-fail' },
    ], syncRegenerateHandlers);
    expect(syncRegenerateHandlers.softHideBlocks).toHaveBeenCalledWith(['b3']);
    expect(syncRegenerateHandlers.pulseBlock).toHaveBeenCalledWith('b3');
    expect(syncRegenerateHandlers.showWorkbenchToast).toHaveBeenCalledWith('regen-ok');
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
      { type: 'pin', messageId: 'm1', sessionId: 's1', successMessage: 'pin-ok', failureMessage: 'pin-fail' },
      { type: 'recall', messageId: 'm2', successMessage: 'recall-ok', failureMessage: 'recall-fail' },
    ], handlers)).not.toThrow();
    // #1821: without a handler there is no real effect, so no success toast.
    expect(handlers.showWorkbenchToast).not.toHaveBeenCalled();
  });
});
