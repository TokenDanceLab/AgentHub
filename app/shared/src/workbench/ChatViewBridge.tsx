/* ═══════════════════════════════════════════════════════════════════════
   CHAT VIEW BRIDGE — narrow adapter
   Maps AgentHubWorkbench transcript + callbacks → ChatViewTranscript props.
   Pure adapter layer; no behavior logic lives here beyond pinnedAnnouncement
   construction and chatMode derivation.
   ══════════════════════════════════════════════════════════════════════ */

import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TranscriptBlock } from '../transcript';
import type { WorkbenchConversation } from '../platform';
import type { ConnectionStatusKind } from './GlobalRail';
import { ChatViewTranscript } from '../chatview/components/ChatViewTranscript';
import type { TranscriptUserItem } from '../chatview/transcript-item';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
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
  /** Called to show a toast (used for pinned announcement copy feedback). */
  onToast?: ((message: string) => void) | undefined;
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
  onToast,
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
      onDismiss: undefined,
    };
  }, [activeConversation, dismissedPinnedIds, onToast]);

  // #1406 Phase 3: mount the inline delegation card below each user message.
  // The card self-gates — it renders null when MessageDelegationStore has no
  // entries for that message id (i.e. the message did not trigger a dispatch),
  // so it is safe to mount below every user message. The callback is stable so
  // ChatViewTranscript's memo is not defeated by a fresh function each render.
  const renderUserFooter = useCallback(
    (item: TranscriptUserItem) => <InlineDelegationCard messageId={item.id} />,
    [],
  );

  return (
    <>
      <ChatViewTranscript
        transcript={displayTranscript}
        chatMode={chatMode}
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
        renderUserFooter={renderUserFooter}
      />
      <SubagentStreamOverlay />
    </>
  );
});
