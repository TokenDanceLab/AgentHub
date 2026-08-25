import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { TranscriptBlock, TextTranscriptBlock } from '@shared/transcript';
import {
  collectRunReviewFiles,
  isSidebarOnlyTranscriptBlock,
  orderTranscriptBlocks,
  summarizeRunReviewFiles,
} from '@shared/transcript';
import { RunReviewOverlay } from '@shared/ui';
import type { ComposerIntent, ComposerMention } from '@shared/composer';
import {
  buildComposerIntent,
  captureComposerDraft,
  composerReducer,
  createInitialComposerState,
} from '@shared/composer';
import {
  handleDocumentDragLeave,
  handleDocumentDragOver,
  handleDocumentDrop,
  type ComposerDocumentFileDropCallbacks,
} from './composerDocumentFileDrop';
import {
  enqueuePendingIntent,
  MAX_PENDING_DISPATCH_RETRIES,
  markPendingIntentRetried,
  peekPendingIntent,
  PENDING_DISPATCH_RETRY_DELAY_MS,
  removePendingIntent,
  type PendingDispatchIntent,
} from './composer/pendingIntents';
import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import { AppError } from '@shared/errors';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { AttachmentUploadState } from './UnifiedComposer';
import type { FileItem } from './inspector';
import type { ConnectionStatusKind } from './GlobalRail';
import { ChatViewBridge } from './ChatViewBridge';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';
import {
  countPendingApprovals,
  firstPendingApprovalBlockId,
} from './workbenchApprovalSummary';
import type { WorkbenchAttentionCounts } from './workbenchAttentionModel';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkspaceHeader } from './WorkspaceHeader';
import type { UnreadDividerDescriptor } from '@shared/chatview';
import MessageSearchPanel from './MessageSearchPanel';
import { PageErrorBoundary } from './PageErrorBoundary';
import { useComposerSubmitBehavior } from './workbenchPreferences';
import styles from './AgentHubWorkbench.module.css';

export type { MainchainSummary } from './mainchain';

/**
 * Map a platform/API failure to user-facing toast copy (#1826).
 *
 * REST errors carry a machine code (api/conventions.md §5, surfaced as
 * `AppError.code`); the code with dedicated account copy maps to a chatview
 * toast key. Every other error falls back to the caller's fallback key so
 * English dev copy / raw server messages never reach the user; full detail
 * stays in the console for diagnosis.
 */
function toastErrorCopy(
  t: TFunction,
  error: unknown,
  fallbackKey: string,
): string {
  if (error instanceof AppError && error.code === 'turn_in_progress') {
    return t('toast.turnInProgress');
  }
  if (error instanceof Error) {
    console.error('[ConversationHost] action failed:', error.message);
  }
  return t(fallbackKey);
}

