import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
  addIdIfMissing,
  applySelectionHotkeyPlan,
  applyTranscriptChromeSideEffects,
  beginSelectionHold,
  blockTitle,
  buildContextMenuState,
  buildPermissionApprovalDecision,
  buildQuoteComposerText,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  cardActionLabel,
  cardLinkForBlock,
  clearPulseTimers,
  clearTimeoutIfSet,
  createEnterSelectionSnapshot,
  createExitSelectionSnapshot,
  createResetSelectionSnapshot,
  createSelectionHoldState,
  createTranscriptChromeController,
  disposeSelectionHoldRef,
  disposeToastAndPulseTimers,
  isNestedInteractiveTarget,
  mergeUniqueIds,
  multiActionLabel,
  planBeginHoldSelection,
  planBlockPointerUp,
  planBlockSelect,
  planContextAction,
  planMultiAction,
  planSelectionHotkeyEffect,
  planTranscriptBlockAction,
  planUpdateHoldSelection,
  removeIdFromList,
  resolveBlockTitleById,
  resolveQuoteText,
  resolveSelectBarRectFromElement,
  resolveSelectionHotkey,
  resolveSelectionRangeIds,
  schedulePulseTimer,
  scheduleWorkbenchToastTimer,
  selectBarRectFromWorkspace,
  selectionHotkeyPreventsDefault,
  shouldBeginHoldSelection,
  shouldCancelSelectionHold,
  shouldHandleSelectionPointerUp,
  toggleIdInList,
  transcriptBlockIds,
  writeClipboardText,
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

