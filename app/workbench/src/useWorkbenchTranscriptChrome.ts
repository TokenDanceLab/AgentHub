import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type RefObject,
} from 'react';
import type { ComposerAction } from '@shared/composer';
import type { ApprovalDecisionAction, TranscriptBlock } from '@shared/transcript';
import type { ContextMenuItem, MultiSelectBarAction } from './floating';
import type { TranscriptContextMenuEvent, TranscriptPointerEvent } from './transcriptEventTypes';
import {
  createTranscriptChromeController,
  type SelectionHoldState,
  type TranscriptChromeController,
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
  /**
   * Hub session id for REST message actions (#1383). Optional — Desktop/demo
   * shells omit it; the react/pin/unpin/recall menu entries are then hidden
   * instead of faking a success toast (#1818).
   */
  sessionId?: string | null | undefined;
  onPinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onUnpinMessage?: ((messageId: string, sessionId: string) => Promise<void> | void) | undefined;
  onForwardMessage?: ((messageId: string, targetSessionIds: string[]) => Promise<void> | void) | undefined;
  onRecallMessage?: ((messageId: string) => Promise<void> | void) | undefined;
  onAddMessageReaction?: ((messageId: string, sessionId: string, emoji: string) => Promise<void> | void) | undefined;
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
  sessionId,
  onPinMessage,
  onUnpinMessage,
  onForwardMessage,
  onRecallMessage,
  onAddMessageReaction,
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
  const selectionHoldRef = useRef<SelectionHoldState | null>(null);
  const suppressSelectionPointerUpRef = useRef(false);
  const runMultiActionRef = useRef<((action: string) => void) | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const pulseTimersRef = useRef<Map<string, number>>(new Map());
  const transcriptRef = useRef(transcript);
  const selectedBlockIdsRef = useRef(selectedBlockIds);
  const controllerRef = useRef<TranscriptChromeController | null>(null);

  transcriptRef.current = transcript;
  selectedBlockIdsRef.current = selectedBlockIds;

  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);

  const controller = useMemo(() => createTranscriptChromeController({
    refs: {
      selectionModeRef,
      selectionHoldRef,
      suppressSelectionPointerUpRef,
      runMultiActionRef,
      toastTimerRef,
      pulseTimersRef,
    },
    writers: {
      setContextMenu,
      setSelectionMode,
      setSelectedBlockIds,
      setActionedBlockIds,
      setSoftHiddenBlockIds,
      setSelectBarRect,
      setToastMessage,
      setToastVisible,
    },
    getTranscript: () => transcriptRef.current,
    getSelectedBlockIds: () => selectedBlockIdsRef.current,
    t,
    dispatchComposer,
    composerInputRef,
    onRegenerate,
    onApprovalDecision,
    ...(sessionId ? { sessionId } : {}),
    ...(onPinMessage ? { onPinMessage } : {}),
    ...(onUnpinMessage ? { onUnpinMessage } : {}),
    ...(onForwardMessage ? { onForwardMessage } : {}),
    ...(onRecallMessage ? { onRecallMessage } : {}),
    ...(onAddMessageReaction ? { onAddMessageReaction } : {}),
  }), [
    composerInputRef,
    dispatchComposer,
    onApprovalDecision,
    onAddMessageReaction,
    onForwardMessage,
    onPinMessage,
    onRecallMessage,
    onRegenerate,
    onUnpinMessage,
    sessionId,
    t,
  ]);

  controllerRef.current = controller;
  runMultiActionRef.current = controller.runMultiAction;

  useEffect(() => {
    if (!selectionMode) return;

    function handleSelectionKey(event: KeyboardEvent): void {
      controllerRef.current?.handleSelectionHotkey(event);
    }

    document.addEventListener('keydown', handleSelectionKey);
    return () => document.removeEventListener('keydown', handleSelectionKey);
  }, [selectedBlockIds, selectionMode, transcript]);

  // Match prior unmount-only dispose semantics (empty deps).
  useEffect(() => () => {
    controllerRef.current?.disposeSelectionHold();
  }, []);

  useEffect(() => () => {
    controllerRef.current?.disposeTimers();
  }, []);

  useEffect(() => {
    if (!selectionMode) return;

    function updateSelectBarRect(): void {
      controllerRef.current?.updateSelectBarRect(workspaceRef.current);
    }

    updateSelectBarRect();
    window.addEventListener('resize', updateSelectBarRect);
    return () => window.removeEventListener('resize', updateSelectBarRect);
  }, [selectionMode, inspectorCollapsed, inspectorWidth, workspaceRef]);

  const multiSelectActions = useMemo(
    () => controller.multiSelectActions(),
    [controller, t, transcript],
  );

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
    contextMenuGroups: controller.contextMenuGroups,
    showWorkbenchToast: controller.showWorkbenchToast,
    openBlockContextMenu: controller.openBlockContextMenu,
    handleBlockSelect: controller.handleBlockSelect,
    handleTranscriptBlockAction: controller.handleTranscriptBlockAction,
    beginBlockHoldSelection: controller.beginBlockHoldSelection,
    updateBlockHoldSelection: controller.updateBlockHoldSelection,
    handleBlockPointerUp: controller.handleBlockPointerUp,
    copyText: controller.copyText,
    resetSelection: controller.resetSelection,
    selectionModeRef,
  };
}
