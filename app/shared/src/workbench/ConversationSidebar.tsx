import React from 'react';
import type { WorkbenchConversation } from '../platform';
import styles from './AgentHubWorkbench.module.css';

export interface ConversationSidebarProps {
  conversations: WorkbenchConversation[];
  activeConversationId: string;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
}: ConversationSidebarProps): React.ReactElement {
  return (
    <aside aria-label="Conversation sidebar" className={styles.sidebar}>
      <input aria-label="搜索会话" className={styles.sidebarSearch} placeholder="搜索..." type="search" />
      <ul className={styles.conversationList}>
        {conversations.map((conversation) => (
          <li key={conversation.id}>
            <button
              aria-current={conversation.id === activeConversationId}
              className={styles.conversationButton}
              type="button"
            >
              <span className={styles.conversationTitle}>{conversation.title}</span>
              {conversation.subtitle ? (
                <span className={styles.conversationSubtitle}>{conversation.subtitle}</span>
              ) : null}
              {conversation.unreadCount ? (
                <span className={styles.unreadBadge}>{conversation.unreadCount}</span>
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
