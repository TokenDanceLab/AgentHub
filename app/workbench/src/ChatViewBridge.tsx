/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW BRIDGE — narrow adapter
   Maps AgentHubWorkbench transcript + callbacks → ChatViewTranscript props.
   Pure adapter layer; no behavior logic lives here beyond pinnedAnnouncement
   construction and chatMode derivation.
   ══════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptBlock } from '@shared/transcript';
import type { WorkbenchConversation } from '@shared/platform';
import type { ConnectionStatusKind } from './GlobalRail';
import { ChatViewTranscript } from '@shared/chatview/components/ChatViewTranscript';
import type { TranscriptUserItem } from '@shared/chatview/transcript-item';
import type { UnreadDividerDescriptor } from '@shared/chatview';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { useTypingPresence } from '@shared/chatview/typingPresence';
import { SubagentStreamOverlay } from './team/SubagentStreamOverlay';
import { InlineDelegationCard } from './team/InlineDelegationCard';

export interface ChatViewBridgeProps {
  /** Filtered + optimistic transcript blocks to render. */
  displayTranscript: TranscriptBlock[];
  /** Currently active conversation, for chatMode + pinnedAnnouncement. */
  activeConversation?: WorkbenchConversation | undefined;
  /** Called when an agent name is clicked in the transcript. */
  onAgentClick?: ((agentName: string, anchor: HTMLElement) => void) | undefined;
  /** Called on transcript block right-click / context-menu trigger.
   *  Signature matches ChatViewTranscript.onBlockContextMenu exactly. */
  onBlockContextMenu?: ((blockId: string, event: React.MouseEvent) => void) | undefined;
  /** Called on transcript block click or Ctrl/Shift+click. */
  onBlockSelect?: ((blockId: string, shiftKey: boolean) => void) | undefined;
  /** Called on block-level action (approve/deny/retry/copy/regenerate). */
  onBlockAction?:
    | ((action: string, blockId: string, metadata?: Record<string, unknown>) => void)
    | undefined;
  /** Called when "Review file" is triggered from a block. */
  onReviewFile?:
    | ((file: { name: string; path?: string; url?: string; content?: string; language?: string }) => void)
    | undefined;
  /** Called when "Deploy" is triggered from a block. */
  onDeploySubmit?: ((id: string) => void) | undefined;
  /** Set of currently selected block IDs. */
  selectedBlockIds: Set<string>;
  /** Whether multi-select mode is active. */
  selectionMode: boolean;
  /** Set of soft-hidden (grayed out / deleted) block IDs. */
  softHiddenBlockIds: Set<string>;
  /** Set of block IDs that are currently pulsing. */
  actionedBlockIds: Set<string>;
  /** Block ID to scroll to and highlight temporarily. */
  highlightedBlockId?: string | null | undefined;
  /** Called when the highlight animation ends. */
  onHighlightEnd?: (() => void) | undefined;
  /** WebSocket connection status for the rail indicator dot. */
  connectionStatus?: ConnectionStatusKind | undefined;
  /** Set of conversation IDs whose pinned announcements have been dismissed. */
  dismissedPinnedIds: Set<string>;
  /**
   * Called when the user dismisses the pinned banner (#1821). The host keeps
   * the dismissed set so the banner stays hidden until the pin changes.
   */
  onDismissPinned?: ((conversationId: string) => void) | undefined;
  /** Called to show a toast (used for pinned announcement copy feedback). */
  onToast?: ((message: string) => void) | undefined;
  /**
   * Unread-messages divider descriptor (T8 desktop IM path). Resolved by the
   * ChatView against the adapted items; absent for non-IM transcripts.
   */
  unreadDivider?: UnreadDividerDescriptor | undefined;
  /**
   * Transcript items are loading (#1821). With an empty transcript the chat
   * shows an honest loading state instead of the "no messages" empty state.
   */
  transcriptLoading?: boolean | undefined;
}

/**
 * Pure adapter: maps AgentHubWorkbench-level state and callbacks into the
 * prop shape expected by ChatViewTranscript.
 *
 * Two bits of adaptation happen here:
 * 1. chatMode is derived from activeConversation.kind.
 * 2. pinnedAnnouncement is constructed from activeConversation + dismissedPinnedIds,
 *    wiring toast callbacks for copy.
 *
 * All other props pass through directly — the workbench has already resolved
 * block lookups and event type casts before calling into this component.
 */
export const ChatViewBridge = React.memo(function ChatViewBridge({
  displayTranscript,
  activeConversation,
  onAgentClick,
  onBlockContextMenu,
  onBlockSelect,
  onBlockAction,
  onReviewFile,
  onDeploySubmit,
  selectedBlockIds,
  selectionMode,
  softHiddenBlockIds,
  actionedBlockIds,
  highlightedBlockId,
  onHighlightEnd,
  connectionStatus,
  dismissedPinnedIds,
  onDismissPinned,
  onToast,
  unreadDivider,
  transcriptLoading,
}: ChatViewBridgeProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const chatMode = useMemo<'dm' | 'group'>(
    () => (activeConversation?.kind === 'group' ? 'group' : 'dm'),
    [activeConversation?.kind],
  );

  const pinnedAnnouncement = useMemo(() => {
    if (!activeConversation?.pinnedAnnouncement) return undefined;
    if (dismissedPinnedIds.has(activeConversation.id)) return undefined;
    return {
      title: activeConversation.pinnedAnnouncement.title,
      content: activeConversation.pinnedAnnouncement.content,
      author: activeConversation.pinnedAnnouncement.author,
      time: activeConversation.pinnedAnnouncement.time,
      onCopy: onToast ? () => onToast(t('toast.pinnedOpened')) : undefined,
      // #1821: wire the real dismissal path so the close button works.
      onDismiss: onDismissPinned
        ? () => onDismissPinned(activeConversation.id)
        : undefined,
    };
  }, [activeConversation, dismissedPinnedIds, onDismissPinned, onToast]);

  // #1406 Phase 3: mount the inline delegation card below each user message.
  const renderUserFooter = useCallback(
    (item: TranscriptUserItem) => (
      <InlineDelegationCard {...(item.id !== undefined ? { messageId: item.id } : {})} />
    ),
    [],
  );

  // ── Typing indicator ───────────────────────────────────
  const typingUserIds = useTypingPresence(activeConversation?.id);
  const typingUserNames = useMemo<string[]>(() => {
    if (typingUserIds.length === 0 || chatMode === 'dm') return [];
    return typingUserIds;
  }, [typingUserIds, chatMode]);

  return (
    <>
      <ChatViewTranscript
        transcript={displayTranscript}
        chatMode={chatMode}
        unreadDivider={unreadDivider}
        onAgentClick={onAgentClick}
        onBlockContextMenu={onBlockContextMenu}
        onBlockSelect={onBlockSelect}
        onBlockAction={onBlockAction}
        onReviewFile={onReviewFile}
        onDeploySubmit={onDeploySubmit}
        selectedBlockIds={selectedBlockIds}
        selectionMode={selectionMode}
        softHiddenBlockIds={softHiddenBlockIds}
        actionedBlockIds={actionedBlockIds}
        highlightedBlockId={highlightedBlockId}
        onHighlightEnd={onHighlightEnd}
        pinnedAnnouncement={pinnedAnnouncement}
        connectionStatus={connectionStatus}
        typingUserNames={typingUserNames}
        renderUserFooter={renderUserFooter}
        {...(activeConversation?.id !== undefined ? { sessionId: activeConversation.id } : {})}
        {...(transcriptLoading !== undefined ? { transcriptLoading } : {})}
      />
      <SubagentStreamOverlay />
    </>
  );
});
