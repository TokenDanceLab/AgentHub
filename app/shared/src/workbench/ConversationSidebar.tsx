import React, { useState } from 'react';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';

export interface ConversationSidebarProps {
  conversations: WorkbenchConversation[];
  activeConversationId: string;
  onSelectConversation?: ((conversationId: string) => void) | undefined;
  onAvatarClick?: ((conversation: WorkbenchConversation, anchor: HTMLElement) => void) | undefined;
  /** Called when the user toggles pin on a conversation. */
  onPinConversation?: ((conversationId: string, pinned: boolean) => void) | undefined;
  /** Called when the user toggles archive on a conversation. */
  onArchiveConversation?: ((conversationId: string, archived: boolean) => void) | undefined;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onAvatarClick,
  onPinConversation,
  onArchiveConversation,
}: ConversationSidebarProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  const filteredConversations = (() => {
    let list = conversations;
    // Archive filter: by default hide archived, when toggled show only archived
    if (!showArchived) {
      list = list.filter((c) => !c.archived);
    } else {
      list = list.filter((c) => c.archived);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((c) => {
        if (c.title.toLowerCase().includes(q)) return true;
        if (c.subtitle && c.subtitle.toLowerCase().includes(q)) return true;
        if (c.members && c.members.some((m) => m.toLowerCase().includes(q))) return true;
        return false;
      });
    }
    return list;
  })();

  // Sort: pinned first, then by original order (which reflects last_message_at from server)
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;
    return 0;
  });

  const archivedCount = conversations.filter((c) => c.archived).length;

  return (
    <aside aria-label="Conversation sidebar" className={styles.sidebar}>
      <input
        aria-label="搜索会话"
        className={styles.sidebarSearch}
        placeholder="搜索..."
        type="search"
        value={searchQuery}
        onChange={(event) => setSearchQuery(event.target.value)}
      />
      {archivedCount > 0 && (
        <button
          className={styles.archiveFilterToggle}
          data-active={showArchived ? 'true' : undefined}
          onClick={() => setShowArchived((prev) => !prev)}
          type="button"
        >
          <span className={styles.archiveFilterIcon} aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="3" width="12" height="3" rx="1" />
              <path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
              <path d="M6.5 8.5h3" />
            </svg>
          </span>
          <span>{showArchived ? '已归档' : '归档'}</span>
          <span className={styles.archiveFilterCount}>{archivedCount}</span>
        </button>
      )}
      <ul className={styles.conversationList}>
        {sortedConversations.length === 0 && (
          <li className={styles.conversationEmpty}>
            <span className={styles.conversationEmptyTitle}>No conversations</span>
            <span className={styles.conversationEmptyHint}>
              {searchQuery.trim() ? 'Try a different search term' : 'Start a new conversation to begin'}
            </span>
          </li>
        )}
        {sortedConversations.map((conversation) => {
          const initial = conversation.avatarLabel ?? conversation.title.slice(0, 1);
          const isActive = conversation.id === activeConversationId;
          const isGroup = conversation.kind === 'group';
          const isPinned = Boolean(conversation.pinned);

          return (
            <li key={conversation.id} data-pinned={isPinned ? 'true' : undefined}>
              <button
                aria-current={isActive ? 'true' : undefined}
                className={styles.conversationButton}
                data-agent-profile={conversation.kind === 'direct' ? conversation.title : undefined}
                data-pinned={isPinned ? 'true' : undefined}
                data-unread={conversation.unreadCount ? 'true' : undefined}
                onClick={() => onSelectConversation?.(conversation.id)}
                type="button"
              >
                <span
                  aria-label={`${conversation.title} 资料卡`}
                  className={`${styles.conversationAvatar} ${onAvatarClick ? styles.conversationAvatarClickable : ''}`}
                  style={{
                    background: conversation.avatarUrl ? undefined : (conversation.avatarColor ?? 'var(--primary)'),
                    color: conversation.avatarTextColor,
                  }}
                  tabIndex={onAvatarClick ? 0 : -1}
                  onClick={(event) => {
                    if (!onAvatarClick) return;
                    event.stopPropagation();
                    onAvatarClick(conversation, event.currentTarget);
                  }}
                  onKeyDown={(event) => {
                    if (!onAvatarClick) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onAvatarClick(conversation, event.currentTarget);
                    }
                  }}
                >
                  {conversation.avatarUrl ? (
                    <img alt="" className={styles.avatarImg} src={conversation.avatarUrl} />
                  ) : (
                    initial
                  )}
                  {isGroup && (
                    <span className={styles.conversationAvatarBadge} aria-hidden="true">
                      <DesignNavIcon name="users" size={10} />
                    </span>
                  )}
                </span>
                {isPinned && (
                  <span className={styles.conversationPinIndicator} aria-label="已置顶" title="已置顶">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                      <path d="M9.828 1.282a1 1 0 0 1 1.414 0l3.47 3.47a1 1 0 0 1 0 1.414L12.2 8.274l1.092 1.092a.5.5 0 0 1-.708.708L11.5 8.988l-2.97 2.97a.5.5 0 0 1-.708-.708L10.794 8.28 6.164 3.65a1 1 0 0 1 0-1.414l3.664-.954zM8.06 7.564l1.768-1.768-2.122-2.122-1.768 1.768a.5.5 0 0 0 0 .708l1.414 1.414a.5.5 0 0 0 .708 0zM4.222 9.28l-1.98 1.98a.5.5 0 1 0 .708.708l1.98-1.98-.708-.708z" />
                    </svg>
                  </span>
                )}
                <span className={styles.conversationCopy}>
                  <span className={styles.conversationTitle}>
                    {isGroup && <DesignNavIcon name="users" size={12} className={styles.conversationKindIcon} />}
                    {conversation.title}
                  </span>
                  {conversation.subtitle ? (
                    <span className={styles.conversationSubtitle}>{conversation.subtitle}</span>
                  ) : null}
                </span>
                {conversation.updatedLabel || conversation.unreadCount ? (
                  <span className={styles.conversationMeta}>
                    {conversation.updatedLabel ? (
                      <span className={styles.conversationTime}>{conversation.updatedLabel}</span>
                    ) : null}
                    {conversation.unreadCount ? (
                      <span className={styles.unreadBadge}>{conversation.unreadCount}</span>
                    ) : null}
                  </span>
                ) : null}
                <span className={styles.conversationActions} onClick={(e) => e.stopPropagation()}>
                  {onPinConversation && (
                    <button
                      aria-label={isPinned ? '取消置顶' : '置顶'}
                      className={styles.conversationActionBtn}
                      data-active={isPinned ? 'true' : undefined}
                      onClick={() => onPinConversation(conversation.id, !isPinned)}
                      title={isPinned ? '取消置顶' : '置顶'}
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M9.828 1.282a1 1 0 0 1 1.414 0l3.47 3.47a1 1 0 0 1 0 1.414L12.2 8.274l1.092 1.092a.5.5 0 0 1-.708.708L11.5 8.988l-2.97 2.97a.5.5 0 0 1-.708-.708L10.794 8.28 6.164 3.65a1 1 0 0 1 0-1.414l3.664-.954z" />
                        <path d="M4.222 9.28l-2.48 2.48" />
                      </svg>
                    </button>
                  )}
                  {onArchiveConversation && !showArchived && (
                    <button
                      aria-label="归档"
                      className={styles.conversationActionBtn}
                      onClick={() => {
                        if (window.confirm('Archive this conversation?')) {
                          onArchiveConversation(conversation.id, true);
                        }
                      }}
                      title="归档"
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="3" width="12" height="3" rx="1" />
                        <path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
                        <path d="M6.5 8.5h3" />
                      </svg>
                    </button>
                  )}
                  {onArchiveConversation && showArchived && (
                    <button
                      aria-label="取消归档"
                      className={styles.conversationActionBtn}
                      onClick={() => onArchiveConversation(conversation.id, false)}
                      title="取消归档"
                      type="button"
                    >
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M3 6v6a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6" />
                        <rect x="2" y="3" width="12" height="3" rx="1" />
                        <path d="M6.5 10.5l1.5 1.5 2.5-3" />
                      </svg>
                    </button>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
