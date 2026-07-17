import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { ComposerAction } from '../composer';
import type { ApprovalDecisionAction, TranscriptBlock } from '../transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
import type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
import {
  SELECTION_HOLD_DELAY_MS,
  WORKBENCH_PULSE_MS,
  WORKBENCH_TOAST_MS,
  applyTranscriptChromeSideEffects,
  buildContextMenuState,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  createSelectionHoldState,
  createTranscriptChromeEffectHandlers,
  deferFocus,
  mergeSoftHiddenBlockIds,
  nextActionedBlockIdsOnPulseEnd,
  nextActionedBlockIdsOnPulseStart,
  nextSelectedBlockIdsOnRange,
  nextSelectedBlockIdsOnToggle,
  planContextAction,
  planMultiAction,
  planSelectionHotkeyEffect,
  planTranscriptBlockAction,
  resolveShiftSelectRange,
  selectBarRectFromWorkspace,
  shouldBeginHoldSelection,
  shouldCancelSelectionHold,
  shouldHandleSelectionPointerUp,
  transcriptBlockIds,
  type WorkbenchContextMenuState,
} from './workbenchTranscriptChromeHelpers';

export {
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  blockTitle,
  isNestedInteractiveTarget,
  type WorkbenchContextMenuState,
} from './workbenchTranscriptChromeHelpers';

export interface UseWorkbenchTranscriptChromeOptions {
  transcript: TranscriptBlock[];
  t: (key: string, options?: Record<string, unknown>) => string;
  onApprovalDecision?: ((action: ApprovalDecisionAction) => Promise<void> | void) | undefined;
  onRegenerate?: ((blockId: string) => void) | undefined;
  dispatchComposer: Dispatch<ComposerAction>;
  composerInputRef: RefObject<HTMLTextAreaElement | null>;
  workspaceRef: RefObject<HTMLElement | null>;
  inspectorCollapsed: boolean;
  inspectorWidth: number;
}

export interface WorkbenchTranscriptChrome {
  selectionMode: boolean;
  selectedBlockIds: string[];
  softHiddenBlockIds: string[];
  actionedBlockIds: string[];
  contextMenu: WorkbenchContextMenuState | null;
  setContextMenu: Dispatch<React.SetStateAction<WorkbenchContextMenuState | null>>;
  toastMessage: string;
  toastVisible: boolean;
  selectBarRect: { left: number; width: number } | null;
  multiSelectActions: Array<MultiSelectBarAction>;
  contextMenuGroups: (blockId: string) => Array<Array<ContextMenuItem>>;
  showWorkbenchToast: (message: string) => void;
  openBlockContextMenu: (block: TranscriptBlock, event: TranscriptContextMenuEvent) => void;
  handleBlockSelect: (blockId: string, event?: { shiftKey?: boolean }) => void;
  handleTranscriptBlockAction: (
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ) => void;
  beginBlockHoldSelection: (block: TranscriptBlock, event: TranscriptPointerEvent) => void;
  updateBlockHoldSelection: (event: TranscriptPointerEvent) => void;
  handleBlockPointerUp: (block: TranscriptBlock, event: TranscriptPointerEvent) => void;
  copyText: (text: string) => void;
  resetSelection: () => void;
  selectionModeRef: MutableRefObject<boolean>;
}