describe('workbenchTranscriptChromeHelpers', () => {
  it('keeps selection hold and chrome timing constants stable', () => {
    expect(SELECTION_HOLD_DELAY_MS).toBe(520);
    expect(SELECTION_HOLD_CANCEL_DISTANCE).toBe(36);
    expect(WORKBENCH_TOAST_MS).toBe(1700);
    expect(WORKBENCH_PULSE_MS).toBe(900);
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
    expect(resolveBlockTitleById([textBlock({ id: 'x', text: 'abc' })], 'missing', t))
      .toBe('mainchain.selectedCard');
  });

  it('labels card and multi actions through the same i18n keys', () => {
    expect(cardActionLabel('copy', 'title', t)).toBe('toast.cardCopied');
    expect(cardActionLabel('reply', 'Card A', t)).toBe('context.reply Card A');
    expect(cardActionLabel('unknown', 'x', t)).toBe('toast.actionRecorded');
    expect(multiActionLabel('delete', 3, t)).toBe('toast.multiDelete:3');
    expect(multiActionLabel('other', 2, t)).toBe('toast.multiProcessed:2');
    // #1504: card links are openable web URLs, never the dead custom scheme.
    expect(cardLinkForBlock('b9')).toMatch(/^https?:\/\//);
    expect(cardLinkForBlock('b9')).not.toContain('agenthub://');
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
      'context.delete',
      'bar.exit',
    ]);

    actions[0]?.onClick();
    actions[2]?.onClick();
    actions[4]?.onClick();
    expect(onSelectAll).toHaveBeenCalledOnce();
    expect(onMultiAction).toHaveBeenCalledWith('copy');
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('toggles and merges selection id lists', () => {
    expect(toggleIdInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIdInList(['a', 'b'], 'a')).toEqual(['b']);
    expect(addIdIfMissing(['a'], 'a')).toEqual(['a']);
    expect(addIdIfMissing(['a'], 'b')).toEqual(['a', 'b']);
    expect(mergeUniqueIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(removeIdFromList(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('resolves selection ranges from transcript order', () => {
    const transcript = [
      textBlock({ id: 'a' }),
      textBlock({ id: 'b' }),
      textBlock({ id: 'c' }),
    ];
    expect(resolveSelectionRangeIds(transcript, ['a'], 'c')).toEqual(['a', 'b', 'c']);
    expect(resolveSelectionRangeIds(transcript, [], 'b')).toEqual(['b']);
    expect(resolveSelectionRangeIds(transcript, ['missing'], 'missing-2')).toBeNull();
  });

  it('cancels hold selection after pointer drift', () => {
    expect(shouldCancelSelectionHold({ x: 10, y: 10 }, 10, 10)).toBe(false);
    expect(shouldCancelSelectionHold({ x: 10, y: 10 }, 50, 10)).toBe(true);
  });

  it('builds context menu state and workspace select-bar rects', () => {
    expect(buildContextMenuState(textBlock({ id: 'm1', text: 'title-here' }), 12, 34, t)).toEqual({
      blockId: 'm1',
      title: 'title-here',
      x: 12,
      y: 34,
    });
    expect(selectBarRectFromWorkspace(null)).toBeNull();
    expect(selectBarRectFromWorkspace({ left: 8, width: 400 })).toEqual({ left: 8, width: 400 });
  });

  it('maps selection hotkeys', () => {
    expect(resolveSelectionHotkey({ key: 'Escape', ctrlKey: false, metaKey: false }))
      .toEqual({ type: 'escape' });
    expect(resolveSelectionHotkey({ key: 'a', ctrlKey: true, metaKey: false }))
      .toEqual({ type: 'selectAll', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'c', ctrlKey: false, metaKey: true }))
      .toEqual({ type: 'multiAction', action: 'copy', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'Delete', ctrlKey: false, metaKey: false }))
      .toEqual({ type: 'multiAction', action: 'delete', preventDefault: true });
    expect(resolveSelectionHotkey({ key: 'x', ctrlKey: false, metaKey: false })).toBeNull();
  });

  it('builds quote text and composer payload', () => {
    expect(resolveQuoteText('long body text here', '  selected  ')).toBe('selected');
    expect(resolveQuoteText('abcdefghij', null, 4)).toBe('abcd');
    expect(buildQuoteComposerText('line1\nline2')).toBe('> line1\n> line2\n\n');
  });

  it('builds permission approval decisions without undefined optionals', () => {
    const sparse = buildPermissionApprovalDecision(permissionBlock(), 'approve');
    expect(sparse).toEqual({
      approvalId: 'req-1',
      decision: 'allow',
    });
    expect(Object.keys(sparse).sort()).toEqual(['approvalId', 'decision']);

    const full = buildPermissionApprovalDecision(permissionBlock({
      teamId: 'team-1',
      teamRunId: 'run-1',
      agentTaskId: 'task-1',
      targetId: 'target-1',
      edgeDeviceId: 'edge-1',
      correlationId: 'corr-1',
    }), 'deny');
    expect(full).toEqual({
      approvalId: 'req-1',
      decision: 'deny',
      teamId: 'team-1',
      teamRunId: 'run-1',
      agentTaskId: 'task-1',
      targetId: 'target-1',
      edgeDeviceId: 'edge-1',
      correlationId: 'corr-1',
    });
  });

  it('plans context actions for copy/delete/reply/quote/regenerate', () => {
    const agent = textBlock({ id: 'agent-1', text: 'body\nnext' });
    const copy = planContextAction({
      action: 'copy',
      blockId: 'agent-1',
      transcript: [agent],
      t,
    });
    expect(copy.map((effect) => effect.type)).toEqual(['copy', 'pulse', 'toast']);

    const del = planContextAction({
      action: 'delete',
      blockId: 'agent-1',
      transcript: [agent],
      t,
    });
    expect(del).toContainEqual({ type: 'softHide', blockIds: ['agent-1'] });

    const reply = planContextAction({
      action: 'reply',
      blockId: 'agent-1',
      transcript: [agent],
      t,
    });
    expect(reply.some((effect) => effect.type === 'composer' && effect.focusComposer)).toBe(true);

    const quote = planContextAction({
      action: 'quote',
      blockId: 'agent-1',
      transcript: [agent],
      t,
      selectedText: 'picked',
    });
    const quoteComposer = quote.find((effect) => effect.type === 'composer');
    expect(quoteComposer).toMatchObject({
      type: 'composer',
      focusComposer: true,
    });

    const regenerate = planContextAction({
      action: 'regenerate',
      blockId: 'agent-1',
      transcript: [agent],
      t,
    });
    expect(regenerate.map((effect) => effect.type)).toEqual([
      'softHide',
      'regenerate',
      'pulse',
      'toast',
    ]);
  });

  it('plans transcript block actions for approval/retry/copy', () => {
    const perm = permissionBlock({ id: 'p1' });
    const agent = textBlock({ id: 'a1' });
    const approval = planTranscriptBlockAction({
      action: 'approve',
      blockId: 'p1',
      transcript: [perm],
      t,
    });
    expect(approval).toEqual([
      {
        type: 'approval',
        decision: {
          approvalId: 'req-1',
          decision: 'allow',
        },
      },
      { type: 'pulse', blockId: 'p1' },
      { type: 'toast', message: 'action.approved' },
    ]);

    const retry = planTranscriptBlockAction({
      action: 'retry',
      blockId: 'a1',
      transcript: [agent],
      t,
    });
    expect(retry.map((effect) => effect.type)).toEqual([
      'softHide',
      'regenerate',
      'pulse',
      'toast',
    ]);

    const copy = planTranscriptBlockAction({
      action: 'copy',
      blockId: 'a1',
      transcript: [agent],
      t,
      metadata: { text: 'meta-title' },
    });
    expect(copy[0]).toEqual({ type: 'copy', text: 'meta-title' });
    expect(planTranscriptBlockAction({
      action: 'copy',
      blockId: 'missing',
      transcript: [agent],
      t,
    })).toEqual([]);
  });

  it('plans multi actions for empty, copy, and delete selections', () => {
    const transcript = [textBlock({ id: 'a', text: 'A' }), textBlock({ id: 'b', text: 'B' })];
    expect(planMultiAction({
      action: 'copy',
      selectedBlockIds: [],
      transcript,
      t,
    })).toEqual([{ type: 'toast', message: 'toast.noCardSelected' }]);

    const copy = planMultiAction({
      action: 'copy',
      selectedBlockIds: ['a', 'b'],
      transcript,
      t,
    });
    expect(copy).toEqual([
      { type: 'copy', text: 'A\nB' },
      { type: 'toast', message: 'toast.multiCopy:2' },
    ]);

    const del = planMultiAction({
      action: 'delete',
      selectedBlockIds: ['a', 'b'],
      transcript,
      t,
    });
    expect(del).toEqual([
      { type: 'softHide', blockIds: ['a', 'b'] },
      { type: 'exitSelection' },
      { type: 'toast', message: 'toast.multiDelete:2' },
    ]);
  });

  it('gates hold/pointer selection and selection hotkey preventDefault', () => {
    const card = document.createElement('div');
    const button = document.createElement('button');
    card.appendChild(button);
    document.body.append(card);

    expect(shouldBeginHoldSelection({
      button: 0,
      target: card,
      currentTarget: card,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
    })).toBe(true);
    expect(shouldBeginHoldSelection({
      button: 0,
      target: button,
      currentTarget: card,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
    })).toBe(false);
    expect(shouldHandleSelectionPointerUp(true, {
      button: 0,
      target: card,
      currentTarget: card,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
    })).toBe(true);
    expect(shouldHandleSelectionPointerUp(false, {
      button: 0,
      target: card,
      currentTarget: card,
      shiftKey: false,
      clientX: 0,
      clientY: 0,
    })).toBe(false);

    const escape = resolveSelectionHotkey({ key: 'Escape', ctrlKey: false, metaKey: false });
    const selectAll = resolveSelectionHotkey({ key: 'a', ctrlKey: true, metaKey: false });
    expect(escape && selectionHotkeyPreventsDefault(escape)).toBe(false);
    expect(selectAll && selectionHotkeyPreventsDefault(selectAll)).toBe(true);

    expect(createSelectionHoldState('b1', 10, 20, 99)).toEqual({
      blockId: 'b1',
      timer: 99,
      x: 10,
      y: 20,
    });
    expect(transcriptBlockIds([textBlock({ id: 'a' }), textBlock({ id: 'b' })])).toEqual(['a', 'b']);
    card.remove();
  });

  it('applies transcript chrome side effects through handlers', () => {
    const handlers = {
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      onRegenerate: vi.fn(),
      onApprovalDecision: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    };

    applyTranscriptChromeSideEffects([
      { type: 'copy', text: 'x' },
      { type: 'softHide', blockIds: ['a'] },
      {
        type: 'composer',
        actions: [{ type: 'setText', text: 'hi' }],
        focusComposer: true,
      },
      { type: 'regenerate', blockId: 'a' },
      {
        type: 'approval',
        decision: { approvalId: 'req', decision: 'allow' },
      },
      { type: 'pulse', blockId: 'a' },
      { type: 'toast', message: 'done' },
      { type: 'exitSelection' },
    ], handlers);

    expect(handlers.copyText).toHaveBeenCalledWith('x');
    expect(handlers.softHideBlocks).toHaveBeenCalledWith(['a']);
    expect(handlers.dispatchComposer).toHaveBeenCalledWith({ type: 'setText', text: 'hi' });
    expect(handlers.focusComposer).toHaveBeenCalledOnce();
    expect(handlers.onRegenerate).toHaveBeenCalledWith('a');
    expect(handlers.onApprovalDecision).toHaveBeenCalledWith({
      approvalId: 'req',
      decision: 'allow',
    });
    expect(handlers.pulseBlock).toHaveBeenCalledWith('a');
    expect(handlers.showWorkbenchToast).toHaveBeenCalledWith('done');
    expect(handlers.exitSelection).toHaveBeenCalledOnce();
  });

  it('builds residual selection snapshots without undefined optionals', () => {
    expect(createExitSelectionSnapshot()).toEqual({
      selectionMode: false,
      selectedBlockIds: [],
    });
    expect(createEnterSelectionSnapshot('b1')).toEqual({
      selectionMode: true,
      selectedBlockIds: ['b1'],
    });
    expect(createResetSelectionSnapshot()).toEqual({
      contextMenu: null,
      selectionMode: false,
      selectedBlockIds: [],
      actionedBlockIds: [],
      softHiddenBlockIds: [],
    });
  });

  it('plans residual block select/hold/pointer-up flows', () => {
    const card = document.createElement('div');
    document.body.append(card);
    const transcript = [
      textBlock({ id: 'a' }),
      textBlock({ id: 'b' }),
      textBlock({ id: 'c' }),
    ];

    expect(planBlockSelect('b', false, transcript, ['a'])).toEqual({
      type: 'toggle',
      blockId: 'b',
    });
    expect(planBlockSelect('c', true, transcript, ['a'])).toEqual({
      type: 'range',
      rangeIds: ['a', 'b', 'c'],
    });
    expect(planBlockSelect('missing', true, transcript, ['missing-2'])).toEqual({
      type: 'toggle',
      blockId: 'missing',
    });

    expect(planBeginHoldSelection('b1', {
      button: 1,
      target: card,
      currentTarget: card,
      shiftKey: false,
      clientX: 1,
      clientY: 2,
    })).toEqual({ type: 'ignore' });
    expect(planBeginHoldSelection('b1', {
      button: 0,
      target: card,
      currentTarget: card,
      shiftKey: false,
      clientX: 1,
      clientY: 2,
    })).toEqual({
      type: 'begin',
      blockId: 'b1',
      clientX: 1,
      clientY: 2,
      delayMs: SELECTION_HOLD_DELAY_MS,
    });

    expect(planUpdateHoldSelection(null, 0, 0)).toEqual({ type: 'noop' });
    expect(planUpdateHoldSelection({ x: 0, y: 0 }, 0, 0)).toEqual({ type: 'noop' });
    expect(planUpdateHoldSelection({ x: 0, y: 0 }, 100, 0)).toEqual({ type: 'cancel' });

    expect(planBlockPointerUp('b1', {
      suppressPointerUp: true,
      selectionMode: true,
      event: {
        button: 0,
        target: card,
        currentTarget: card,
        shiftKey: false,
        clientX: 0,
        clientY: 0,
      },
    })).toEqual({ type: 'consumeSuppress' });
    expect(planBlockPointerUp('b1', {
      suppressPointerUp: false,
      selectionMode: false,
      event: {
        button: 0,
        target: card,
        currentTarget: card,
        shiftKey: true,
        clientX: 0,
        clientY: 0,
      },
    })).toEqual({ type: 'noop' });
    expect(planBlockPointerUp('b1', {
      suppressPointerUp: false,
      selectionMode: true,
      event: {
        button: 0,
        target: card,
        currentTarget: card,
        shiftKey: true,
        clientX: 0,
        clientY: 0,
      },
    })).toEqual({ type: 'select', blockId: 'b1', shiftKey: true });

    card.remove();
  });

  it('disposes timers, schedules pulse/toast, and applies hotkey plans', () => {
    vi.useFakeTimers();
    const holdRef = {
      current: createSelectionHoldState('b1', 1, 2, window.setTimeout(() => {}, 1000) as unknown as number),
    };
    disposeSelectionHoldRef(holdRef);
    expect(holdRef.current).toBeNull();

    const toastTimerRef = { current: null as number | null };
    const pulseTimers = new Map<string, number>();
    const onHide = vi.fn();
    const onPulseEnd = vi.fn();
    scheduleWorkbenchToastTimer(toastTimerRef, onHide, 50);
    schedulePulseTimer(pulseTimers, 'b1', onPulseEnd, 50);
    expect(toastTimerRef.current).not.toBeNull();
    expect(pulseTimers.has('b1')).toBe(true);

    vi.advanceTimersByTime(50);
    expect(onHide).toHaveBeenCalledOnce();
    expect(onPulseEnd).toHaveBeenCalledOnce();
    expect(pulseTimers.has('b1')).toBe(false);

    toastTimerRef.current = window.setTimeout(() => {}, 1000);
    pulseTimers.set('x', window.setTimeout(() => {}, 1000));
    disposeToastAndPulseTimers(toastTimerRef, { current: pulseTimers });
    expect(toastTimerRef.current).toBeNull();
    expect(pulseTimers.size).toBe(0);

    clearTimeoutIfSet(null);
    clearPulseTimers(new Map([['a', window.setTimeout(() => {}, 1000)]]));

    const clearSelection = vi.fn();
    const selectAll = vi.fn();
    const runMultiAction = vi.fn();
    const plan = planSelectionHotkeyEffect(
      { key: 'Escape', ctrlKey: false, metaKey: false },
      [textBlock({ id: 'a' })],
    );
    expect(plan).not.toBeNull();
    if (plan) applySelectionHotkeyPlan(plan, { clearSelection, selectAll, runMultiAction });
    expect(clearSelection).toHaveBeenCalledOnce();

    const selectAllPlan = planSelectionHotkeyEffect(
      { key: 'a', ctrlKey: true, metaKey: false },
      [textBlock({ id: 'a' }), textBlock({ id: 'b' })],
    );
    if (selectAllPlan) {
      applySelectionHotkeyPlan(selectAllPlan, { clearSelection, selectAll, runMultiAction });
    }
    expect(selectAll).toHaveBeenCalledWith(['a', 'b']);

    const deletePlan = planSelectionHotkeyEffect(
      { key: 'Delete', ctrlKey: false, metaKey: false },
      [textBlock({ id: 'a' })],
    );
    if (deletePlan) {
      applySelectionHotkeyPlan(deletePlan, { clearSelection, selectAll, runMultiAction });
    }
    expect(runMultiAction).toHaveBeenCalledWith('delete');

    const holdStarted = vi.fn();
    const holdRef2 = { current: null as ReturnType<typeof createSelectionHoldState> | null };
    beginSelectionHold(holdRef2, {
      type: 'begin',
      blockId: 'b9',
      clientX: 3,
      clientY: 4,
      delayMs: 20,
    }, holdStarted);
    expect(holdRef2.current?.blockId).toBe('b9');
    vi.advanceTimersByTime(20);
    expect(holdStarted).toHaveBeenCalledOnce();
    expect(holdRef2.current).toBeNull();

    const element = {
      getBoundingClientRect: () => ({ left: 10, width: 200 } as DOMRect),
    };
    expect(resolveSelectBarRectFromElement(element)).toEqual({ left: 10, width: 200 });
    expect(resolveSelectBarRectFromElement(null)).toBeNull();

    writeClipboardText('clipboard-safe');
    vi.useRealTimers();
  });

  it('creates a residual transcript chrome controller for selection/toast flows', () => {
    const writers = {
      setContextMenu: vi.fn(),
      setSelectionMode: vi.fn(),
      setSelectedBlockIds: vi.fn((value: string[] | ((current: string[]) => string[])) => {
        if (typeof value === 'function') value(['a']);
      }),
      setActionedBlockIds: vi.fn(),
      setSoftHiddenBlockIds: vi.fn(),
      setSelectBarRect: vi.fn(),
      setToastMessage: vi.fn(),
      setToastVisible: vi.fn(),
    };
    const refs = {
      selectionModeRef: { current: false },
      selectionHoldRef: { current: null },
      suppressSelectionPointerUpRef: { current: false },
      runMultiActionRef: { current: null as ((action: string) => void) | null },
      toastTimerRef: { current: null as number | null },
      pulseTimersRef: { current: new Map<string, number>() },
    };
    const controller = createTranscriptChromeController({
      refs,
      writers,
      getTranscript: () => [textBlock({ id: 'a', text: 'Alpha' }), textBlock({ id: 'b', text: 'Beta' })],
      getSelectedBlockIds: () => ['a'],
      t,
      dispatchComposer: vi.fn(),
      composerInputRef: { current: null },
    });

    controller.showWorkbenchToast('hello');
    expect(writers.setToastMessage).toHaveBeenCalledWith('hello');
    expect(writers.setToastVisible).toHaveBeenCalledWith(true);

    controller.exitSelection();
    expect(writers.setSelectionMode).toHaveBeenCalledWith(false);
    expect(writers.setSelectedBlockIds).toHaveBeenCalledWith([]);

    controller.enterSelection('b');
    expect(refs.selectionModeRef.current).toBe(true);
    expect(writers.setSelectedBlockIds).toHaveBeenCalledWith(['b']);

    controller.handleBlockSelect('b');
    expect(writers.setSelectedBlockIds).toHaveBeenCalled();

    controller.resetSelection();
    expect(writers.setContextMenu).toHaveBeenCalledWith(null);

    const multi = controller.multiSelectActions();
    expect(multi.map((action) => action.label)).toContain('bar.selectAll');
    expect(controller.contextMenuGroups('a').flat().map((item) => item.label)).toContain('context.copy');

    controller.handleSelectionHotkey({
      key: 'Escape',
      ctrlKey: false,
      metaKey: false,
      preventDefault: vi.fn(),
    });
    expect(writers.setSelectionMode).toHaveBeenCalledWith(false);

    controller.disposeSelectionHold();
    controller.disposeTimers();
  });

  it('passes conversations into the context menu builder for the forward picker (#1385)', () => {
    const refs = {
      selectionModeRef: { current: false },
      selectionHoldRef: { current: null },
      suppressSelectionPointerUpRef: { current: false },
      runMultiActionRef: { current: null },
      toastTimerRef: { current: null },
      pulseTimersRef: { current: new Map<string, number>() },
    };
    const writers = {
      setContextMenu: vi.fn(),
      setSelectionMode: vi.fn(),
      setSelectedBlockIds: vi.fn(),
      setActionedBlockIds: vi.fn(),
      setSoftHiddenBlockIds: vi.fn(),
      setSelectBarRect: vi.fn(),
      setToastMessage: vi.fn(),
      setToastVisible: vi.fn(),
    };
    const controller = createTranscriptChromeController({
      refs,
      writers,
      getTranscript: () => [textBlock({ id: 'a', text: 'Alpha' })],
      getSelectedBlockIds: () => [],
      t,
      dispatchComposer: vi.fn(),
      composerInputRef: { current: null },
    });

    // Without conversations there is no real forward path, so the entry is
    // omitted instead of keeping a placeholder-toast action (#1818).
    const plain = controller.contextMenuGroups('a');
    const plainForward = plain[0]?.find((item) => item.label === 'context.forward');
    expect(plainForward).toBeUndefined();

    // With conversations the forward item gains the picker submenu.
    const conversations: Array<{ id: string; title: string; kind: 'direct' | 'group' }> = [
      { id: 's1', title: '需求', kind: 'direct' },
    ];
    const withPicker = controller.contextMenuGroups('a', conversations);
    const forwardItem = withPicker[0]?.find((item) => item.label === 'context.forward');
    expect(forwardItem?.chevron).toBe(true);
    expect(typeof forwardItem?.submenu).toBe('function');
  });
});
