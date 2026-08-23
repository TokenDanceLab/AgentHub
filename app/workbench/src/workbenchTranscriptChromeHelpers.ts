import type { ComposerAction } from '@shared/composer';
import type { WorkbenchConversation } from '@shared/platform';
import type { ApprovalDecisionAction, TranscriptBlock } from '@shared/transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
import {
  applyTranscriptChromeSideEffects,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  createTranscriptChromeEffectHandlers,
  planConfirmMultiDelete,
  planContextAction,
  planMultiAction,
  planTranscriptBlockAction,
  type DeleteConfirmRequest,
  type TranscriptChromeEffectHandlers,
} from './workbenchTranscriptChromeActionMappers';
import {
  buildContextMenuState,
  type TranscriptChromeTranslate,
  type WorkbenchContextMenuState,
} from './workbenchTranscriptChromeLabels';
import {
  applySelectionHotkeyPlan,
  beginSelectionHold,
  createEnterSelectionSnapshot,
  createExitSelectionSnapshot,
  createResetSelectionSnapshot,
  disposeSelectionHoldRef,
  disposeToastAndPulseTimers,
  focusComposerInput,
  mergeSoftHiddenBlockIds,
  nextActionedBlockIdsOnPulseEnd,
  nextActionedBlockIdsOnPulseStart,
  nextSelectedBlockIdsOnRange,
  nextSelectedBlockIdsOnToggle,
  planBeginHoldSelection,
  planBlockPointerUp,
  planBlockSelect,
  planSelectionHotkeyEffect,
  planUpdateHoldSelection,
  resolveSelectBarRectFromElement,
  schedulePulseTimer,
  scheduleWorkbenchToastTimer,
  transcriptBlockIds,
  writeClipboardText,
  type SelectBarRect,
  type SelectionHoldState,
  type TranscriptPointerLike,
} from './workbenchTranscriptChromeStateHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchTranscriptChromeHelpers — residual controller host + public
   re-export barrel for transcript chrome pure slices (#615, #627, #650,
   #755).

   Label maps, selection/state helpers, and action/menu mappers live in
   workbenchTranscriptChromeLabels / StateHelpers / ActionMappers.
   This module keeps the controller factory and stable public exports.
   No React hooks / no intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export {
  SELECTION_HOLD_DELAY_MS,
  SELECTION_HOLD_CANCEL_DISTANCE,
  WORKBENCH_TOAST_MS,
  WORKBENCH_PULSE_MS,
  QUOTE_PREVIEW_MAX_CHARS,
  isNestedInteractiveTarget,
  blockTitle,
  resolveBlockTitleById,
  cardActionLabel,
  multiActionLabel,
  cardLinkForBlock,
  buildContextMenuState,
  resolveSelectionHotkey,
  resolveQuoteText,
  buildQuoteComposerText,
  buildPermissionApprovalDecision,
  type WorkbenchContextMenuState,
  type TranscriptChromeTranslate,
  type SelectionHotkeyCommand,
} from './workbenchTranscriptChromeLabels';

export {
  toggleIdInList,
  addIdIfMissing,
  mergeUniqueIds,
  removeIdFromList,
  resolveSelectionRangeIds,
  shouldCancelSelectionHold,
  selectBarRectFromWorkspace,
  shouldBeginHoldSelection,
  shouldHandleSelectionPointerUp,
  selectionHotkeyPreventsDefault,
  createSelectionHoldState,
  transcriptBlockIds,
  createExitSelectionSnapshot,
  createEnterSelectionSnapshot,
  createResetSelectionSnapshot,
  writeClipboardText,
  clearTimeoutIfSet,
  clearSelectionHoldTimer,
  clearPulseTimers,
  disposeSelectionHoldRef,
  disposeToastAndPulseTimers,
  scheduleWorkbenchToastTimer,
  schedulePulseTimer,
  planBeginHoldSelection,
  beginSelectionHold,
  planUpdateHoldSelection,
  planBlockPointerUp,
  planBlockSelect,
  planSelectionHotkeyEffect,
  applySelectionHotkeyPlan,
  deferFocus,
  focusComposerInput,
  resolveSelectBarRectFromElement,
  mergeSoftHiddenBlockIds,
  nextActionedBlockIdsOnPulseStart,
  nextActionedBlockIdsOnPulseEnd,
  nextSelectedBlockIdsOnToggle,
  nextSelectedBlockIdsOnRange,
  resolveShiftSelectRange,
  type TranscriptPointerLike,
  type SelectionHoldState,
  type SelectBarRect,
  type ExitSelectionSnapshot,
  type EnterSelectionSnapshot,
  type ResetSelectionSnapshot,
  type BeginHoldSelectionPlan,
  type UpdateHoldSelectionPlan,
  type BlockPointerUpPlan,
  type BlockSelectPlan,
  type SelectionHotkeyPlan,
} from './workbenchTranscriptChromeStateHelpers';

export {
  planContextAction,
  planTranscriptBlockAction,
  planMultiAction,
  planConfirmMultiDelete,
  createTranscriptChromeEffectHandlers,
  applyTranscriptChromeSideEffects,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  type TranscriptChromeSideEffect,
  type TranscriptChromeEffectHandlers,
  type DeleteConfirmRequest,
  type BuildTranscriptContextMenuGroupsOptions,
  type BuildTranscriptMultiSelectActionsOptions,
} from './workbenchTranscriptChromeActionMappers';

/* ── residual controller factory (#650 / #755) ───────────────────────── */

export interface TranscriptChromeMutableRefs {
  selectionModeRef: { current: boolean };
  selectionHoldRef: { current: SelectionHoldState | null };
  suppressSelectionPointerUpRef: { current: boolean };
  runMultiActionRef: { current: ((action: string) => void) | null };
  toastTimerRef: { current: number | null };
  pulseTimersRef: { current: Map<string, number> };
  /**
   * #1823: pending destructive multi-delete snapshot. Lives in a ref (owned
   * by the hook, passed in here) so it outlives controller re-creation —
   * the controller is built inside a useMemo whose deps can change while
   * the confirm dialog stays mounted on React state.
   */
  deleteConfirmRef: { current: DeleteConfirmRequest | null };
}

export interface TranscriptChromeStateWriters {
  setContextMenu: (value: WorkbenchContextMenuState | null) => void;
  setSelectionMode: (value: boolean) => void;
  setSelectedBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setActionedBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setSoftHiddenBlockIds: (
    value: string[] | ((current: string[]) => string[]),
  ) => void;
  setSelectBarRect: (value: SelectBarRect | null) => void;
  setToastMessage: (value: string) => void;
  setToastVisible: (value: boolean) => void;
  /** #1823: destructive multi-delete confirm-gate state (snapshot or none). */
  setDeleteConfirmPending: (value: DeleteConfirmRequest | null) => void;
}

export interface TranscriptChromeControllerDeps {
  refs: TranscriptChromeMutableRefs;
  writers: TranscriptChromeStateWriters;
  getTranscript: () => TranscriptBlock[];
  getSelectedBlockIds: () => string[];
  t: TranscriptChromeTranslate;
  dispatchComposer: (action: ComposerAction) => void;
  composerInputRef: { current: { focus: () => void } | null };
  onRegenerate?: ((blockId: string) => Promise<void> | void) | undefined;
  onApprovalDecision?: ((decision: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  /**
   * Hub session id for REST message actions (#1383). Absent on Desktop/demo
   * shells — the react/pin/unpin/recall menu entries are omitted there and
   * their planners return no effects (#1818).
   */
  sessionId?: string | null | undefined;
  onPinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onUnpinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined;
  onRecallMessage?: ((messageId: string) => Promise<void> | void) | undefined;
  onAddMessageReaction?: ((messageId: string, sessionId: string, emoji: string) => Promise<void> | void) | undefined;
}

export interface TranscriptChromeController {
  showWorkbenchToast: (message: string) => void;
  copyText: (text: string) => void;
  pulseBlock: (blockId: string) => void;
  softHideBlocks: (blockIds: string[]) => void;
  exitSelection: () => void;
  enterSelection: (blockId: string) => void;
  resetSelection: () => void;
  openBlockContextMenu: (
    block: TranscriptBlock,
    event: { preventDefault: () => void; clientX: number; clientY: number },
  ) => void;
  handleBlockSelect: (blockId: string, event?: { shiftKey?: boolean }) => void;
  beginBlockHoldSelection: (block: TranscriptBlock, event: TranscriptPointerLike) => void;
  updateBlockHoldSelection: (event: TranscriptPointerLike) => void;
  handleBlockPointerUp: (block: TranscriptBlock, event: TranscriptPointerLike) => void;
  handleTranscriptBlockAction: (
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ) => void;
  runContextAction: (action: string, blockId: string) => void;
  runMultiAction: (action: string) => void;
  /** #1823: executes the confirmed destructive multi-delete (soft-hide). */
  confirmMultiDelete: () => void;
  /** #1823: dismisses the pending delete confirm without deleting. */
  cancelDeleteConfirm: () => void;
  handleSelectionHotkey: (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }) => void;
  updateSelectBarRect: (
    element: { getBoundingClientRect: () => DOMRect } | null | undefined,
  ) => void;
  disposeSelectionHold: () => void;
  disposeTimers: () => void;
  contextMenuGroups: (
    blockId: string,
    conversations?: WorkbenchConversation[],
  ) => Array<Array<ContextMenuItem>>;
  multiSelectActions: () => Array<MultiSelectBarAction>;
  effectHandlers: () => TranscriptChromeEffectHandlers;
}

export function createTranscriptChromeController(
  deps: TranscriptChromeControllerDeps,
): TranscriptChromeController {
  const { refs, writers, getTranscript, getSelectedBlockIds, t } = deps;

  // #1823: the delete confirm snapshot lives in refs.deleteConfirmRef (owned
  // by the hook) — it must outlive controller re-creation. The controller is
  // built inside a useMemo whose deps (t, handlers) can change while the
  // confirm dialog stays mounted on React state; a closure copy would reset
  // to null and confirmMultiDelete could then act on the live selection.
  const pendingDeleteRequest = (): DeleteConfirmRequest | null => refs.deleteConfirmRef.current;

  const showWorkbenchToast = (message: string): void => {
    writers.setToastMessage(message);
    writers.setToastVisible(true);
    scheduleWorkbenchToastTimer(refs.toastTimerRef, () => writers.setToastVisible(false));
  };

  const copyText = (text: string): void => {
    writeClipboardText(text);
  };

  const pulseBlock = (blockId: string): void => {
    writers.setActionedBlockIds((current) => nextActionedBlockIdsOnPulseStart(current, blockId));
    schedulePulseTimer(refs.pulseTimersRef.current, blockId, () => {
      writers.setActionedBlockIds((current) => nextActionedBlockIdsOnPulseEnd(current, blockId));
    });
  };

  const softHideBlocks = (blockIds: string[]): void => {
    writers.setSoftHiddenBlockIds((current) => mergeSoftHiddenBlockIds(current, blockIds));
  };

  const exitSelection = (): void => {
    const snapshot = createExitSelectionSnapshot();
    refs.deleteConfirmRef.current = null;
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
    writers.setDeleteConfirmPending(null);
  };

  const enterSelection = (blockId: string): void => {
    const snapshot = createEnterSelectionSnapshot(blockId);
    refs.selectionModeRef.current = snapshot.selectionMode;
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
  };

  const resetSelection = (): void => {
    const snapshot = createResetSelectionSnapshot();
    refs.deleteConfirmRef.current = null;
    writers.setContextMenu(snapshot.contextMenu);
    writers.setSelectionMode(snapshot.selectionMode);
    writers.setSelectedBlockIds(snapshot.selectedBlockIds);
    writers.setActionedBlockIds(snapshot.actionedBlockIds);
    writers.setSoftHiddenBlockIds(snapshot.softHiddenBlockIds);
    writers.setDeleteConfirmPending(null);
  };

  const effectHandlers = (): TranscriptChromeEffectHandlers => createTranscriptChromeEffectHandlers({
    copyText,
    softHideBlocks,
    dispatchComposer: deps.dispatchComposer,
    focusComposer: () => focusComposerInput(deps.composerInputRef),
    onRegenerate: deps.onRegenerate,
    onApprovalDecision: deps.onApprovalDecision,
    onRequestDeleteConfirm: (request) => {
      // #1823: store a private clone in the hook-owned ref — confirmMultiDelete
      // must act on this snapshot, not on whatever the live selection holds
      // at confirm time, and the snapshot must survive controller re-creation.
      const snapshot = { count: request.count, blockIds: [...request.blockIds] };
      refs.deleteConfirmRef.current = snapshot;
      writers.setDeleteConfirmPending(snapshot);
    },
    onPinMessage: deps.onPinMessage,
    onUnpinMessage: deps.onUnpinMessage,
    onForwardMessage: deps.onForwardMessage,
    onRecallMessage: deps.onRecallMessage,
    onAddMessageReaction: deps.onAddMessageReaction,
    pulseBlock,
    showWorkbenchToast,
    exitSelection,
  });

  const openBlockContextMenu = (
    block: TranscriptBlock,
    event: { preventDefault: () => void; clientX: number; clientY: number },
  ): void => {
    event.preventDefault();
    writers.setContextMenu(buildContextMenuState(block, event.clientX, event.clientY, t));
  };

  const handleBlockSelect = (blockId: string, event?: { shiftKey?: boolean }): void => {
    const plan = planBlockSelect(
      blockId,
      event?.shiftKey,
      getTranscript(),
      getSelectedBlockIds(),
    );
    if (plan.type === 'toggle') {
      writers.setSelectedBlockIds((current) => nextSelectedBlockIdsOnToggle(current, plan.blockId));
      return;
    }
    writers.setSelectionMode(true);
    writers.setSelectedBlockIds((current) => nextSelectedBlockIdsOnRange(current, plan.rangeIds));
  };

  const beginBlockHoldSelection = (
    block: TranscriptBlock,
    event: TranscriptPointerLike,
  ): void => {
    const plan = planBeginHoldSelection(block.id, event);
    if (plan.type === 'ignore') return;
    beginSelectionHold(refs.selectionHoldRef, plan, () => {
      enterSelection(block.id);
      refs.suppressSelectionPointerUpRef.current = true;
    });
  };

  const updateBlockHoldSelection = (event: TranscriptPointerLike): void => {
    const plan = planUpdateHoldSelection(
      refs.selectionHoldRef.current,
      event.clientX,
      event.clientY,
    );
    if (plan.type === 'cancel') disposeSelectionHoldRef(refs.selectionHoldRef);
  };

  const handleBlockPointerUp = (
    block: TranscriptBlock,
    event: TranscriptPointerLike,
  ): void => {
    disposeSelectionHoldRef(refs.selectionHoldRef);
    const plan = planBlockPointerUp(block.id, {
      suppressPointerUp: refs.suppressSelectionPointerUpRef.current,
      selectionMode: refs.selectionModeRef.current,
      event,
    });
    if (plan.type === 'consumeSuppress') {
      refs.suppressSelectionPointerUpRef.current = false;
      return;
    }
    if (plan.type === 'select') {
      handleBlockSelect(plan.blockId, { shiftKey: plan.shiftKey });
    }
  };

  const runContextAction = (action: string, blockId: string): void => {
    applyTranscriptChromeSideEffects(planContextAction({
      action,
      blockId,
      transcript: getTranscript(),
      t,
      selectedText: window.getSelection()?.toString() ?? null,
      ...(deps.sessionId ? { sessionId: deps.sessionId } : {}),
    }), effectHandlers());
  };

  const handleTranscriptBlockAction = (
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ): void => {
    applyTranscriptChromeSideEffects(planTranscriptBlockAction({
      action,
      blockId,
      transcript: getTranscript(),
      t,
      ...(metadata !== undefined ? { metadata } : {}),
    }), effectHandlers());
  };

  const runMultiAction = (action: string): void => {
    applyTranscriptChromeSideEffects(planMultiAction({
      action,
      selectedBlockIds: getSelectedBlockIds(),
      transcript: getTranscript(),
      t,
    }), effectHandlers());
  };

  // #1823: the destructive multi-delete runs only after the user confirmed
  // the inline prompt (SelectionDeleteConfirm). planMultiAction('delete')
  // just raises the confirm gate; this applies the soft-hide plan against
  // the blockIds snapshot captured when the gate was raised — the live
  // selection may have changed in the meantime (e.g. Ctrl/⌘+A). With no
  // pending request this is a strict no-op: never fall back to the live
  // selection (the dialog only mounts while a request is pending).
  const confirmMultiDelete = (): void => {
    const request = pendingDeleteRequest();
    if (!request) return;
    refs.deleteConfirmRef.current = null;
    writers.setDeleteConfirmPending(null);
    applyTranscriptChromeSideEffects(planConfirmMultiDelete({
      selectedBlockIds: request.blockIds,
      transcript: getTranscript(),
      t,
    }), effectHandlers());
  };

  const cancelDeleteConfirm = (): void => {
    refs.deleteConfirmRef.current = null;
    writers.setDeleteConfirmPending(null);
  };

  const handleSelectionHotkey = (event: {
    key: string;
    ctrlKey: boolean;
    metaKey: boolean;
    preventDefault: () => void;
  }): void => {
    const plan = planSelectionHotkeyEffect(event, getTranscript());
    if (!plan) return;
    if (plan.preventDefault) event.preventDefault();
    applySelectionHotkeyPlan(plan, {
      clearSelection: exitSelection,
      selectAll: (ids) => writers.setSelectedBlockIds(ids),
      runMultiAction: (action) => refs.runMultiActionRef.current?.(action),
    });
  };

  const updateSelectBarRect = (
    element: { getBoundingClientRect: () => DOMRect } | null | undefined,
  ): void => {
    const next = resolveSelectBarRectFromElement(element);
    if (!next) return;
    writers.setSelectBarRect(next);
  };

  return {
    showWorkbenchToast,
    copyText,
    pulseBlock,
    softHideBlocks,
    exitSelection,
    enterSelection,
    resetSelection,
    openBlockContextMenu,
    handleBlockSelect,
    beginBlockHoldSelection,
    updateBlockHoldSelection,
    handleBlockPointerUp,
    handleTranscriptBlockAction,
    runContextAction,
    runMultiAction,
    confirmMultiDelete,
    cancelDeleteConfirm,
    handleSelectionHotkey,
    updateSelectBarRect,
    disposeSelectionHold: () => disposeSelectionHoldRef(refs.selectionHoldRef),
    disposeTimers: () => disposeToastAndPulseTimers(refs.toastTimerRef, refs.pulseTimersRef),
    contextMenuGroups: (blockId: string, conversations?: WorkbenchConversation[]) => buildTranscriptContextMenuGroups({
      blockId,
      transcript: getTranscript(),
      t,
      onAction: runContextAction,
      onEnterSelection: enterSelection,
      // Hub REST message entries (react/pin/unpin/recall) render only with
      // a session; Desktop/demo shells get an honest, shorter menu (#1818).
      hubMessageActions: Boolean(deps.sessionId),
      ...(conversations !== undefined ? { conversations } : {}),
    }),
    multiSelectActions: () => buildTranscriptMultiSelectActions({
      t,
      onSelectAll: () => writers.setSelectedBlockIds(transcriptBlockIds(getTranscript())),
      onClear: () => writers.setSelectedBlockIds([]),
      onMultiAction: runMultiAction,
      onExit: exitSelection,
    }),
    effectHandlers,
  };
}
