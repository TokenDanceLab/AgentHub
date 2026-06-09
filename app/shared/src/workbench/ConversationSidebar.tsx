import React, { useState } from 'react';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import styles from './AgentHubWorkbench.module.css';

export interface ConversationSidebarProps {
  conversations: WorkbenchConversation[];
  activeConversationId: string;
  onSelectConversation?: ((conversationId: string) => void) | undefined;
  onAvatarClick?: ((conversation: WorkbenchConversation, anchor: HTMLElement) => void) | undefined;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onAvatarClick,
}: ConversationSidebarProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');
  const filteredConversations = searchQuery.trim()
    ? conversations.filter((c) => c.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : conversations;

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
      <ul className={styles.conversationList}>
        {filteredConversations.map((conversation) => {
          const initial = conversation.avatarLabel ?? conversation.title.slice(0, 1);
          const isActive = conversation.id === activeConversationId;
          const isGroup = conversation.kind === 'group';

          return (
            <li key={conversation.id}>
              <button
                aria-current={isActive ? 'true' : undefined}
                className={styles.conversationButton}
                data-unread={conversation.unreadCount ? 'true' : undefined}
                onClick={() => onSelectConversation?.(conversation.id)}
                type="button"
              >
                <span
                  aria-label={`${conversation.title} 资料卡`}
                  className={`${styles.conversationAvatar} ${onAvatarClick ? styles.conversationAvatarClickable : ''}`}
                  role={onAvatarClick ? 'button' : undefined}
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
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
