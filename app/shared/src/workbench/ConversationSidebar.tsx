import React from 'react';
import type { WorkbenchConversation } from '../platform';
import styles from './AgentHubWorkbench.module.css';

export interface ConversationSidebarProps {
  conversations: WorkbenchConversation[];
  activeConversationId: string;
  onSelectConversation?: ((conversationId: string) => void) | undefined;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
}: ConversationSidebarProps): React.ReactElement {
  return (
    <aside aria-label="Conversation sidebar" className={styles.sidebar}>
      <input
        aria-label="搜索会话"
        className={styles.sidebarSearch}
        placeholder="搜索..."
        type="search"
      />
      <ul className={styles.conversationList}>
        {conversations.map((conversation) => {
          const initial = conversation.avatarLabel ?? conversation.title.slice(0, 1);
          const isActive = conversation.id === activeConversationId;

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
                  aria-hidden="true"
                  className={styles.conversationAvatar}
                  style={{
                    background: conversation.avatarColor ?? 'var(--primary)',
                    color: conversation.avatarTextColor,
                  }}
                >
                  {initial}
                </span>
                <span className={styles.conversationCopy}>
                  <span className={styles.conversationTitle}>{conversation.title}</span>
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
