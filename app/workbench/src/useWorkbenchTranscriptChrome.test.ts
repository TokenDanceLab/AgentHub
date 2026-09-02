// real_tested=true
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import type { TranscriptBlock } from '@shared/transcript';
import type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
} from './workbenchTranscriptChromeHelpers';
import {
  useWorkbenchTranscriptChrome,
  type UseWorkbenchTranscriptChromeOptions,
} from './useWorkbenchTranscriptChrome';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchTranscriptChrome — hook-level wiring over the #615/#627/
   #650/#755 controller.

   Covers default chrome state, selection enter/toggle/range/reset, the
   toast window, block context menus, copy/regenerate/approval block
   actions, Hub REST message actions (pin/unpin/react/recall/forward) with
   and without a session id, multi-select bar actions, selection hotkeys,
   hold-to-select pointer flows, and the selection bar rect.
   ═══════════════════════════════════════════════════════════════════════ */

/** Key-echo translator matching the helper test convention. */
function t(key: string, options?: Record<string, unknown>): string {
  return options?.count !== undefined ? `${key}:${String(options.count)}` : key;
}

function textBlock(
  overrides: Partial<Extract<TranscriptBlock, { kind: 'text' }>> = {},
): TranscriptBlock {
  return {
    id: 'b1',
    kind: 'text',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    text: 'hello world from agent',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function userTextBlock(
  overrides: Partial<Extract<TranscriptBlock, { kind: 'text' }>> = {},
): TranscriptBlock {
  return textBlock({
    id: 'u1',
    author: { id: 'user-1', role: 'human', name: 'You' },
    text: 'please build the thing',
    ...overrides,
  });
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

function pointerEvent(partial: Partial<TranscriptPointerEvent> = {}): TranscriptPointerEvent {
  return {
    preventDefault: vi.fn(),
    clientX: 10,
    clientY: 10,
    button: 0,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    target: null,
    currentTarget: document.createElement('div'),
    ...partial,
  };
}

function contextMenuEvent(partial: Partial<TranscriptContextMenuEvent> = {}): TranscriptContextMenuEvent {
  return {
    preventDefault: vi.fn(),
    clientX: 10,
    clientY: 20,
    ...partial,
  };
}

/** jsdom has no clipboard; install a recording writeText stub. */
function stubClipboard(): ReturnType<typeof vi.fn> {
  const writeText = vi.fn();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
    writable: true,
  });
  return writeText;
}

function findMenuAction(
  groups: Array<Array<{ label: string; onClick: () => void }>>,
  label: string,
): (() => void) | undefined {
  for (const group of groups) {
    const item = group.find((entry) => entry.label === label);
    if (item) return item.onClick;
  }
  return undefined;
}

function renderTranscriptChrome(initialProps: Partial<UseWorkbenchTranscriptChromeOptions> = {}) {
  const dispatchComposer = vi.fn();
  const composerInputRef: { current: HTMLTextAreaElement | null } = { current: null };
  const workspaceRef: { current: HTMLElement | null } = { current: null };

  const rendered = renderHook(
    (props: Partial<UseWorkbenchTranscriptChromeOptions>) => useWorkbenchTranscriptChrome({
      transcript: [],
      t,
      dispatchComposer,
      composerInputRef,
      workspaceRef,
      inspectorCollapsed: false,
      inspectorWidth: 400,
      ...props,
    }),
    { initialProps },
  );

  return { ...rendered, dispatchComposer, composerInputRef, workspaceRef };
}

describe('useWorkbenchTranscriptChrome', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('exposes default transcript chrome state and every handler', () => {
    const { result } = renderTranscriptChrome({ transcript: [textBlock()] });

    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);
    expect(result.current.softHiddenBlockIds).toEqual([]);
    expect(result.current.actionedBlockIds).toEqual([]);
    expect(result.current.contextMenu).toBeNull();
    expect(result.current.toastMessage).toBe('');
    expect(result.current.toastVisible).toBe(false);
    expect(result.current.selectBarRect).toBeNull();
    expect(result.current.selectionModeRef.current).toBe(false);

    expect(result.current.multiSelectActions.map((action) => action.label)).toEqual([
      'bar.selectAll',
      'bar.clear',
      'context.copy',
      'context.delete',
      'bar.exit',
    ]);

    const groups = result.current.contextMenuGroups('b1');
    expect(groups).toHaveLength(3);
    // Without a Hub session the react entry is omitted; forward needs a
    // conversation list; both stay hidden in this session-less shell (#1818).
    expect(groups[0]?.map((item) => item.label)).toEqual([
      'context.copy',
      'context.reply',
      'context.quote',
    ]);

    expect(typeof result.current.setContextMenu).toBe('function');
    expect(typeof result.current.showWorkbenchToast).toBe('function');
    expect(typeof result.current.openBlockContextMenu).toBe('function');
    expect(typeof result.current.handleBlockSelect).toBe('function');
    expect(typeof result.current.handleTranscriptBlockAction).toBe('function');
    expect(typeof result.current.beginBlockHoldSelection).toBe('function');
    expect(typeof result.current.updateBlockHoldSelection).toBe('function');
    expect(typeof result.current.handleBlockPointerUp).toBe('function');
    expect(typeof result.current.copyText).toBe('function');
    expect(typeof result.current.resetSelection).toBe('function');
  });

  it('builds context menu groups shaped for agent and user blocks', () => {
    // A session id enables the Hub REST entries (recall et al.), so the
    // agent/user shape assertions below run with one (#1818). #2154: the
    // entries are additionally gated on the port handler being wired — the
    // shape assertions here are about author/kind, so declare both ports.
    const { result } = renderTranscriptChrome({
      transcript: [textBlock(), userTextBlock()],
      sessionId: 'sess-1',
      onRegenerate: vi.fn(),
      onRecallMessage: vi.fn(),
    });

    const agentGroups = result.current.contextMenuGroups('b1');
    // Agent text gets quote/regenerate; user text additionally gets edit/recall.
    expect(agentGroups[0]?.some((item) => item.label === 'context.quote')).toBe(true);
    expect(agentGroups[2]?.some((item) => item.label === 'context.regenerate')).toBe(true);
    expect(agentGroups[2]?.some((item) => item.label === 'context.recall')).toBe(false);

    const userGroups = result.current.contextMenuGroups('u1');
    expect(userGroups[0]?.some((item) => item.label === 'context.edit')).toBe(true);
    expect(userGroups[2]?.some((item) => item.label === 'context.recall')).toBe(true);
    expect(userGroups[2]?.some((item) => item.label === 'context.regenerate')).toBe(false);

    // Non-text blocks drop the quote entry.
    const permGroups = result.current.contextMenuGroups('perm-1');
    expect(permGroups[0]?.some((item) => item.label === 'context.quote')).toBe(false);
  });

  it('toggles selection by block id without forcing the selection bar', () => {
    const { result } = renderTranscriptChrome({ transcript: [textBlock()] });

    act(() => {
      result.current.handleBlockSelect('b1');
    });
    expect(result.current.selectedBlockIds).toEqual(['b1']);
    expect(result.current.selectionMode).toBe(false);

    act(() => {
      result.current.handleBlockSelect('b1');
    });
    expect(result.current.selectedBlockIds).toEqual([]);
  });

  it('extends the selection across a shift-click range', () => {
    const blocks = [
      textBlock({ id: 'b1' }),
      textBlock({ id: 'b2' }),
      textBlock({ id: 'b3' }),
    ];
    const { result } = renderTranscriptChrome({ transcript: blocks });

    act(() => {
      result.current.handleBlockSelect('b1', { shiftKey: true });
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedBlockIds).toEqual(['b1']);

    act(() => {
      result.current.handleBlockSelect('b3', { shiftKey: true });
    });
    expect(result.current.selectedBlockIds).toEqual(['b1', 'b2', 'b3']);
  });

  it('resets every selection surface via resetSelection', () => {
    const blocks = [textBlock({ id: 'b1' }), textBlock({ id: 'b2' })];
    const { result } = renderTranscriptChrome({ transcript: blocks });

    act(() => {
      result.current.handleBlockSelect('b1', { shiftKey: true });
      result.current.handleBlockSelect('b2', { shiftKey: true });
      result.current.openBlockContextMenu(textBlock(), contextMenuEvent());
      findMenuAction(result.current.contextMenuGroups('b1'), 'context.delete')?.();
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.contextMenu).not.toBeNull();
    expect(result.current.softHiddenBlockIds).toEqual(['b1']);

    act(() => {
      result.current.resetSelection();
    });
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);
    expect(result.current.actionedBlockIds).toEqual([]);
    expect(result.current.softHiddenBlockIds).toEqual([]);
    expect(result.current.contextMenu).toBeNull();
  });

  it('shows a toast that auto-hides after the toast window', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderTranscriptChrome({ transcript: [textBlock()] });

    act(() => {
      result.current.showWorkbenchToast('hello toast');
    });
    expect(result.current.toastMessage).toBe('hello toast');
    expect(result.current.toastVisible).toBe(true);

    act(() => {
      vi.advanceTimersByTime(WORKBENCH_TOAST_MS);
    });
    expect(result.current.toastVisible).toBe(false);

    // A second toast before the window expires resets the timer.
    act(() => {
      result.current.showWorkbenchToast('first');
    });
    act(() => {
      vi.advanceTimersByTime(WORKBENCH_TOAST_MS - 500);
      result.current.showWorkbenchToast('second');
    });
    expect(result.current.toastMessage).toBe('second');
    act(() => {
      vi.advanceTimersByTime(WORKBENCH_TOAST_MS - 500);
    });
    expect(result.current.toastVisible).toBe(true);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current.toastVisible).toBe(false);

    unmount();
  });

  it('opens a block context menu with the event coordinates', () => {
    const { result } = renderTranscriptChrome({ transcript: [textBlock({ id: 'b1' })] });
    const event = contextMenuEvent({ clientX: 42, clientY: 77 });

    act(() => {
      result.current.openBlockContextMenu(textBlock({ id: 'b1' }), event);
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(result.current.contextMenu).toEqual({
      blockId: 'b1',
      title: 'hello world from agent',
      x: 42,
      y: 77,
    });
  });

  it('copies block text on the copy action and pulses the block', () => {
    vi.useFakeTimers();
    const writeText = stubClipboard();
    const { result } = renderTranscriptChrome({ transcript: [textBlock()] });

    act(() => {
      result.current.handleTranscriptBlockAction('copy', 'b1');
    });

    expect(writeText).toHaveBeenCalledWith('hello world from agent');
    expect(result.current.toastMessage).toBe('toast.cardCopied');
    expect(result.current.toastVisible).toBe(true);
    expect(result.current.actionedBlockIds).toEqual(['b1']);

    act(() => {
      vi.advanceTimersByTime(WORKBENCH_PULSE_MS);
    });
    expect(result.current.actionedBlockIds).toEqual([]);
  });

  it('regenerates agent text and soft-hides the block', () => {
    const onRegenerate = vi.fn();
    const { result } = renderTranscriptChrome({
      transcript: [textBlock(), userTextBlock()],
      onRegenerate,
    });

    act(() => {
      result.current.handleTranscriptBlockAction('regenerate', 'b1');
    });
    expect(onRegenerate).toHaveBeenCalledWith('b1');
    expect(result.current.softHiddenBlockIds).toEqual(['b1']);
    expect(result.current.toastMessage).toBe('action.regenerating');

    // Human-authored blocks never regenerate.
    act(() => {
      result.current.handleTranscriptBlockAction('regenerate', 'u1');
    });
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(result.current.softHiddenBlockIds).toEqual(['b1']);
  });

  it('routes approve/deny decisions for permission requests', async () => {
    const onApprovalDecision = vi.fn();
    const { result } = renderTranscriptChrome({
      transcript: [
        permissionBlock({
          teamId: 'team-1',
          teamRunId: 'team-run-1',
          targetId: 'target-9',
        }),
      ],
      onApprovalDecision,
    });

    // #1821: the success toast fires only after the decision request
    // resolves; flush the microtask chain before asserting the message.
    await act(async () => {
      result.current.handleTranscriptBlockAction('approve', 'perm-1');
    });
    expect(onApprovalDecision).toHaveBeenCalledWith({
      approvalId: 'req-1',
      decision: 'allow',
      teamId: 'team-1',
      teamRunId: 'team-run-1',
      targetId: 'target-9',
    });
    expect(result.current.toastMessage).toBe('action.approved');

    await act(async () => {
      result.current.handleTranscriptBlockAction('deny', 'perm-1');
    });
    expect(onApprovalDecision).toHaveBeenLastCalledWith({
      approvalId: 'req-1',
      decision: 'deny',
      teamId: 'team-1',
      teamRunId: 'team-run-1',
      targetId: 'target-9',
    });
    expect(result.current.toastMessage).toBe('action.denied');

    // Non-permission blocks never produce approval decisions.
    act(() => {
      result.current.handleTranscriptBlockAction('approve', 'b1');
    });
    expect(onApprovalDecision).toHaveBeenCalledTimes(2);
  });

  it('wires pin/unpin/recall through the REST handlers with a session id', () => {
    const onPinMessage = vi.fn();
    const onUnpinMessage = vi.fn();
    const onAddMessageReaction = vi.fn();
    const onRecallMessage = vi.fn();
    const { result } = renderTranscriptChrome({
      transcript: [textBlock(), textBlock({ id: 'pinned-1', pinned: true }), userTextBlock()],
      sessionId: 's1',
      onPinMessage,
      onUnpinMessage,
      onAddMessageReaction,
      onRecallMessage,
    });

    act(() => {
      findMenuAction(result.current.contextMenuGroups('b1'), 'context.pinMessage')?.();
    });
    expect(onPinMessage).toHaveBeenCalledWith('b1', 's1');
    expect(result.current.toastMessage).toBe('toast.pinUpdated');

    act(() => {
      findMenuAction(result.current.contextMenuGroups('pinned-1'), 'context.unpin')?.();
    });
    expect(onUnpinMessage).toHaveBeenCalledWith('pinned-1', 's1');
    expect(result.current.toastMessage).toBe('toast.unpinned');

    // #1822: the react menu entry was write-only (POST fired but the
    // transcript never rendered or cancelled reactions) — removed.
    const labels = result.current.contextMenuGroups('b1').flat().map((item) => item.label);
    expect(labels).not.toContain('context.react');
    expect(onAddMessageReaction).not.toHaveBeenCalled();

    act(() => {
      findMenuAction(result.current.contextMenuGroups('u1'), 'context.recall')?.();
    });
    expect(onRecallMessage).toHaveBeenCalledWith('u1');
    expect(result.current.toastMessage).toBe('toast.recalled');
  });

  it('hides REST menu entries and plans no fake toasts without a session id (#1818)', () => {
    const onPinMessage = vi.fn();
    const { result } = renderTranscriptChrome({
      transcript: [textBlock(), userTextBlock()],
      onPinMessage,
    });

    // No pin/react/recall entries in a session-less shell.
    const labels = result.current.contextMenuGroups('u1').flat().map((item) => item.label);
    expect(labels).not.toContain('context.pinMessage');
    expect(labels).not.toContain('context.react');
    expect(labels).not.toContain('context.recall');
    // No forward entry without picker conversations either.
    expect(labels).not.toContain('context.forward');

    // A stray pin action plans nothing — no handler call, no fake toast.
    act(() => {
      result.current.handleTranscriptBlockAction('pin', 'b1');
    });
    expect(onPinMessage).not.toHaveBeenCalled();
    expect(result.current.toastVisible).toBe(false);
  });

  it('forwards to chosen targets through the context menu picker submenu', () => {
    const onForwardMessage = vi.fn();
    const conversations: WorkbenchConversation[] = [
      { id: 'c1', title: 'C1', kind: 'direct' },
      { id: 'c2', title: 'C2', kind: 'group' },
    ];
    const { result } = renderTranscriptChrome({
      transcript: [textBlock()],
      sessionId: 's1',
      onForwardMessage,
    });

    const groups = result.current.contextMenuGroups('b1', conversations);
    const forwardItem = groups[0]?.find((item) => item.label === 'context.forward');
    expect(forwardItem?.chevron).toBe(true);
    expect(typeof forwardItem?.submenu).toBe('function');

    const close = vi.fn();
    const picker = forwardItem?.submenu?.(close) as ReactElement<{ onConfirm: (targetSessionIds: string[]) => void }> | undefined;
    act(() => {
      picker?.props.onConfirm(['c1', 'c2']);
    });
    expect(onForwardMessage).toHaveBeenCalledWith('b1', ['c1', 'c2']);
    expect(result.current.toastMessage).toBe('toast.forwardQueued');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('multi-select bar actions select, clear, copy, delete, and exit', () => {
    const writeText = stubClipboard();
    const blocks = [textBlock({ id: 'b1' }), textBlock({ id: 'b2' })];
    const { result } = renderTranscriptChrome({ transcript: blocks });

    act(() => {
      result.current.multiSelectActions.find((action) => action.label === 'bar.selectAll')?.onClick();
    });
    expect(result.current.selectedBlockIds).toEqual(['b1', 'b2']);

    act(() => {
      result.current.multiSelectActions.find((action) => action.label === 'context.copy')?.onClick();
    });
    expect(writeText).toHaveBeenCalledWith('hello world from agent\nhello world from agent');
    expect(result.current.toastMessage).toBe('toast.multiCopy:2');

    act(() => {
      result.current.multiSelectActions.find((action) => action.label === 'bar.clear')?.onClick();
    });
    expect(result.current.selectedBlockIds).toEqual([]);

    act(() => {
      result.current.handleBlockSelect('b1', { shiftKey: true });
      result.current.handleBlockSelect('b2', { shiftKey: true });
    });
    act(() => {
      result.current.multiSelectActions.find((action) => action.danger)?.onClick();
    });
    // #1823: the destructive delete raises the confirm gate; nothing is
    // removed until the user confirms. The gate carries the selection
    // snapshot the dialog promises to delete.
    expect(result.current.deleteConfirmPending).toEqual({ count: 2, blockIds: ['b1', 'b2'] });
    expect(result.current.softHiddenBlockIds).toEqual([]);

    act(() => {
      result.current.cancelDeleteConfirm();
    });
    expect(result.current.deleteConfirmPending).toBeNull();
    expect(result.current.softHiddenBlockIds).toEqual([]);
    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.multiSelectActions.find((action) => action.danger)?.onClick();
    });
    expect(result.current.deleteConfirmPending).toEqual({ count: 2, blockIds: ['b1', 'b2'] });
    act(() => {
      result.current.confirmMultiDelete();
    });
    expect(result.current.softHiddenBlockIds).toEqual(['b1', 'b2']);
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);
    expect(result.current.toastMessage).toBe('toast.multiDelete:2');
    expect(result.current.deleteConfirmPending).toBeNull();

    act(() => {
      result.current.handleBlockSelect('b1', { shiftKey: true });
    });
    act(() => {
      result.current.multiSelectActions.find((action) => action.label === 'bar.exit')?.onClick();
    });
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);
  });

  it('Ctrl+A, Escape, and Delete hotkeys drive the selection', () => {
    const blocks = [textBlock({ id: 'b1' }), textBlock({ id: 'b2' })];
    const { result } = renderTranscriptChrome({ transcript: blocks });

    // Enter selection through the context menu multi-select entry.
    act(() => {
      findMenuAction(result.current.contextMenuGroups('b1'), 'context.multiSelect')?.();
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedBlockIds).toEqual(['b1']);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    expect(result.current.selectedBlockIds).toEqual(['b1', 'b2']);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);

    // Hotkeys are inert while the selection bar is closed.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(result.current.softHiddenBlockIds).toEqual([]);

    act(() => {
      result.current.handleBlockSelect('b1', { shiftKey: true });
      result.current.handleBlockSelect('b2', { shiftKey: true });
    });
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    // #1823: bare Delete raises the confirm gate instead of deleting.
    expect(result.current.deleteConfirmPending).toEqual({ count: 2, blockIds: ['b1', 'b2'] });
    expect(result.current.softHiddenBlockIds).toEqual([]);
    expect(result.current.selectionMode).toBe(true);

    act(() => {
      result.current.confirmMultiDelete();
    });
    expect(result.current.softHiddenBlockIds).toEqual(['b1', 'b2']);
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.toastMessage).toBe('toast.multiDelete:2');
    expect(result.current.deleteConfirmPending).toBeNull();
  });

  it('confirms the original snapshot even when the selection changes while the gate is open (#1823)', () => {
    const blocks = [textBlock({ id: 'b1' }), textBlock({ id: 'b2' })];
    const { result } = renderTranscriptChrome({ transcript: blocks });

    act(() => {
      findMenuAction(result.current.contextMenuGroups('b1'), 'context.multiSelect')?.();
    });
    expect(result.current.selectedBlockIds).toEqual(['b1']);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    });
    expect(result.current.deleteConfirmPending).toEqual({ count: 1, blockIds: ['b1'] });

    // The user changes the live selection while the confirm dialog is open
    // (Ctrl/⌘+A) — the confirmed delete must still remove exactly what the
    // dialog promised, not the new selection.
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true }));
    });
    expect(result.current.selectedBlockIds).toEqual(['b1', 'b2']);

    act(() => {
      result.current.confirmMultiDelete();
    });
    expect(result.current.softHiddenBlockIds).toEqual(['b1']);
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.toastMessage).toBe('toast.multiDelete:1');
    expect(result.current.deleteConfirmPending).toBeNull();
  });

  it('enters selection after the hold delay and consumes the pointer up', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderTranscriptChrome({ transcript: [textBlock()] });
    const event = pointerEvent({ clientX: 10, clientY: 10 });

    act(() => {
      result.current.beginBlockHoldSelection(textBlock(), event);
    });
    expect(result.current.selectionMode).toBe(false);

    act(() => {
      vi.advanceTimersByTime(SELECTION_HOLD_DELAY_MS);
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectedBlockIds).toEqual(['b1']);
    expect(result.current.selectionModeRef.current).toBe(true);

    // The pointer up right after the hold is suppressed, not a new selection.
    act(() => {
      result.current.handleBlockPointerUp(textBlock(), event);
    });
    expect(result.current.selectedBlockIds).toEqual(['b1']);

    // A later pointer up in selection mode selects the block.
    act(() => {
      result.current.handleBlockPointerUp(textBlock({ id: 'b2' }), pointerEvent());
    });
    expect(result.current.selectedBlockIds).toEqual(['b1', 'b2']);

    unmount();
  });

  it('cancels the hold when the pointer moves beyond the cancel distance', () => {
    vi.useFakeTimers();
    const { result, unmount } = renderTranscriptChrome({ transcript: [textBlock()] });

    act(() => {
      result.current.beginBlockHoldSelection(textBlock(), pointerEvent({ clientX: 10, clientY: 10 }));
    });
    act(() => {
      result.current.updateBlockHoldSelection(
        pointerEvent({ clientX: 10 + SELECTION_HOLD_CANCEL_DISTANCE + 1, clientY: 10 }),
      );
    });
    act(() => {
      vi.advanceTimersByTime(SELECTION_HOLD_DELAY_MS);
    });
    expect(result.current.selectionMode).toBe(false);
    expect(result.current.selectedBlockIds).toEqual([]);

    // Non-left buttons never begin a hold.
    act(() => {
      result.current.beginBlockHoldSelection(textBlock(), pointerEvent({ button: 2 }));
    });
    act(() => {
      vi.advanceTimersByTime(SELECTION_HOLD_DELAY_MS);
    });
    expect(result.current.selectionMode).toBe(false);

    unmount();
  });

  it('tracks the selection bar rect from the workspace element', () => {
    const workspace = document.createElement('div');
    vi.spyOn(workspace, 'getBoundingClientRect').mockReturnValue({
      left: 120,
      width: 640,
      top: 0,
      right: 760,
      bottom: 0,
      x: 120,
      y: 0,
      height: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const { result, workspaceRef } = renderTranscriptChrome({ transcript: [textBlock()] });
    workspaceRef.current = workspace;

    act(() => {
      findMenuAction(result.current.contextMenuGroups('b1'), 'context.multiSelect')?.();
    });
    expect(result.current.selectionMode).toBe(true);
    expect(result.current.selectBarRect).toEqual({ left: 120, width: 640 });
  });
});
