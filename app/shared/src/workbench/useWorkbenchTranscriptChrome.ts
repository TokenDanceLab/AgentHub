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
  SELECTION_HOLD_CANCEL_DISTANCE,
  SELECTION_HOLD_DELAY_MS,
  blockTitle,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  cardActionLabel,
  isNestedInteractiveTarget,
  multiActionLabel,
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
      if (event.key === 'Escape') {
        setSelectionMode(false);
        setSelectedBlockIds([]);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedBlockIds(transcript.map((block) => block.id));
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        runMultiActionRef.current?.('copy');
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        runMultiActionRef.current?.('delete');
      }
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
      const rect = workspaceRef.current?.getBoundingClientRect();
      if (!rect) return;
      setSelectBarRect({
        left: rect.left,
        width: rect.width,
      });
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
    toastTimerRef.current = window.setTimeout(() => setToastVisible(false), 1700);
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
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    setActionedBlockIds((current) => (
      current.includes(blockId) ? current : [...current, blockId]
    ));
    const timerId = window.setTimeout(() => {
      setActionedBlockIds((current) => current.filter((id) => id !== blockId));
      pulseTimersRef.current.delete(blockId);
    }, 900);
    pulseTimersRef.current.set(blockId, timerId);
  }, []);

  const blockTitleById = useCallback((blockId: string): string => {
    const block = transcript.find((item) => item.id === blockId);
    return block ? blockTitle(block, t) : t('mainchain.selectedCard');
  }, [t, transcript]);

  const openBlockContextMenu = useCallback((
    block: TranscriptBlock,
    event: TranscriptContextMenuEvent,
  ): void => {
    event.preventDefault();
    setContextMenu({
      blockId: block.id,
      title: blockTitle(block, t),
      x: event.clientX,
      y: event.clientY,
    });
  }, [t]);

  const selectBlock = useCallback((blockId: string): void => {
    setSelectedBlockIds((current) => (
      current.includes(blockId)
        ? current.filter((id) => id !== blockId)
        : [...current, blockId]
    ));
  }, []);

  const selectRangeTo = useCallback((blockId: string): void => {
    const selectedIndexes = selectedBlockIds
      .map((id) => transcript.findIndex((block) => block.id === id))
      .filter((index) => index >= 0);
    const anchorIndex = selectedIndexes.length
      ? selectedIndexes[selectedIndexes.length - 1]!
      : transcript.findIndex((block) => block.id === blockId);
    const targetIndex = transcript.findIndex((block) => block.id === blockId);

    if (anchorIndex < 0 || targetIndex < 0) {
      selectBlock(blockId);
      return;
    }

    const [from, to] = anchorIndex < targetIndex
      ? [anchorIndex, targetIndex]
      : [targetIndex, anchorIndex];
    const rangeIds = transcript.slice(from, to + 1).map((block) => block.id);
    setSelectionMode(true);
    setSelectedBlockIds((current) => Array.from(new Set([...current, ...rangeIds])));
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
    if (event.button !== 0 || isNestedInteractiveTarget(event.target, event.currentTarget)) return;
    clearSelectionHold();
    selectionHoldRef.current = {
      blockId: block.id,
      timer: window.setTimeout(() => {
        enterSelection(block.id);
        suppressSelectionPointerUpRef.current = true;
        selectionHoldRef.current = null;
      }, SELECTION_HOLD_DELAY_MS),
      x: event.clientX,
      y: event.clientY,
    };
  }, [clearSelectionHold, enterSelection]);

  const updateBlockHoldSelection = useCallback((event: TranscriptPointerEvent): void => {
    const hold = selectionHoldRef.current;
    if (!hold) return;
    const dx = Math.abs(event.clientX - hold.x);
    const dy = Math.abs(event.clientY - hold.y);
    if (dx > SELECTION_HOLD_CANCEL_DISTANCE || dy > SELECTION_HOLD_CANCEL_DISTANCE) {
      clearSelectionHold();
    }
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
    if (
      !selectionModeRef.current
      || event.button !== 0
      || isNestedInteractiveTarget(event.target, event.currentTarget)
    ) {
      return;
    }
    handleBlockSelect(block.id, { shiftKey: event.shiftKey });
  }, [clearSelectionHold, handleBlockSelect]);

  const runContextAction = useCallback((action: string, blockId: string): void => {
    const title = blockTitleById(blockId);
    const block = transcript.find((item) => item.id === blockId);
    if (action === 'copy') copyText(title);
    if (action === 'link') copyText(`agenthub://card/${blockId}`);
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => (
        current.includes(blockId) ? current : [...current, blockId]
      ));
    }
    if (action === 'reply' && block) {
      dispatchComposer({
        type: 'setReplyTo',
        replyTo: {
          messageId: blockId,
          author: block.author.name,
          preview: title,
        },
      });
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    }
    if (action === 'quote' && block && block.kind === 'text') {
      const selectedText = window.getSelection()?.toString().trim();
      const quoteText = selectedText || block.text.slice(0, 80);
      const quoted = `> ${quoteText.split('\n').join('\n> ')}\n\n`;
      dispatchComposer({ type: 'setText', text: quoted });
      dispatchComposer({
        type: 'setQuote',
        quote: {
          text: quoteText,
          author: block.author.name,
          messageId: block.id,
        },
      });
      window.setTimeout(() => composerInputRef.current?.focus(), 0);
    }
    if (action === 'regenerate' && block && block.kind === 'text' && block.author.role === 'agent') {
      // Mark old message as having a newer version so it renders grayed out
      setSoftHiddenBlockIds((current) => {
        const next = new Set(current);
        next.add(block.id);
        return Array.from(next);
      });
      onRegenerate?.(blockId);
      pulseBlock(blockId);
      showWorkbenchToast(cardActionLabel(action, title, t));
      return;
    }
    pulseBlock(blockId);
    showWorkbenchToast(cardActionLabel(action, title, t));
  }, [
    blockTitleById,
    composerInputRef,
    copyText,
    dispatchComposer,
    onRegenerate,
    pulseBlock,
    showWorkbenchToast,
    t,
    transcript,
  ]);

  const handleTranscriptBlockAction = useCallback((
    action: string,
    blockId: string,
    metadata?: Record<string, unknown>,
  ): void => {
    const block = transcript.find((b) => b.id === blockId);
    if (!block) return;

    if (action === 'approve' || action === 'deny') {
      // Approval blocks carry PermissionRequestTranscriptBlock data
      if (block.kind === 'permission_request') {
        const decision: ApprovalDecisionAction = {
          approvalId: block.requestId,
          decision: action === 'approve' ? 'allow' : 'deny',
          ...(block.teamId !== undefined ? { teamId: block.teamId } : {}),
          ...(block.teamRunId !== undefined ? { teamRunId: block.teamRunId } : {}),
          ...(block.agentTaskId !== undefined ? { agentTaskId: block.agentTaskId } : {}),
          ...(block.targetId !== undefined ? { targetId: block.targetId } : {}),
          ...(block.edgeDeviceId !== undefined ? { edgeDeviceId: block.edgeDeviceId } : {}),
          ...(block.correlationId !== undefined ? { correlationId: block.correlationId } : {}),
        };
        onApprovalDecision?.(decision);
        pulseBlock(blockId);
        showWorkbenchToast(action === 'approve' ? t('action.approved') : t('action.denied'));
      }
    }

    if (action === 'retry' || action === 'regenerate') {
      // Retry a failed agent message -- dispatch regeneration
      if (block.kind === 'text' && block.author.role === 'agent') {
        setSoftHiddenBlockIds((current) => {
          const next = new Set(current);
          next.add(block.id);
          return Array.from(next);
        });
        onRegenerate?.(blockId);
        pulseBlock(blockId);
        showWorkbenchToast(t('action.regenerating'));
      }
    }

    if (action === 'copy') {
      const title = (metadata?.text as string) || blockTitle(block, t);
      copyText(title);
      pulseBlock(blockId);
      showWorkbenchToast(cardActionLabel('copy', title, t));
    }
  }, [
    copyText,
    onApprovalDecision,
    onRegenerate,
    pulseBlock,
    showWorkbenchToast,
    t,
    transcript,
  ]);

  const runMultiAction = useCallback((action: string): void => {
    const count = selectedBlockIds.length;
    if (!count) {
      showWorkbenchToast(t('toast.noCardSelected'));
      return;
    }
    if (action === 'copy') {
      copyText(selectedBlockIds.map(blockTitleById).join('\n'));
    }
    if (action === 'delete') {
      setSoftHiddenBlockIds((current) => {
        const next = new Set(current);
        selectedBlockIds.forEach((id) => next.add(id));
        return Array.from(next);
      });
      setSelectionMode(false);
      setSelectedBlockIds([]);
    }
    showWorkbenchToast(multiActionLabel(action, count, t));
  }, [blockTitleById, copyText, selectedBlockIds, showWorkbenchToast, t]);

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
      onSelectAll: () => setSelectedBlockIds(transcript.map((block) => block.id)),
      onClear: () => setSelectedBlockIds([]),
      onMultiAction: runMultiAction,
      onExit: () => {
        setSelectionMode(false);
        setSelectedBlockIds([]);
      },
    })
  ), [runMultiAction, t, transcript]);

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
