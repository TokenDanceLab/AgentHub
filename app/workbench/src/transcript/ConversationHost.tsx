import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { orderTranscriptBlocks, selectRunReview, summarizeRunReviewFiles } from '@shared/transcript';
import { RunReviewOverlay, CheckpointPreviewOverlay, type DiffHunkDecision } from '@shared/ui';
import type { RowItem } from '@shared/chatview/types';
import { WORKBENCH_APPROVAL_JUMP_EVENT } from '../workbenchApprovalEvents';
import { WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT } from '../workbenchPreviewEvents';
import { countPendingApprovals, firstPendingApprovalBlockId } from '../workbenchApprovalSummary';
import { WorkbenchGoalBanner } from './WorkbenchGoalBanner';
import { deriveGoalSummary } from './workbenchGoalSummary';
import type { TranscriptBlock } from '@shared/transcript';
import type { ComposerMention } from '@shared/composer';
import type { ComposerAction, ComposerState } from '@shared/composer';
import type { ConversationRuntime } from '@shared/ui/assistant-ui/AssistantConversation';
import type { AgentHubPlatform, WorkbenchConversation } from '@shared/platform';
import type { FileItem } from '../inspector';
import type { ConnectionStatusKind } from '../GlobalRail';
import type { WorkbenchSplitControls } from '../workbenchFrameTypes';
import type { UnreadDividerDescriptor } from '@shared/chatview';
import { AssistantConversation } from '@shared/ui/assistant-ui/AssistantConversation';
import { WorkspaceHeader } from '../WorkspaceHeader';
import MessageSearchPanel from '../MessageSearchPanel';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from '../AgentHubWorkbench.module.css';
import { useComposerSubmitBehavior } from '../workbenchPreferences';

export type { MainchainSummary } from '../mainchain';

export interface ConversationHostProps {
  transcript: TranscriptBlock[];
  currentUserId?: string | undefined;
  activeConversation?: WorkbenchConversation | undefined;
  connectionStatus?: ConnectionStatusKind | undefined;
  inspectorCollapsed: boolean; onToggleInspector: () => void;
  workbenchStatus?: { dataMode?: string; replayLabel?: string; targetLabel?: string; initialLoading?: boolean; loadError?: string } | undefined;
  onAgentClick: (agentName: string, anchor: HTMLElement) => void;
  onConversationAvatar?: ((conversation: WorkbenchConversation, anchor: HTMLElement) => void) | undefined;
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
  composer: Pick<ComposerState, 'mode' | 'approvalMode' | 'workDir' | 'mentions'>;
  bindConversationRuntime?: (runtime: ConversationRuntime | null) => void;
  dispatchComposer: React.Dispatch<ComposerAction>;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  /** Search panel open/close control (owned by shell for Ctrl+F handler). */
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  /** Whether an agent run is currently active (stop button morph, #1462). */
  isAgentRunning?: boolean | undefined;
  /** Cancel the active agent run (stop button handler). */
  onCancelRun?: (() => void) | undefined;
  /**
   * Edit an already-sent message (#1462). Receives the transcript block
   * id of the message being edited plus the new content. The shell strips the
   * `hub-message-` prefix and calls `editMessage` REST.
   */
  onEditMessage?: ((blockId: string, content: string) => Promise<void> | void) | undefined;
  /**
   * Unread-messages divider descriptor (desktop IM path). Passed through to
   * the ChatView; absent for non-IM transcripts.
   */
  transcriptUnreadDivider?: UnreadDividerDescriptor | undefined;
  /**
   * Transcript items are loading. With an empty transcript the chat
   * shows an honest loading state instead of the "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined;
  hasEarlierMessages?: boolean | undefined;
  loadEarlierMessages?: (() => Promise<void>) | undefined;
  /** Split-view header controls (#1997); absent hides the split entry. */
  splitControls?: WorkbenchSplitControls | undefined;
}