export function useWorkbenchTranscriptChrome({
  transcript,
  t,
  onApprovalDecision,
  onRegenerate,
  dispatchComposer,
  composerInputRef,
  workspaceRef,
  inspectorCollapsed,
  inspectorWidth,
}: UseWorkbenchTranscriptChromeOptions): WorkbenchTranscriptChrome {
  const [contextMenu, setContextMenu] = useState<WorkbenchContextMenuState | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [actionedBlockIds, setActionedBlockIds] = useState<string[]>([]);
  const [softHiddenBlockIds, setSoftHiddenBlockIds] = useState<string[]>([]);
  const [selectBarRect, setSelectBarRect] = useState<{ left: number; width: number } | null>(null);
  const [toastMessage, setToastMessage] = useState('');
  const [toastVisible, setToastVisible] = useState(false);

  const selectionModeRef = useRef(false);
  const selectionHoldRef = useRef<{
    blockId: string;
    timer: number | null;
    x: number;
    y: number;
  } | null>(null);
  const suppressSelectionPointerUpRef = useRef(false);
  const runMultiActionRef = useRef<((action: string) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pulseTimersRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  useEffect(() => {
    if (!selectionMode) return;

    function handleSelectionKey(event: KeyboardEvent): void {
      const plan = planSelectionHotkeyEffect(event, transcript);
      if (!plan) return;
      if (plan.preventDefault) event.preventDefault();
      if (plan.type === 'clearSelection') {
        setSelectionMode(false);
        setSelectedBlockIds([]);
        return;
      }
      if (plan.type === 'selectAll') {
        setSelectedBlockIds(plan.selectedBlockIds);
        return;
      }
      runMultiActionRef.current?.(plan.action);
    }

    document.addEventListener('keydown', handleSelectionKey);
    return () => document.removeEventListener('keydown', handleSelectionKey);
  }, [selectedBlockIds, selectionMode, transcript]);

  useEffect(() => () => {
    if (selectionHoldRef.current?.timer) {
      window.clearTimeout(selectionHoldRef.current.timer);
    }
    selectionHoldRef.current = null;
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    pulseTimersRef.current.forEach((id) => window.clearTimeout(id));
    pulseTimersRef.current.clear();
  }, []);

  useEffect(() => {
    if (!selectionMode) return;

    function updateSelectBarRect(): void {
      const next = selectBarRectFromWorkspace(workspaceRef.current?.getBoundingClientRect());
      if (!next) return;
      setSelectBarRect(next);
    }

    updateSelectBarRect();
    window.addEventListener('resize', updateSelectBarRect);
    return () => window.removeEventListener('resize', updateSelectBarRect);
  }, [selectionMode, inspectorCollapsed, inspectorWidth, workspaceRef]);

  const showWorkbenchToast = useCallback((message: string): void => {
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToastMessage(message);
    setToastVisible(true);
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), WORKBENCH_TOAST_MS);
  }, []);

  const copyText = useCallback((text: string): void => {
    try {
      navigator.clipboard?.writeText?.(text)?.catch?.(() => {});
    } catch {
      // Clipboard is optional in local preview and test environments.
    }
  }, []);

  const pulseBlock = useCallback((blockId: string): void => {
    const existing = pulseTimersRef.current.get(blockId);
    if (existing !== undefined) window.clearTimeout(existing);
    setActionedBlockIds((current) => nextActionedBlockIdsOnPulseStart(current, blockId));
    const timerId = window.setTimeout(() => {
      setActionedBlockIds((current) => nextActionedBlockIdsOnPulseEnd(current, blockId));
      pulseTimersRef.current.delete(blockId);
    }, WORKBENCH_PULSE_MS);
    pulseTimersRef.current.set(blockId, timerId);
  }, []);

  const softHideBlocks = useCallback((blockIds: string[]): void => {
    setSoftHiddenBlockIds((current) => mergeSoftHiddenBlockIds(current, blockIds));
  }, []);

  const exitSelection = useCallback((): void => {
    setSelectionMode(false);
    setSelectedBlockIds([]);
  }, []);

  const effectHandlers = useMemo(() => createTranscriptChromeEffectHandlers({
    copyText,
    softHideBlocks,
    dispatchComposer,
    focusComposer: () => deferFocus(() => composerInputRef.current?.focus()),
    onRegenerate,
    onApprovalDecision,
    pulseBlock,
    showWorkbenchToast,
    exitSelection,
  }), [
    composerInputRef,
    copyText,
    dispatchComposer,
    exitSelection,
    onApprovalDecision,
    onRegenerate,
    pulseBlock,
    showWorkbenchToast,
    softHideBlocks,
  ]);

  const openBlockContextMenu = useCallback((
    block: TranscriptBlock,
    event: TranscriptContextMenuEvent,
  ): void => {
    event.preventDefault();
    setContextMenu(buildContextMenuState(block, event.clientX, event.clientY, t));
  }, [t]);

  const selectBlock = useCallback((blockId: string): void => {
    setSelectedBlockIds((current) => nextSelectedBlockIdsOnToggle(current, blockId));
  }, []);

  const selectRangeTo = useCallback((blockId: string): void => {
    const plan = resolveShiftSelectRange(transcript, selectedBlockIds, blockId);
    if (plan.mode === 'toggle') {
      selectBlock(plan.blockId);
      return;
    }
    setSelectionMode(true);
    setSelectedBlockIds((current) => nextSelectedBlockIdsOnRange(current, plan.rangeIds));
  }, [selectBlock, selectedBlockIds, transcript]);

  const handleBlockSelect = useCallback((blockId: string, event?: { shiftKey?: boolean }): void => {
    if (event?.shiftKey) {
      selectRangeTo(blockId);
      return;
    }
    selectBlock(blockId);
  }, [selectBlock, selectRangeTo]);

  const resetSelection = useCallback((): void => {
    setContextMenu(null);
    setSelectionMode(false);
    setSelectedBlockIds([]);
    setActionedBlockIds([]);
    setSoftHiddenBlockIds([]);
  }, []);

  const enterSelection = useCallback((blockId: string): void => {
    selectionModeRef.current = true;
    setSelectionMode(true);
    setSelectedBlockIds([blockId]);
  }, []);

  const clearSelectionHold = useCallback((): void => {
    if (selectionHoldRef.current?.timer) {
      window.clearTimeout(selectionHoldRef.current.timer);
    }
    selectionHoldRef.current = null;
  }, []);

  const beginBlockHoldSelection = useCallback((
    block: TranscriptBlock,
    event: TranscriptPointerEvent,
  ): void => {
    if (!shouldBeginHoldSelection(event)) return;
    clearSelectionHold();
    selectionHoldRef.current = createSelectionHoldState(
      block.id,
      event.clientX,
      event.clientY,
      window.setTimeout(() => {
        enterSelection(block.id);
        suppressSelectionPointerUpRef.current = true;
        selectionHoldRef.current = null;
      }, SELECTION_HOLD_DELAY_MS),
    );
  }, [clearSelectionHold, enterSelection]);

  const updateBlockHoldSelection = useCallback((event: TranscriptPointerEvent): void => {
    const hold = selectionHoldRef.current;
    if (!hold) return;
    if (shouldCancelSelectionHold(hold, event.clientX, event.clientY)) clearSelectionHold();
  }, [clearSelectionHold]);

  const handleBlockPointerUp = useCallback((
    block: TranscriptBlock,
    event: TranscriptPointerEvent,
  ): void => {
    clearSelectionHold();
    if (suppressSelectionPointerUpRef.current) {
      suppressSelectionPointerUpRef.current = false;
      return;
    }
    if (!shouldHandleSelectionPointerUp(selectionModeRef.current, event)) return;
    handleBlockSelect(block.id, { shiftKey: event.shiftKey });
  }, [clearSelectionHold, handleBlockSelect]);

  const runContextAction = useCallback((action: string, blockId: string): void => {
    applyTranscriptChromeSideEffects(planContextAction({
      action,
      blockId,
      transcript,
      t,
      selectedText: window.getSelection()?.toString() ?? null,
    }), effectHandlers);
  }, [effectHandlers, t, transcript]);

  const handleTranscriptBlockAction = useCallback((
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ): void => {
    applyTranscriptChromeSideEffects(planTranscriptBlockAction({
      action,
      blockId,
      transcript,
      t,
      ...(metadata !== undefined ? { metadata } : {}),
    }), effectHandlers);
  }, [effectHandlers, t, transcript]);

  const runMultiAction = useCallback((action: string): void => {
    applyTranscriptChromeSideEffects(planMultiAction({
      action,
      selectedBlockIds,
      transcript,
      t,
    }), effectHandlers);
  }, [effectHandlers, selectedBlockIds, t, transcript]);

  runMultiActionRef.current = runMultiAction;

  const contextMenuGroups = useCallback((blockId: string): Array<Array<ContextMenuItem>> => (
    buildTranscriptContextMenuGroups({
      blockId,
      transcript,
      t,
      onAction: runContextAction,
      onEnterSelection: enterSelection,
    })
  ), [enterSelection, runContextAction, t, transcript]);

  const multiSelectActions = useMemo<Array<MultiSelectBarAction>>(() => (
    buildTranscriptMultiSelectActions({
      t,
      onSelectAll: () => setSelectedBlockIds(transcriptBlockIds(transcript)),
      onClear: () => setSelectedBlockIds([]),
      onMultiAction: runMultiAction,
      onExit: exitSelection,
    })
  ), [exitSelection, runMultiAction, t, transcript]);

  return {
    selectionMode,
    selectedBlockIds,
    softHiddenBlockIds,
    actionedBlockIds,
    contextMenu,
    setContextMenu,
    toastMessage,
    toastVisible,
    selectBarRect,
    multiSelectActions,
    contextMenuGroups,
    showWorkbenchToast,
    openBlockContextMenu,
    handleBlockSelect,
    handleTranscriptBlockAction,
    beginBlockHoldSelection,
    updateBlockHoldSelection,
    handleBlockPointerUp,
    copyText,
    resetSelection,
    selectionModeRef,
  };
}
