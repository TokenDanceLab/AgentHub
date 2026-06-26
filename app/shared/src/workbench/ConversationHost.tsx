import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptBlock, TextTranscriptBlock } from '../transcript';
import { isSidebarOnlyTranscriptBlock, orderTranscriptBlocks } from '../transcript';
import type { ComposerMention } from '../composer';
import { buildComposerIntent, composerReducer, createInitialComposerState } from '../composer';
import type { AgentHubPlatform, WorkbenchConversation } from '../platform';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import type { AttachmentUploadState } from './UnifiedComposer';
import type { FileItem } from './inspector';
import type { ConnectionStatusKind } from './GlobalRail';
import { ChatViewBridge } from './ChatViewBridge';
import { UnifiedComposer } from './UnifiedComposer';
import { WorkspaceHeader } from './WorkspaceHeader';
import MessageSearchPanel from '../ui/MessageSearchPanel';
import { useComposerSubmitBehavior } from './workbenchPreferences';
import styles from './AgentHubWorkbench.module.css';

export interface MainchainSummary {
  nodes: Array<{ id: string; label: string; detail: string; state: 'done' | 'active' | 'waiting' | 'blocked' | 'empty' }>;
  exportEnabled: boolean; exportLabel: string; exportDetail: string;
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
}

type PendingUserBlock = TextTranscriptBlock & {
  ackBaselineCount: number;
  ackOrdinal: number;
};

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
}: ConversationHostProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [uploadProgresses, setUploadProgresses] = useState<Record<string, AttachmentUploadState>>({});
  const [pendingUserBlocks, setPendingUserBlocks] = useState<PendingUserBlock[]>([]);
  const [searchHighlightId, setSearchHighlightId] = useState<string | null>(null);
  const isSubmittingRef = useRef(false);
  const composerSubmitBehavior = useComposerSubmitBehavior();

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
          } catch { setUploadProgresses((prev) => { const n = { ...prev }; delete n[a.id]; return n; }); }
        }
      }
      const finalIntent = enrichedAttachments.length > 0 ? { ...intentWithLiveText, attachments: enrichedAttachments } : intentWithLiveText;
      const submitPayload = { ...finalIntent, ...(selectedExecutionTargetId ? { executionTargetId: selectedExecutionTargetId } : {}) };
      await platform.runs.submitComposerIntent(submitPayload);
      dispatchComposer({ type: 'setSubmitState', submitState: 'idle' });
    } catch (err) {
      if (optimisticId) {
        setPendingUserBlocks((current) => current.filter((pending) => pending.id !== optimisticId));
      }
      dispatchComposer({ type: 'setSubmitState', submitState: 'error' });
      setUploadProgresses({});
      onToast(err instanceof Error ? err.message : '提交失败，请重试');
    } finally { isSubmittingRef.current = false; }
  }, [composer, currentConversationId, platform, selectedExecutionTargetId, onToast, dispatchComposer, transcript]);

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
        <UnifiedComposer composer={composer} dispatchComposer={dispatchComposer}
          executionTargets={composerExecutionTargets} executionTargetId={selectedExecutionTargetId}
          inputRef={composerInputRef} mentionableAgents={showComposerAgentPicker ? mentionableAgents : []}
          onExecutionTargetChange={onExecutionTargetChange} onPickLocalAttachments={platform.attachments?.pickFiles}
          onSubmit={submitComposer} status={showComposerStatus ? workbenchStatus : undefined}
          submitBehavior={composerSubmitBehavior} targetLabel={composerTargetLabel} uploadProgresses={uploadProgresses} />
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

function MainchainStatusStrip({ onExportEvidence, summary }: {
  onExportEvidence: () => void;
  summary: MainchainSummary;
}): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <section className={styles.mainchainStrip} aria-label={t('aria.mainChainStatus')}>
      <div className={styles.mainchainTrack} role="list">
        {summary.nodes.map((n) => (
          <div className={styles.mainchainNode} data-state={n.state} key={n.id} role="listitem">
            <span className={styles.mainchainDot} aria-hidden="true" />
            <span className={styles.mainchainCopy}><strong>{n.label}</strong><em>{n.detail}</em></span>
          </div>
        ))}
      </div>
      <button type="button" className={styles.mainchainExport} disabled={!summary.exportEnabled}
        onClick={onExportEvidence} title={summary.exportDetail}>{summary.exportLabel}</button>
    </section>
  );
}
