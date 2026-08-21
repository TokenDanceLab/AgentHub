import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptBlock, TextTranscriptBlock } from '@shared/transcript';
import { isSidebarOnlyTranscriptBlock, orderTranscriptBlocks } from '@shared/transcript';
import type { ComposerIntent, ComposerMention } from '@shared/composer';
import { buildComposerIntent, composerReducer, createInitialComposerState } from '@shared/composer';
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
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type { AttachmentUploadState } from './UnifiedComposer';
import type { FileItem } from './inspector';
import type { ConnectionStatusKind } from './GlobalRail';
import { ChatViewBridge } from './ChatViewBridge';
import { MainchainStatusStrip } from './MainchainStatusStrip';
import type { MainchainSummary } from './mainchain';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkspaceHeader } from './WorkspaceHeader';
import type { UnreadDividerDescriptor } from '@shared/chatview';
import MessageSearchPanel from './MessageSearchPanel';
import { PageErrorBoundary } from './PageErrorBoundary';
import { useComposerSubmitBehavior } from './workbenchPreferences';
import styles from './AgentHubWorkbench.module.css';

export type { MainchainSummary } from './mainchain';

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
}: ConversationHostProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, AttachmentUploadState>>({});
  const [pendingUserBlocks, setPendingUserBlocks] = useState<PendingUserBlock[]>([]);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const composerSubmitBehavior = useComposerSubmitBehavior();

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
    // queued intent after the user has switched away (drop silently; same
    // as the pre-queue behavior of losing the dispatch opportunity).
    if (head.intent.conversationId !== currentConversationId) {
      mutatePendingIntents((current) => removePendingIntent(current, head));
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
      onToast(err instanceof Error ? err.message : t('toast.dispatchRetryFailed'));
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
        onToast(err instanceof Error ? err.message : t('toast.editFailed'));
      } finally {
        isSubmittingRef.current = false;
      }
      return;
    }

    let optimisticId: string | undefined;
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
      let enrichedAttachments = capturedAttachments;
      if (pendingAttachments.length > 0 && platform.attachments?.uploadAttachment) {
        const uploadPort = platform.attachments;
        for (const a of pendingAttachments) {
          if (!a.file) continue;
          try {
            setUploadProgresses((prev) => ({ ...prev, [a.id]: { percent: 5, phase: 'hashing' } }));
            const ref = await uploadPort.uploadAttachment(a.file);
            setUploadProgresses((prev) => ({ ...prev, [a.id]: { percent: 100, phase: 'done' } }));
            enrichedAttachments = enrichedAttachments.map((x) => x.id === a.id ? { ...x, attachmentRef: ref } : x);
          } catch { setUploadProgresses((prev) => { const n = { ...prev }; Reflect.deleteProperty(n, a.id); return n; }); }
        }
      }
      const finalIntent = enrichedAttachments.length > 0 ? { ...intentWithLiveText, attachments: enrichedAttachments } : intentWithLiveText;
      const submitPayload = { ...finalIntent, ...(selectedExecutionTargetId ? { executionTargetId: selectedExecutionTargetId } : {}) };
      const submitResult = await platform.runs.submitComposerIntent(submitPayload);
      dispatchComposer({ type: 'setSubmitState', submitState: 'idle' });
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
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
      setUploadProgresses({});
      onToast(err instanceof Error ? err.message : t('toast.submitFailed'));
    } finally { isSubmittingRef.current = false; }
  }, [composer, currentConversationId, platform, selectedExecutionTargetId, isAgentRunning,
    onToast, dispatchComposer, t, transcript, onEditMessage, mutatePendingIntents, flushPendingIntents]);

  const handleSearchJump = useCallback((id: string) => { onSearchOpenChange(false); setSearchHighlightId(id); }, [onSearchOpenChange]);
  const handleSearchHighlightEnd = useCallback(() => { setSearchHighlightId(null); onHighlightEnd?.(); }, [onHighlightEnd]);
  const resolvedHighlight = searchHighlightId ?? highlightedBlockId ?? undefined;

  return (
    <>
      <WorkspaceHeader activeConversation={activeConversation}
        inspectorCollapsed={inspectorCollapsed} onToggleInspector={onToggleInspector} onOpenSearch={() => onSearchOpenChange(true)} />
      {showMainchainStatus && <MainchainStatusStrip summary={mainchainSummary} onExportEvidence={onExportMainchainEvidence} />}
      <div className={styles.transcriptRegion} role="region" aria-label={t('aria.transcript')}>
        <ChatViewBridge displayTranscript={displayTranscript} activeConversation={activeConversation}
          unreadDivider={transcriptUnreadDivider}
          onAgentClick={onAgentClick} onBlockContextMenu={onBlockContextMenu}
          onBlockSelect={onBlockSelect} onBlockAction={onBlockAction}
          onReviewFile={onReviewFile} onDeploySubmit={onDeploySubmit}
          selectedBlockIds={selectedBlockIds} selectionMode={selectionMode}
          softHiddenBlockIds={softHiddenBlockIds} actionedBlockIds={actionedBlockIds}
          highlightedBlockId={resolvedHighlight} onHighlightEnd={handleSearchHighlightEnd}
          connectionStatus={connectionStatus} dismissedPinnedIds={dismissedPinnedIds} onToast={onToast} />
      </div>
      <MessageSearchPanel open={searchOpen} onClose={() => onSearchOpenChange(false)}
        onJumpToMessage={handleSearchJump} highlightMessageId={searchHighlightId}
        onHighlightEnd={handleSearchHighlightEnd} transcriptBlocks={displayTranscript}
        searchLabel="搜索消息" searchPlaceholder="搜索消息内容..." noResultsLabel="未找到匹配的消息" />
      {!selectionMode && (
        <>
          {pendingIntentsRef.current.length > 0 && (
            <div className={styles.pendingIntentBadge} role="status">
              {t('toast.pendingDispatchBadge', { count: pendingIntentsRef.current.length })}
            </div>
          )}
          <PageErrorBoundary>
            <UnifiedComposer composer={composer} dispatchComposer={dispatchComposer}
              executionTargets={composerExecutionTargets} executionTargetId={selectedExecutionTargetId}
              inputRef={composerInputRef} mentionableAgents={showComposerAgentPicker ? mentionableAgents : EMPTY_MENTIONS}
              onExecutionTargetChange={onExecutionTargetChange} onPickLocalAttachments={platform.attachments?.pickFiles}
              onSubmit={submitComposer} status={showComposerStatus ? workbenchStatus : undefined}
              submitBehavior={composerSubmitBehavior} targetLabel={composerTargetLabel} uploadProgresses={uploadProgresses}
              isRunning={isAgentRunning} onCancel={onCancelRun} onToast={onToast} />
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