export const ConversationHost = React.memo(function ConversationHost(props: ConversationHostProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const submitBehavior = useComposerSubmitBehavior();
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const { transcript, currentConversationId, onToast, onSearchOpenChange, platform, onCancelRun, selectionMode } = props;
  const goalSummary = useMemo(() => deriveGoalSummary(transcript), [transcript]);
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
  // #1994: the global status bar's awaiting chip dispatches this
  // transient intent; the host owns the transcript highlight/scroll.
  useEffect(() => {
    const handleApprovalJumpIntent = (event: Event): void => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail;
      if (!detail || detail.conversationId !== currentConversationId) return;
      handleApprovalJump();
    };
    window.addEventListener(WORKBENCH_APPROVAL_JUMP_EVENT, handleApprovalJumpIntent);
    return () => window.removeEventListener(WORKBENCH_APPROVAL_JUMP_EVENT, handleApprovalJumpIntent);
  }, [currentConversationId, handleApprovalJump]);

  // ── #1967 run-level aggregate review entry ──────────────────────────
  // Run evidence is the hard grouping boundary: select exactly one active/
  // latest run and never merge file changes across run ids. Legacy events
  // without run evidence use an explicitly labelled conversation fallback.
  // Apply/写回 is wired only when Edge reported a trusted run workDir in the
  // evidence AND the platform exposes the apply port (Desktop Local Edge);
  // a missing workDir or port keeps the surface honestly read-only — the
  // composer's current directory is never guessed for a historical run.
  const runReviewSelection = useMemo(
    () => selectRunReview(orderTranscriptBlocks(transcript)),
    [transcript],
  );
  const runReviewFiles = runReviewSelection.files;
  const runReviewSummary = useMemo(
    () => summarizeRunReviewFiles(runReviewFiles),
    [runReviewFiles],
  );
  const legacyRunReview = runReviewSelection.scope === 'legacy';
  const runReviewWorkDir = legacyRunReview ? undefined : runReviewSelection.workDir;
  // Evidence ref ids are `run-<runId>`; the apply port needs the raw Edge id.
  const runReviewRunId = useMemo(() => {
    const evidenceId = runReviewSelection.runEvidenceId;
    if (!evidenceId) return undefined;
    return evidenceId.startsWith('run-') ? evidenceId.slice('run-'.length) : evidenceId;
  }, [runReviewSelection.runEvidenceId]);
  const runReviewApplyPort = platform.preview?.applyAllRunDiffs;
  const canApplyRunReview = Boolean(
    !legacyRunReview && runReviewRunId && runReviewWorkDir && runReviewApplyPort,
  );
  const [runReviewOpen, setRunReviewOpen] = useState(false);
  // Close the overlay on conversation switch so an aggregate never bleeds
  // across sessions (same bleed guard as the arrival-toast ref above).
  useEffect(() => {
    setRunReviewOpen(false);
    setCheckpointPreviewRunId(null);
  }, [currentConversationId]);
  const handleOpenRunReview = useCallback((): void => {
    setRunReviewOpen(true);
  }, []);
  const handleCloseRunReview = useCallback((): void => {
    setRunReviewOpen(false);
  }, []);

  // #1968 checkpoint timeline: the run id of the previewed pre-run snapshot
  // (null = overlay closed). Read-only preview; restore is never offered.
  const [checkpointPreviewRunId, setCheckpointPreviewRunId] = useState<string | null>(null);
  const handleCheckpointClick = useCallback((item: RowItem): void => {
    if (item.checkpointRunId) setCheckpointPreviewRunId(item.checkpointRunId);
  }, []);
  const handleCloseCheckpointPreview = useCallback((): void => {
    setCheckpointPreviewRunId(null);
  }, []);

  // #1992: artifact-card click is a transient focus intent only. The
  // engineering column consumes it for the active conversation; the
  // inspector/transcript state remains untouched.
  const handleArtifactClick = useCallback((item: RowItem): void => {
    if (!item.artifactId || typeof window === 'undefined') return;
    const detail = {
      conversationId: currentConversationId,
      artifactId: item.artifactId,
      ...(item.artifactPath ? { artifactPath: item.artifactPath } : {}),
      ...(item.artifactRunId ? { artifactRunId: item.artifactRunId } : {}),
    };
    window.dispatchEvent(new CustomEvent(WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT, { detail }));
  }, [currentConversationId]);
  const handleRunReviewApplyHunk = useCallback(
    async (decision: DiffHunkDecision): Promise<void> => {
      const applyRunDiff = platform.preview?.applyRunDiff;
      if (!canApplyRunReview || !runReviewRunId || !runReviewWorkDir || !applyRunDiff) {
        // Defensive: the overlay only exposes actions when apply is wired.
        throw new Error('run review apply is not supported on this surface');
      }
      await applyRunDiff({ runId: runReviewRunId, workDir: runReviewWorkDir, decision });
    },
    [canApplyRunReview, runReviewRunId, runReviewWorkDir, platform.preview],
  );
  const handleRunReviewApplyAllHunks = useCallback(
    async (decisions: DiffHunkDecision[]): Promise<void> => {
      if (!canApplyRunReview || !runReviewRunId || !runReviewWorkDir || !runReviewApplyPort) {
        throw new Error('run review apply is not supported on this surface');
      }
      await runReviewApplyPort({ runId: runReviewRunId, workDir: runReviewWorkDir, decisions });
    },
    [canApplyRunReview, runReviewRunId, runReviewWorkDir, runReviewApplyPort],
  );
  const handleRunReviewAcceptRun = useCallback((): void => {
    onToast(t('runReview.acceptedToast'));
    setRunReviewOpen(false);
  }, [onToast, t]);
  const handleRunReviewRejectRun = useCallback((): void => {
    onToast(t('runReview.rejectedToast'));
    setRunReviewOpen(false);
  }, [onToast, t]);


  const selectedAgent = props.composer.mentions.find((mention) => mention.dispatchRole !== 'context');
  const intent = useMemo(() => ({
    conversationId: props.currentConversationId,
    mode: props.composer.mode,
    approvalMode: props.composer.approvalMode,
    mentions: props.composer.mentions,
    workDir: props.composer.workDir,
    ...(props.selectedExecutionTargetId ? { executionTargetId: props.selectedExecutionTargetId } : {}),
  }), [props.currentConversationId, props.composer.mode, props.composer.approvalMode,
    props.composer.mentions, props.composer.workDir, props.selectedExecutionTargetId]);
  const jumpToMessage = useCallback((id: string) => {
    onSearchOpenChange(false);
    setSearchHighlightId(id);
    document.getElementById(id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [onSearchOpenChange]);
  return <>
    <WorkspaceHeader activeConversation={props.activeConversation}
      inspectorCollapsed={props.inspectorCollapsed} onToggleInspector={props.onToggleInspector}
      onOpenSearch={() => props.onSearchOpenChange(true)} {...(props.splitControls ? { splitControls: props.splitControls } : {})} />
      {goalSummary && (
        <WorkbenchGoalBanner summary={goalSummary} onCancelRun={onCancelRun} />
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
              aria-label={t(legacyRunReview
                ? 'card.approval.viewLegacyChangesAria'
                : canApplyRunReview
                  ? 'card.approval.viewAllChangesApplyAria'
                  : 'card.approval.viewAllChangesAria', { count: String(runReviewFiles.length) })}
              onClick={handleOpenRunReview}
            >
              {t(legacyRunReview
                ? 'card.approval.viewLegacyChanges'
                : 'card.approval.viewAllChanges')}
              <span className={styles.pendingApprovalReviewCount} aria-hidden="true">
                {runReviewFiles.length}
              </span>
            </button>
          )}
        </div>
      )}
    <div className={styles.transcriptRegion} role="region" aria-label={t('aria.transcript')}>
      {props.activeConversation?.pinnedAnnouncement && !props.dismissedPinnedIds.has(props.currentConversationId) &&
        <div className="border-b px-4 py-2 text-sm" role="note">{props.activeConversation.pinnedAnnouncement.content}</div>}
      <AssistantConversation key={props.currentConversationId}
        conversationId={props.currentConversationId} transcript={props.transcript.filter((block) => !props.softHiddenBlockIds.has(block.id))}
        platform={props.platform} intent={intent} onRuntime={props.bindConversationRuntime}
        currentUserId={props.currentUserId} onEdit={props.onEditMessage} inputRef={props.composerInputRef}
        submitMode={submitBehavior === 'ctrl-enter-send' ? 'ctrlEnter' : 'enter'}
        onContextMenu={props.onBlockContextMenu} onSelect={props.onBlockSelect}
        onAuthorClick={(author, anchor) => {
          if (author.role === 'agent') props.onAgentClick(author.name, anchor);
          else props.onConversationAvatar?.({ id: author.id, title: author.name, kind: 'direct' }, anchor);
        }}
        selectedIds={props.selectedBlockIds} selectionMode={props.selectionMode}
        hasEarlier={props.hasEarlierMessages} onLoadEarlier={props.loadEarlierMessages}
        isLoading={props.transcriptLoading} isDisabled={!props.activeConversation}
        isSendDisabled={Boolean(selectedAgent && props.composerExecutionTargets && !props.selectedExecutionTargetId)}
        isRunning={props.isAgentRunning} onCancel={props.onCancelRun}
        onEvidenceAction={props.onBlockAction}
        onArtifactClick={handleArtifactClick} onCheckpointClick={handleCheckpointClick}
        welcome={t('conversationHost.startConversation', { defaultValue: '开始对话' })}
        controls={<>
          {props.showComposerAgentPicker && <div className="flex flex-wrap items-center gap-2 px-2 text-sm">
            <select aria-label="@Agent" className="rounded-md border bg-background px-2 py-1"
              value={selectedAgent?.id ?? ''} onChange={(event) => {
                if (selectedAgent) props.dispatchComposer({ type: 'removeMention', mentionId: selectedAgent.id });
                const agent = props.mentionableAgents.find((item) => item.id === event.target.value);
                if (agent) props.dispatchComposer({ type: 'addMention', mention: agent });
              }}>
              <option value="">{t('composer.messageOnly', { defaultValue: '仅发送消息' })}</option>
              {props.mentionableAgents.map((agent) => <option key={agent.id} value={agent.id} disabled={agent.status === 'unavailable'}>{agent.label}</option>)}
            </select>
            {selectedAgent && props.composerExecutionTargets && <select aria-label={t('composer.executionTarget', { defaultValue: '执行目标' })}
              className="rounded-md border bg-background px-2 py-1" value={props.selectedExecutionTargetId}
              onChange={(event) => props.onExecutionTargetChange(event.target.value)}>
              <option value="">{t('composer.selectTarget', { defaultValue: '选择执行设备' })}</option>
              {props.composerExecutionTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}
            </select>}
          </div>}
        </>} />
    </div>
      {/* #1967 run review: accept/reject is wired only with a trusted
          executor-reported workDir plus the platform apply port; every other
          combination stays honestly read-only with a reason-specific notice. */}
      <RunReviewOverlay
        open={runReviewOpen}
        files={runReviewFiles}
        title={t(canApplyRunReview
          ? 'runReview.titleApplicable'
          : legacyRunReview ? 'runReview.legacyTitle' : 'runReview.title')}
        closeLabel={t('runReview.close')}
        summary={t('runReview.summary', {
          count: String(runReviewSummary.fileCount),
          additions: String(runReviewSummary.additions),
          deletions: String(runReviewSummary.deletions),
        })}
        readOnly={!canApplyRunReview}
        {...(canApplyRunReview ? {
          runId: runReviewRunId,
          onApplyHunk: handleRunReviewApplyHunk,
          onApplyAllHunks: handleRunReviewApplyAllHunks,
          onAcceptRun: handleRunReviewAcceptRun,
          onRejectRun: handleRunReviewRejectRun,
        } : {
          readOnlyNotice: t(legacyRunReview
            ? 'runReview.legacyReadOnlyNotice'
            : runReviewWorkDir
              ? 'runReview.webReadOnlyNotice'
              : 'runReview.noWorkDirNotice'),
        })}
        onClose={handleCloseRunReview}
        panelLabels={{
          empty: t('runReview.empty'),
          original: t('runReview.original'),
          modified: t('runReview.modified'),
          runTitle: t(legacyRunReview ? 'runReview.legacyRunTitle' : 'runReview.runTitle'),
          acceptRun: t('runReview.acceptRun'),
          rejectRun: t('runReview.rejectRun'),
          acceptAll: t('runReview.acceptAll'),
          rejectAll: t('runReview.rejectAll'),
          acceptHunk: t('runReview.acceptHunk'),
          rejectHunk: t('runReview.rejectHunk'),
          applied: t('runReview.applied'),
          rejected: t('runReview.rejected'),
          submitting: t('runReview.submitting'),
        }}
      />
      {/* #1968 checkpoint timeline: read-only pre-run snapshot preview.
          Surfaces without a checkpoint port (Web, Hub-only) render the
          honest surfaceUnavailable notice inside the overlay. */}
      <CheckpointPreviewOverlay
        open={checkpointPreviewRunId !== null}
        runId={checkpointPreviewRunId ?? ''}
        {...(platform.checkpoint ? { port: platform.checkpoint } : {})}
        title={t('checkpoint.title')}
        closeLabel={t('checkpoint.close')}
        labels={{
          summary: t('checkpoint.summary'),
          fileListAria: t('checkpoint.fileListAria'),
          selectFile: t('checkpoint.selectFile'),
          emptyContent: t('checkpoint.emptyContent'),
          absent: t('checkpoint.absent'),
          restoreUnavailable: t('checkpoint.restoreUnavailable'),
          surfaceUnavailable: t('checkpoint.surfaceUnavailable'),
          loadFailed: t('checkpoint.loadFailed'),
        }}
        onClose={handleCloseCheckpointPreview}
      />
    <MessageSearchPanel open={props.searchOpen} onClose={() => props.onSearchOpenChange(false)}
      onJumpToMessage={jumpToMessage} highlightMessageId={searchHighlightId}
      onHighlightEnd={() => setSearchHighlightId(null)} transcriptBlocks={props.transcript}
      searchLabel={t('searchPanel.label')} searchPlaceholder={t('searchPanel.placeholder')}
      noResultsLabel={t('searchPanel.noResults')} />
  </>;
});
