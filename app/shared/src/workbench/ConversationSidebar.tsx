import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
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
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
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
    <aside aria-label={t('aria.conversationSidebar')} className={styles.sidebar}>
      <input
        aria-label={t('aria.searchConversations')}
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
            <DesignNavIcon name="archive" size={14} />
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
                  <span className={styles.conversationPinIndicator} aria-label={t('aria.pinned')} title={t('aria.pinned')}>
                    <DesignNavIcon name="pin" size={12} />
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
                      <DesignNavIcon name="pin" size={14} />
                    </button>
                  )}
                  {onArchiveConversation && !showArchived && (
                    <button
                      aria-label={t('aria.archive')}
                      className={styles.conversationActionBtn}
                      onClick={() => {
                        if (window.confirm('Archive this conversation?')) {
                          onArchiveConversation(conversation.id, true);
                        }
                      }}
                      title="归档"
                      type="button"
                    >
                      <DesignNavIcon name="archive" size={14} />
                    </button>
                  )}
                  {onArchiveConversation && showArchived && (
                    <button
                      aria-label={t('aria.unarchive')}
                      className={styles.conversationActionBtn}
                      onClick={() => onArchiveConversation(conversation.id, false)}
                      title="取消归档"
                      type="button"
                    >
                      <DesignNavIcon name="inbox" size={14} />
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