export interface ConversationHostProps {
  transcript: TranscriptBlock[];
  activeConversation?: WorkbenchConversation | undefined;
  connectionStatus?: ConnectionStatusKind | undefined;
  inspectorCollapsed: boolean; onToggleInspector: () => void;
  showMainchainStatus: boolean; mainchainSummary: MainchainSummary; onExportMainchainEvidence: () => void;
  workbenchStatus?: { dataMode?: string; replayLabel?: string; targetLabel?: string; initialLoading?: boolean; loadError?: string } | undefined;
  onAgentClick: (agentName: string, anchor: HTMLElement) => void;
  onBlockContextMenu: (blockId: string, event: React.MouseEvent) => void;
  onBlockSelect: (blockId: string, shiftKey?: boolean) => void;
  onBlockAction: (action: string, blockId: string, metadata?: Record<string, unknown>) => void;
  onReviewFile: (file: FileItem) => void;
  onDeploySubmit: (id: string) => void;
  selectedBlockIds: Set<string>; selectionMode: boolean;
  softHiddenBlockIds: Set<string>; actionedBlockIds: Set<string>;
  highlightedBlockId?: string | undefined; onHighlightEnd?: (() => void) | undefined;
  dismissedPinnedIds: Set<string>; onToast: (message: string) => void;
  composerExecutionTargets?: Array<{ id: string; label: string }> | undefined;
  selectedExecutionTargetId: string;
  onExecutionTargetChange: (id: string) => void;
  mentionableAgents: ComposerMention[];
  showComposerAgentPicker: boolean; showComposerStatus: boolean;
  composerTargetLabel: string; currentConversationId: string; platform: AgentHubPlatform;
  /** External composer state + dispatch (owned by shell for context-menu wire). */
  composer: ReturnType<typeof createInitialComposerState>;
  dispatchComposer: React.Dispatch<Parameters<typeof composerReducer>[1]>;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Search panel open/close control (owned by shell for Ctrl+F handler). */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Whether an agent run is currently active (stop button morph, #1462 CF13). */
  isAgentRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancelRun?: (() => void) | undefined;
  /**
   * Edit an already-sent message (#1462 CF16). Receives the transcript block
   * id of the message being edited plus the new content. The shell strips the
   * `hub-message-` prefix and calls `editMessage` REST.
   */
  onEditMessage?: ((blockId: string, content: string) => Promise<void> | void) | undefined;
  /**
   * Unread-messages divider descriptor (T8 desktop IM path). Passed through to
   * the ChatView; absent for non-IM transcripts.
   */
  transcriptUnreadDivider?: UnreadDividerDescriptor | undefined;
  /**
   * Transcript items are loading (#1821). With an empty transcript the chat
   * shows an honest loading state instead of the "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined;
  /**
   * Global attention counts (F6) for the status strip chips. Absent when the
   * shell provides no run/approval inventory.
   */
  attentionCounts?: WorkbenchAttentionCounts | undefined;
  /** Click-through for the strip's running chip (Tasks page queue). */
  onOpenRunningQueue?: (() => void) | undefined;
  /**
   * Click-through fallback for the strip's awaiting chip when the ACTIVE
   * conversation has no pending approval block to jump to; the frame then
   * switches to a conversation that does.
   */
  onOpenApprovalQueueFallback?: (() => void) | undefined;
}

type PendingUserBlock = TextTranscriptBlock & {
  ackBaselineCount: number;
  ackOrdinal: number;
};

/** Stable empty mention list — avoids busting the memoized UnifiedComposer
 *  with a fresh `[]` on every render when the agent picker is hidden. */
const EMPTY_MENTIONS: ComposerMention[] = [];

/**
 * Pending dispatch entry stored in the client queue (CF22). The Hub message
 * is already sent & confirmed — only task dispatch (triggerAgentTask) is
 * retried, never the message itself.
 */
type PendingDispatchIntentEntry = PendingDispatchIntent<ComposerIntent & { executionTargetId?: string }>;

export const ConversationHost = React.memo(function ConversationHost({
  transcript, activeConversation, connectionStatus, inspectorCollapsed, onToggleInspector,
  showMainchainStatus, mainchainSummary, onExportMainchainEvidence, workbenchStatus,
  onAgentClick, onBlockContextMenu, onBlockSelect, onBlockAction, onReviewFile, onDeploySubmit,
  selectedBlockIds, selectionMode, softHiddenBlockIds, actionedBlockIds,
  highlightedBlockId, onHighlightEnd, dismissedPinnedIds, onToast,
  composerExecutionTargets, selectedExecutionTargetId, onExecutionTargetChange,
  mentionableAgents, showComposerAgentPicker, showComposerStatus, composerTargetLabel,
  currentConversationId, platform,
  composer, dispatchComposer, composerInputRef,
  searchOpen, onSearchOpenChange,
  isAgentRunning, onCancelRun, onEditMessage,
  transcriptUnreadDivider,
  transcriptLoading,
  attentionCounts, onOpenRunningQueue, onOpenApprovalQueueFallback,
}: ConversationHostProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, AttachmentUploadState>>({});
  const [pendingUserBlocks, setPendingUserBlocks] = useState<PendingUserBlock[]>([]);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const composerSubmitBehavior = useComposerSubmitBehavior();

  // ── Pinned banner dismissal (#1821) ───────────────────────────────────
  // The shell owns the initial dismissed set; the host adds local dismissals
  // and keeps them even if the shell re-renders with the old set.
  const [dismissedPinnedLocal, setDismissedPinnedLocal] = useState<Set<string>>(
    () => new Set(dismissedPinnedIds),
  );
  useEffect(() => {
    setDismissedPinnedLocal((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of dismissedPinnedIds) {
        if (!next.has(id)) {
          next.add(id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
  }, [dismissedPinnedIds]);
  const handleDismissPinned = useCallback((conversationId: string): void => {
    setDismissedPinnedLocal((current) => {
      if (current.has(conversationId)) return current;
      const next = new Set(current);
      next.add(conversationId);
      return next;
    });
  }, []);

  // ── #1819 pending-approval reminder (badge + count + arrival toast) ────
  // Honest surface boundary: there is no Hub endpoint that aggregates pending
  // approvals across sessions. The badge covers the ACTIVE conversation's
  // transcript (the client-side data surface) — see workbenchApprovalSummary.
  const pendingApprovalCount = useMemo(() => countPendingApprovals(transcript), [transcript]);
  const firstPendingApprovalId = useMemo(
    () => firstPendingApprovalBlockId(transcript),
    [transcript],
  );
  // Arrival toast fires only on a NET INCREASE within the same conversation —
  // never on first mount or a conversation switch (else every session with
  // leftovers would fake an "arrival"). Reset on switch so counts do not bleed
  // across conversations.
  const pendingApprovalArrivalRef = useRef<{ conversationId: string; count: number } | null>(null);
  useEffect(() => {
    const previous = pendingApprovalArrivalRef.current;
    if (
      previous &&
      previous.conversationId === currentConversationId &&
      pendingApprovalCount > previous.count
    ) {
      onToast(t('toast.approvalPendingArrived', {
        count: String(pendingApprovalCount - previous.count),
      }));
    }
    pendingApprovalArrivalRef.current = {
      conversationId: currentConversationId,
      count: pendingApprovalCount,
    };
  }, [pendingApprovalCount, currentConversationId, onToast, t]);
  const handleApprovalJump = useCallback((): void => {
    if (!firstPendingApprovalId) return;
    // Reuses the transcript highlight path (scroll + pulse, auto-clear).
    setSearchHighlightId(firstPendingApprovalId);
    onSearchOpenChange(false);
  }, [firstPendingApprovalId, onSearchOpenChange]);
  // F6 approval chip: jump to this conversation's approval summary when it
  // has pending blocks; otherwise let the frame switch to a conversation
  // that does (global counts can originate from other sessions).
  const handleOpenApprovalQueue = useCallback((): void => {
    if (firstPendingApprovalId) {
      handleApprovalJump();
      return;
    }
    onOpenApprovalQueueFallback?.();
  }, [firstPendingApprovalId, handleApprovalJump, onOpenApprovalQueueFallback]);

  // ── #1967 run-level aggregate review entry ──────────────────────────
  // Same honest boundary as the pending-approval summary: the aggregate
  // covers the ACTIVE conversation's transcript (no Hub endpoint lists a
  // run's diff). Review state stays owned by DiffReviewPanel's existing
  // hunk machine — this surface is a read-only review until a write-back
  // port is wired (Web Hub-only: the overlay shows the honest notice).
  const runReviewFiles = useMemo(() => collectRunReviewFiles(transcript), [transcript]);
  const runReviewSummary = useMemo(
    () => summarizeRunReviewFiles(runReviewFiles),
    [runReviewFiles],
  );
  const [runReviewOpen, setRunReviewOpen] = useState(false);
  // Close the overlay on conversation switch so an aggregate never bleeds
  // across sessions (same bleed guard as the arrival-toast ref above).
  useEffect(() => {
    setRunReviewOpen(false);
  }, [currentConversationId]);
  const handleOpenRunReview = useCallback((): void => {
    setRunReviewOpen(true);
  }, []);
  const handleCloseRunReview = useCallback((): void => {
    setRunReviewOpen(false);
  }, []);

  // ── Pending dispatch queue (CF22) ──────────────────────────────────────
  // Queue is ref-authoritative (mutations are synchronous read-modify-write,
  // never split across an await) with a version tick to trigger re-renders.
  const [, bumpPendingIntentsVersion] = useState(0);
  const pendingIntentsRef = useRef<PendingDispatchIntentEntry[]>([]);
  const isAgentRunningRef = useRef(false);
  const flushInFlightRef = useRef(false);

  const mutatePendingIntents = useCallback(
    (mutate: (current: PendingDispatchIntentEntry[]) => PendingDispatchIntentEntry[]) => {
      pendingIntentsRef.current = mutate(pendingIntentsRef.current);
      bumpPendingIntentsVersion((version) => version + 1);
    },
    [],
  );

  /**
   * Retry the dispatch of the queue head (one at a time — a successful
   * dispatch makes the agent busy again, so the rest wait for the next
   * run end). Only `platform.runs.redispatchTask` is called: the message
   * itself is never re-sent.
   */
  const flushPendingIntents = useCallback(async (): Promise<void> => {
    if (flushInFlightRef.current) return;
    const redispatchTask = platform.runs.redispatchTask;
    if (!redispatchTask) return; // surface without separable dispatch: toast-only (unchanged behavior)
    // Skip while a run is active: dispatch would 409 and burn a retry. The
    // run-end transition flushes the queue at the right moment instead.
    if (isAgentRunningRef.current) return;
    const head = peekPendingIntent(pendingIntentsRef.current);
    if (!head) return;
    // The message lives in its original conversation — never dispatch a
    // queued intent after the user has switched away. Surface the drop so it
    // is not silent (#1821).
    if (head.intent.conversationId !== currentConversationId) {
      mutatePendingIntents((current) => removePendingIntent(current, head));
      onToast(t('toast.pendingDispatchDroppedOnSwitch', { defaultValue: '已切换会话，待派单任务已取消' }));
      return;
    }
    flushInFlightRef.current = true;
    try {
      const result = await redispatchTask(head.intent, head.messageId);
      mutatePendingIntents((current) => {
        const headNow = peekPendingIntent(current);
        if (!headNow || headNow.messageId !== head.messageId) return current;
        if (result.turnInProgress) {
          const { queue: nextQueue, outcome } = markPendingIntentRetried(current, headNow);
          if (outcome === 'abandoned') {
            onToast(t('toast.dispatchRetryExhausted', { max: MAX_PENDING_DISPATCH_RETRIES }));
            return nextQueue;
          }
          // Still busy — the run-end signal may have raced the Hub task
          // status; give the status a moment and try the head once more.
          if (!isAgentRunningRef.current) {
            window.setTimeout(() => void flushPendingIntents(), PENDING_DISPATCH_RETRY_DELAY_MS);
          }
          return nextQueue;
        }
        return removePendingIntent(current, headNow);
      });
    } catch (err) {
      mutatePendingIntents((current) => removePendingIntent(current, head));
      onToast(toastErrorCopy(t, err, 'toast.dispatchRetryFailed'));
    } finally {
      flushInFlightRef.current = false;
    }
  }, [platform, currentConversationId, mutatePendingIntents, onToast]);

  // Agent run reached a terminal state (run.finished / run.failed /
  // run.cancelled are folded into the shell's isAgentRunning signal) —
  // flush any queued dispatch intents.
  useEffect(() => {
    const wasRunning = isAgentRunningRef.current;
    isAgentRunningRef.current = isAgentRunning ?? false;
    if (wasRunning && !(isAgentRunning ?? false)) {
      void flushPendingIntents();
    }
  }, [isAgentRunning, flushPendingIntents]);

  const displayTranscript = useMemo(() => {
    const chat = transcript.filter((b) => !isSidebarOnlyTranscriptBlock(b));
    const unacknowledged = unacknowledgedPendingUserBlocks(chat, pendingUserBlocks);
    return orderTranscriptBlocks([
      ...chat,
      ...unacknowledged,
    ]);
  }, [transcript, pendingUserBlocks]);

  useEffect(() => {
    setPendingUserBlocks((current) => unacknowledgedPendingUserBlocks(transcript, current));
  }, [transcript]);

  /* #1822: file drag-and-drop beyond the composer form — dropping files on
     the transcript/sidebar/headers used to let the browser open the file.
     Route any Files drag anywhere outside the composer to the attachment
     chips instead. The composer's own form handlers keep precedence
     (events originating inside [data-composer-form] are skipped here). */
  const [filesDragging, setFilesDragging] = useState(false);
  // Live conversation id for the drop continuation — a ref keeps the
  // listener effect stable while always reading the current value
  // (#1853 review: switching mid-conversion must not leak attachments).
  const composerConversationIdRef = useRef(composer.conversationId);
  composerConversationIdRef.current = composer.conversationId;
  useEffect(() => {
    // Routing decisions live in composerDocumentFileDrop (unit-tested);
    // ConversationHost only owns listener registration + the dragging flag.
    const callbacks: ComposerDocumentFileDropCallbacks = {
      dispatchComposer,
      onToast,
      onDraggingChange: setFilesDragging,
      getCurrentConversationId: () => composerConversationIdRef.current,
    };
    const onDocumentDragOver = (event: DragEvent): void => handleDocumentDragOver(callbacks, event);
    const onDocumentDragLeave = (event: DragEvent): void => handleDocumentDragLeave(callbacks, event);
    const onDocumentDrop = (event: DragEvent): void => handleDocumentDrop(callbacks, event);
    document.addEventListener('dragover', onDocumentDragOver);
    document.addEventListener('dragleave', onDocumentDragLeave);
    document.addEventListener('drop', onDocumentDrop);
    return () => {
      document.removeEventListener('dragover', onDocumentDragOver);
      document.removeEventListener('dragleave', onDocumentDragLeave);
      document.removeEventListener('drop', onDocumentDrop);
    };
  }, [dispatchComposer, onToast]);

  const submitComposer = useCallback(async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSubmittingRef.current) return;
    const textarea = event.currentTarget.querySelector<HTMLTextAreaElement>('textarea[data-composer-input]');
    const liveText = textarea?.value ?? composer.text;
    if (liveText.trim().length === 0 && composer.attachments.length === 0) return;
    const capturedConversationId = currentConversationId;
    isSubmittingRef.current = true;
    dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });

    // Edit-mode branch (#1462 CF16): route submit to editMessage instead of
    // sending a new message. No optimistic pending block — the server returns
    // the updated HubMessage and the shell invalidates the messages query.
    if (composer.editingMessageId && onEditMessage) {
      const editingBlockId = composer.editingMessageId;
      const editedText = liveText.trim();
      try {
        await onEditMessage(editingBlockId, editedText);
        dispatchComposer({ type: 'resetAfterSubmit' });
        dispatchComposer({ type: 'setSubmitState', submitState: 'idle' });
      } catch (err) {
        dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
        onToast(toastErrorCopy(t, err, 'toast.editFailed'));
      } finally {
        isSubmittingRef.current = false;
      }
      return;
    }

    let optimisticId: string | undefined;
    // Snapshot the user's draft before the optimistic clear: when the submit
    // fails the content is restored so nothing is silently dropped (#1821).
    const draftSnapshot = captureComposerDraft(composer, { text: liveText.trim() });
    // Tracks upload refs written so far — the catch restores the draft with
    // them so a retry only re-uploads what actually failed.
    let enrichedAttachments = composer.attachments;
    try {
      const intent = buildComposerIntent(composer);
      const intentWithLiveText = { ...intent, text: liveText.trim(), conversationId: capturedConversationId };
      const capturedAttachments = composer.attachments;
      const pendingAttachments = capturedAttachments.filter((a) => !a.attachmentRef && a.file);
      optimisticId = `pending-user-${Date.now()}`;
      const pendingText = liveText.trim();
      const pendingUserBlock: PendingUserBlock = {
        id: optimisticId, kind: 'text', text: liveText.trim(),
        author: { id: 'user', name: 'You', role: 'human' as const }, createdAt: new Date().toISOString(),
        ackBaselineCount: countMatchingConfirmedUserBlocks(transcript, pendingText),
        ackOrdinal: 1,
        ...(composer.replyTo ? { replyToMessageId: composer.replyTo.messageId, replyPreview: composer.replyTo.preview, replyAuthor: composer.replyTo.author } : {}),
        ...(composer.quote ? { quote: composer.quote.text } : {}),
      };
      setPendingUserBlocks((current) => {
        const ackOrdinal = current.filter((pending) => pending.text.trim() === pendingText).length + 1;
        return [...current, { ...pendingUserBlock, ackOrdinal }];
      });
      dispatchComposer({ type: 'resetAfterSubmit' });
      dispatchComposer({ type: 'setSubmitState', submitState: 'submitting' });
      setUploadProgresses({});
      if (pendingAttachments.length > 0 && platform.attachments) {
        const uploadPort = platform.attachments;
        const uploadWithProgress = uploadPort.uploadAttachmentWithProgress ?? undefined;
        for (const a of pendingAttachments) {
          if (!a.file) continue;
          try {
            setUploadProgresses((prev) => ({ ...prev, [a.id]: { percent: 5, phase: 'hashing' } }));
            const ref = uploadWithProgress
              ? await uploadWithProgress(a.file, (progress) => {
                  setUploadProgresses((prev) => ({
                    ...prev,
                    [a.id]: { percent: progress.percent, phase: progress.phase },
                  }));
                })
              : await uploadPort.uploadAttachment(a.file);
            setUploadProgresses((prev) => ({ ...prev, [a.id]: { percent: 100, phase: 'done' } }));
            enrichedAttachments = enrichedAttachments.map((x) => x.id === a.id ? { ...x, attachmentRef: ref } : x);
            // Keep the composer state in sync so a restored draft keeps the refs.
            dispatchComposer({ type: 'setAttachmentRef', attachmentId: a.id, attachmentRef: ref });
          } catch {
            // Upload failed: mark the chip failed and abort the send — shipping
            // the message without the file would silently lose it (#1821).
            setUploadProgresses((prev) => ({ ...prev, [a.id]: { percent: 100, phase: 'failed' } }));
            throw new Error(`附件「${a.name}」上传失败，请重试或移除后发送`);
          }
        }
      }
      const finalIntent = enrichedAttachments.length > 0 ? { ...intentWithLiveText, attachments: enrichedAttachments } : intentWithLiveText;
      const submitPayload = { ...finalIntent, ...(selectedExecutionTargetId ? { executionTargetId: selectedExecutionTargetId } : {}) };
      const submitResult = await platform.runs.submitComposerIntent(submitPayload);
      dispatchComposer({ type: 'setSubmitState', submitState: 'idle' });
      // #1819: a send without a dispatch mention delivers the message but
      // triggers no agent task — say so explicitly instead of failing silent.
      const submittedDispatchMention = submitPayload.mentions.find(
        (mention) => mention.dispatchRole !== 'context',
      );
      if (!submittedDispatchMention) {
        onToast(t('toast.sentWithoutDispatch'));
      }
      // Recoverable 409 turn_in_progress: the Hub message was sent (SendMessage
      // is independent) but task dispatch was rejected because the agent instance
      // already has a non-terminal task (#1430). Keep the optimistic user block
      // (the message is real), restore the composer to idle, and surface an
      // info toast rather than a hard error (#1438). With a dispatch-only
      // retry port available (CF22), also enqueue the dispatch intent so the
      // agent dispatch is retried once the run ends instead of being dropped.
      if (submitResult.turnInProgress) {
        const dispatchMention = submitPayload.mentions.find((mention) => mention.dispatchRole !== 'context');
        if (dispatchMention && platform.runs.redispatchTask) {
          mutatePendingIntents((current) => enqueuePendingIntent(current, {
            agentId: dispatchMention.id,
            messageId: submitResult.intentId,
            attempt: 0,
            intent: submitPayload,
          }));
          // If no run is reported active the busy window may already be over
          // (no run-end transition will fire) — schedule a short-delayed flush.
          if (!(isAgentRunning ?? false)) {
            window.setTimeout(() => void flushPendingIntents(), PENDING_DISPATCH_RETRY_DELAY_MS);
          }
        }
        onToast(t('toast.turnInProgress'));
      }
    } catch (err) {
      if (optimisticId) {
        setPendingUserBlocks((current) => current.filter((pending) => pending.id !== optimisticId));
      }
      // Restore the user's draft (failed attachments keep their refs so a
      // retry only re-uploads what actually failed) and keep the failed
      // progress entries so the chips show the failure + retry state.
      dispatchComposer({
        type: 'restoreDraft',
        draft: {
          ...draftSnapshot,
          attachments: draftSnapshot.attachments.map((attachment) => {
            const ref = enrichedAttachments.find((enriched) => enriched.id === attachment.id)?.attachmentRef;
            return ref ? { ...attachment, attachmentRef: ref } : attachment;
          }),
        },
      });
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
      onToast(toastErrorCopy(t, err, 'toast.submitFailed'));
    } finally { isSubmittingRef.current = false; }
  }, [composer, currentConversationId, platform, selectedExecutionTargetId, isAgentRunning,
    onToast, dispatchComposer, t, transcript, onEditMessage, mutatePendingIntents, flushPendingIntents]);

  /**
   * Retry a failed attachment upload from its chip (#1821). The attachment
   * keeps its transient `file` after the failed submit, so the retry can
   * re-upload in place and write the ref back into the composer.
   */
  const retryAttachmentUpload = useCallback(async (attachmentId: string): Promise<void> => {
    const uploadPort = platform.attachments;
    const attachment = composer.attachments.find((a) => a.id === attachmentId);
    if (!uploadPort || !attachment?.file) return;
    const uploadWithProgress = uploadPort.uploadAttachmentWithProgress ?? undefined;
    setUploadProgresses((prev) => ({ ...prev, [attachmentId]: { percent: 5, phase: 'hashing' } }));
    try {
      const ref = uploadWithProgress
        ? await uploadWithProgress(attachment.file, (progress) => {
            setUploadProgresses((prev) => ({
              ...prev,
              [attachmentId]: { percent: progress.percent, phase: progress.phase },
            }));
          })
        : await uploadPort.uploadAttachment(attachment.file);
      setUploadProgresses((prev) => ({ ...prev, [attachmentId]: { percent: 100, phase: 'done' } }));
      dispatchComposer({ type: 'setAttachmentRef', attachmentId, attachmentRef: ref });
    } catch {
      setUploadProgresses((prev) => ({ ...prev, [attachmentId]: { percent: 100, phase: 'failed' } }));
      onToast(`附件「${attachment.name}」上传失败，请重试`);
    }
  }, [composer.attachments, platform, dispatchComposer, onToast]);

  const handleSearchJump = useCallback((id: string) => { onSearchOpenChange(false); setSearchHighlightId(id); }, [onSearchOpenChange]);
  const handleSearchHighlightEnd = useCallback(() => { setSearchHighlightId(null); onHighlightEnd?.(); }, [onHighlightEnd]);
  const resolvedHighlight = searchHighlightId ?? highlightedBlockId ?? undefined;

  return (
    <>
      {filesDragging && (
        <div className={styles.transcriptDropOverlay} role="status" aria-live="polite">
          {t('composer.dropToAttach', { defaultValue: '松开鼠标以添加附件' })}
        </div>
      )}
      <WorkspaceHeader activeConversation={activeConversation}
        inspectorCollapsed={inspectorCollapsed} onToggleInspector={onToggleInspector} onOpenSearch={() => onSearchOpenChange(true)} />
      {showMainchainStatus && (
        <MainchainStatusStrip
          summary={mainchainSummary}
          onExportEvidence={onExportMainchainEvidence}
          {...(attentionCounts ? { attention: attentionCounts } : {})}
          {...(onOpenRunningQueue ? { onOpenRunningQueue } : {})}
          onOpenApprovalQueue={handleOpenApprovalQueue}
        />
      )}
      {(pendingApprovalCount > 0 || runReviewFiles.length > 0) && !selectionMode && (
        <div className={styles.pendingApprovalStrip} role="status" aria-live="polite">
          {pendingApprovalCount > 0 && (
            <button
              type="button"
              className={styles.pendingApprovalJump}
              aria-label={t('card.approval.pendingBadgeAria', { count: String(pendingApprovalCount) })}
              onClick={handleApprovalJump}
            >
              <span className={styles.pendingApprovalDot} aria-hidden="true" />
              <span className={styles.pendingApprovalCount}>
                {t('card.approval.pendingBadge', { count: String(pendingApprovalCount) })}
              </span>
              <span className={styles.pendingApprovalJumpHint}>
                {t('card.approval.jumpToFirst')}
              </span>
            </button>
          )}
          {runReviewFiles.length > 0 && (
            <button
              type="button"
              className={styles.pendingApprovalReviewAll}
              aria-label={t('card.approval.viewAllChangesAria', { count: String(runReviewFiles.length) })}
              onClick={handleOpenRunReview}
            >
              {t('card.approval.viewAllChanges')}
              <span className={styles.pendingApprovalReviewCount} aria-hidden="true">
                {runReviewFiles.length}
              </span>
            </button>
          )}
        </div>
      )}
      <div className={styles.transcriptRegion} role="region" aria-label={t('aria.transcript')}>
        <ChatViewBridge displayTranscript={displayTranscript} activeConversation={activeConversation}
          unreadDivider={transcriptUnreadDivider}
          previewExternalOpenEnabled={platform.capabilities.browserPreview}
          onAgentClick={onAgentClick} onBlockContextMenu={onBlockContextMenu}
          onBlockSelect={onBlockSelect} onBlockAction={onBlockAction}
          onReviewFile={onReviewFile} onDeploySubmit={onDeploySubmit}
          selectedBlockIds={selectedBlockIds} selectionMode={selectionMode}
          softHiddenBlockIds={softHiddenBlockIds} actionedBlockIds={actionedBlockIds}
          highlightedBlockId={resolvedHighlight} onHighlightEnd={handleSearchHighlightEnd}
          connectionStatus={connectionStatus} dismissedPinnedIds={dismissedPinnedLocal}
          onDismissPinned={handleDismissPinned} onToast={onToast}
          {...(transcriptLoading !== undefined ? { transcriptLoading } : {})} />
      </div>
      <MessageSearchPanel open={searchOpen} onClose={() => onSearchOpenChange(false)}
        onJumpToMessage={handleSearchJump} highlightMessageId={searchHighlightId}
        onHighlightEnd={handleSearchHighlightEnd} transcriptBlocks={displayTranscript}
        searchLabel={t('searchPanel.label')} searchPlaceholder={t('searchPanel.placeholder')}
        noResultsLabel={t('searchPanel.noResults')} />
      {/* #1967 run-level aggregate review overlay (read-only on this surface
          until a write-back port is wired; the notice copy says so). */}
      <RunReviewOverlay
        open={runReviewOpen}
        files={runReviewFiles}
        title={t('runReview.title')}
        closeLabel={t('runReview.close')}
        summary={t('runReview.summary', {
          count: String(runReviewSummary.fileCount),
          additions: String(runReviewSummary.additions),
          deletions: String(runReviewSummary.deletions),
        })}
        readOnlyNotice={t('runReview.readOnlyNotice')}
        onClose={handleCloseRunReview}
        panelLabels={{
          empty: t('runReview.empty'),
          original: t('runReview.original'),
          modified: t('runReview.modified'),
          acceptAll: t('runReview.acceptAll'),
          rejectAll: t('runReview.rejectAll'),
          acceptHunk: t('runReview.acceptHunk'),
          rejectHunk: t('runReview.rejectHunk'),
          applied: t('runReview.applied'),
          rejected: t('runReview.rejected'),
          submitting: t('runReview.submitting'),
          runTitle: t('runReview.runTitle'),
          acceptRun: t('runReview.acceptRun'),
          rejectRun: t('runReview.rejectRun'),
        }}
      />
      {!selectionMode && (
        <>
          {pendingIntentsRef.current.length > 0 && (
            <div className={styles.pendingIntentBadge} role="status">
              {t('toast.pendingDispatchBadge', { count: pendingIntentsRef.current.length })}
              <button
                aria-label={t('toast.pendingDispatchCancel', { defaultValue: '取消待派单任务' })}
                onClick={() => {
                  mutatePendingIntents(() => []);
                  onToast(t('toast.pendingDispatchCancelled', { defaultValue: '已取消待派单任务' }));
                }}
                style={{
                  marginLeft: 8,
                  border: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  cursor: 'pointer',
                  fontSize: 12,
                  lineHeight: '20px',
                  padding: 0,
                  // The badge itself is pointer-events:none (CSS); the cancel
                  // button opts back in so the click actually lands.
                  pointerEvents: 'auto',
                }}
                type="button"
              >
                {t('toast.pendingDispatchCancelAction', { defaultValue: '取消' })}
              </button>
            </div>
          )}
          <PageErrorBoundary>
            <UnifiedComposer composer={composer} dispatchComposer={dispatchComposer}
              executionTargets={composerExecutionTargets} executionTargetId={selectedExecutionTargetId}
              inputRef={composerInputRef} mentionableAgents={showComposerAgentPicker ? mentionableAgents : EMPTY_MENTIONS}
              onExecutionTargetChange={onExecutionTargetChange} onPickLocalAttachments={platform.attachments?.pickFiles}
              onSubmit={submitComposer} status={showComposerStatus ? workbenchStatus : undefined}
              submitBehavior={composerSubmitBehavior} targetLabel={composerTargetLabel} uploadProgresses={uploadProgresses}
              isRunning={isAgentRunning} onCancel={onCancelRun} onToast={onToast}
              onRetryAttachmentUpload={retryAttachmentUpload} />
          </PageErrorBoundary>
        </>
      )}
    </>
  );
});

function unacknowledgedPendingUserBlocks(
  blocks: TranscriptBlock[],
  pendingBlocks: PendingUserBlock[],
): PendingUserBlock[] {
  return pendingBlocks.filter((pending) => {
    const pendingText = pending.text.trim();
    const matchingConfirmedCount = countMatchingConfirmedUserBlocks(blocks, pendingText);
    return !hasAcknowledgedPendingUserBlock(blocks, pending, matchingConfirmedCount);
  });
}

function hasAcknowledgedPendingUserBlock(
  blocks: TranscriptBlock[],
  pending: PendingUserBlock,
  matchingConfirmedCount: number,
): boolean {
  if (blocks.some((block) => block.id === pending.id)) return true;
  return matchingConfirmedCount >= pending.ackBaselineCount + pending.ackOrdinal;
}

function countMatchingConfirmedUserBlocks(blocks: TranscriptBlock[], text: string): number {
  return blocks.filter((block) => (
    block.kind === 'text' &&
    block.author.role === 'human' &&
    block.text.trim() === text
  )).length;
}
