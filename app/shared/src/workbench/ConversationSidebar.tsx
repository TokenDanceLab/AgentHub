import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtualizer, type VirtualizerHandle } from 'virtua';
import type { WorkbenchConversation } from '../platform';
import { DesignNavIcon } from './designIcons';
import { ContextMenu, type ContextMenuItem } from './floating';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './AgentHubWorkbench.module.css';

const SORT_STORAGE_KEY = 'agenthub.conversationSort';
type SortBy = 'recent' | 'name' | 'active';

function loadSortBy(): SortBy {
  if (typeof window === 'undefined') return 'recent';
  const stored = window.localStorage.getItem(SORT_STORAGE_KEY);
  if (stored === 'name' || stored === 'active') return stored;
  return 'recent';
}

/** ARIA option id for a conversation row (target of aria-activedescendant). */
function conversationOptionId(conversationId: string): string {
  return `conversation-option-${conversationId}`;
}

interface SidebarContextMenuState {
  conversation: WorkbenchConversation;
  x: number;
  y: number;
}

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
  const [sortBy, setSortBy] = useState<SortBy>(loadSortBy);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SORT_STORAGE_KEY, sortBy);
    }
  }, [sortBy]);

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

  // Sort: pinned first, then by selected sort mode
  const sortedConversations = [...filteredConversations].sort((a, b) => {
    if (a.pinned && !b.pinned) return -1;
    if (!a.pinned && b.pinned) return 1;

    if (sortBy === 'name') {
      return (a.title || '').localeCompare(b.title || '');
    }

    if (sortBy === 'active') {
      const aUnread = a.unreadCount ?? 0;
      const bUnread = b.unreadCount ?? 0;
      if (aUnread !== bUnread) return bUnread - aUnread;
      return 0;
    }

    // 'recent' — keep original order (reflects last_message_at from server)
    return 0;
  });

  const archivedCount = conversations.filter((c) => c.archived).length;

  // ── Long-list infrastructure: virtualization + roving tabindex ──
  // virtua mounts only the rows near the scroll viewport (500+ conversations
  // would otherwise render thousands of DOM nodes); the ul is the scroll
  // container. Tests mock 'virtua' with a passthrough Virtualizer (see
  // AgentHubWorkbench.test.tsx) because jsdom has no layout engine.
  const listRef = useRef<HTMLUListElement>(null);
  const virtualizerRef = useRef<VirtualizerHandle>(null);
  const rowButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const skipInitialFocusRef = useRef(true);

  // Roving focus position (index into sortedConversations). Starts on the
  // active conversation; ArrowUp/Down + Home/End move it; only this row is a
  // tab stop (single tab stop for the whole list).
  const [focusIndex, setFocusIndex] = useState(() => {
    const idx = sortedConversations.findIndex((c) => c.id === activeConversationId);
    return idx >= 0 ? idx : 0;
  });
  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);

  // Clamp roving focus when the list shrinks (search / archive filter).
  useEffect(() => {
    const last = sortedConversations.length - 1;
    setFocusIndex((prev) => (last < 0 ? 0 : Math.min(prev, last)));
  }, [sortedConversations.length]);

  // Follow the selected conversation when it changes (click / external).
  useEffect(() => {
    const idx = sortedConversations.findIndex((c) => c.id === activeConversationId);
    if (idx >= 0) setFocusIndex(idx);
    // sortedConversations is derived from props; only its length affects the
    // lookup, and that case is covered by the clamp effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConversationId, sortedConversations.length]);

  // Keep the roving row focused and in view. Skipped on first render so the
  // sidebar never steals focus on mount.
  useEffect(() => {
    if (skipInitialFocusRef.current) {
      skipInitialFocusRef.current = false;
      return;
    }
    virtualizerRef.current?.scrollToIndex(focusIndex, { align: 'center' });
    rowButtonRefs.current[focusIndex]?.focus();
  }, [focusIndex]);

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    const count = sortedConversations.length;
    if (count === 0) return;
    const last = count - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusIndex((prev) => Math.min(prev + 1, last));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setFocusIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusIndex(last);
        break;
      default:
        break;
    }
  };

  const canShowContextMenu = Boolean(onPinConversation || onArchiveConversation || onAvatarClick);

  const openContextMenu = (anchor: HTMLElement, index: number) => {
    const conversation = sortedConversations[index];
    if (!canShowContextMenu || !conversation) return;
    setFocusIndex(index);
    menuAnchorRef.current = anchor;
    const rect = anchor.getBoundingClientRect();
    setContextMenu({ conversation, x: rect.left + 16, y: rect.top });
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLButtonElement>, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    openContextMenu(event.currentTarget, index);
  };

  // Keyboard equivalent of right-click: Menu key or Shift+F10 on a row.
  const handleRowKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      openContextMenu(event.currentTarget, index);
    }
  };

  const buildContextMenuItems = (conversation: WorkbenchConversation): ContextMenuItem[] => {
    const isPinned = Boolean(conversation.pinned);
    const items: ContextMenuItem[] = [];
    if (onAvatarClick) {
      items.push({
        icon: 'user',
        label: '查看资料',
        onClick: () => {
          const anchor = menuAnchorRef.current;
          if (anchor) onAvatarClick(conversation, anchor);
        },
      });
    }
    if (onPinConversation) {
      items.push({
        icon: 'pin',
        label: isPinned ? '取消置顶' : '置顶',
        onClick: () => onPinConversation(conversation.id, !isPinned),
      });
    }
    if (onArchiveConversation) {
      items.push({
        icon: showArchived ? 'inbox' : 'archive',
        label: showArchived ? '取消归档' : '归档',
        onClick: () => onArchiveConversation(conversation.id, !showArchived),
      });
    }
    // TODO(uiux gap #9): 重命名 / 删除 / 复制链接 — 需上层新增
    // onRenameConversation / onDeleteConversation / onCopyConversationLink
    // 回调后再启用，当前不硬造空操作。
    return items;
  };

  const focusedConversationId = sortedConversations[focusIndex]?.id;

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
      <select
        aria-label={t('aria.sortConversations') ?? '排序方式'}
        className={styles.sidebarSort}
        value={sortBy}
        onChange={(event) => setSortBy(event.target.value as SortBy)}
      >
        <option value="recent">最近活动</option>
        <option value="name">名称</option>
        <option value="active">活跃</option>
      </select>
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
      <ul
        aria-activedescendant={
          focusedConversationId ? conversationOptionId(focusedConversationId) : undefined
        }
        aria-label={t('aria.conversationSidebar')}
        className={styles.conversationList}
        onKeyDown={handleListKeyDown}
        ref={listRef}
        role="listbox"
      >
        {sortedConversations.length === 0 ? (
          <li className={styles.conversationEmpty}>
            <span className={styles.conversationEmptyTitle}>No conversations</span>
            <span className={styles.conversationEmptyHint}>
              {searchQuery.trim() ? 'Try a different search term' : 'Start a new conversation to begin'}
            </span>
          </li>
        ) : (
          <Virtualizer ref={virtualizerRef} scrollRef={listRef} bufferSize={800}>
            {sortedConversations.map((conversation, index) => {
              const initial = conversation.avatarLabel ?? conversation.title.slice(0, 1);
              const isActive = conversation.id === activeConversationId;
              const isGroup = conversation.kind === 'group';
              const isPinned = Boolean(conversation.pinned);
              const isFocusedRow = index === focusIndex;

              return (
                <li
                  aria-selected={isActive ? 'true' : undefined}
                  data-pinned={isPinned ? 'true' : undefined}
                  id={conversationOptionId(conversation.id)}
                  key={conversation.id}
                  role="option"
                >
                  <button
                    aria-current={isActive ? 'true' : undefined}
                    className={styles.conversationButton}
                    data-agent-profile={conversation.kind === 'direct' ? conversation.title : undefined}
                    data-pinned={isPinned ? 'true' : undefined}
                    data-unread={conversation.unreadCount ? 'true' : undefined}
                    onClick={() => {
                      setFocusIndex(index);
                      onSelectConversation?.(conversation.id);
                    }}
                    onContextMenu={(event) => handleRowContextMenu(event, index)}
                    onKeyDown={(event) => handleRowKeyDown(event, index)}
                    ref={(el) => {
                      rowButtonRefs.current[index] = el;
                    }}
                    tabIndex={isFocusedRow ? 0 : -1}
                    type="button"
                  >
                    <span
                      aria-label={`${conversation.title} 资料卡`}
                      className={`${styles.conversationAvatar} ${onAvatarClick ? styles.conversationAvatarClickable : ''}`}
                      style={{
                        background: conversation.avatarUrl ? undefined : (conversation.avatarColor ?? 'var(--primary)'),
                        color: conversation.avatarTextColor,
                      }}
                      tabIndex={onAvatarClick && isFocusedRow ? 0 : -1}
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
                          tabIndex={-1}
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
                          tabIndex={-1}
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
                          tabIndex={-1}
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
          </Virtualizer>
        )}
      </ul>
      {contextMenu && (
        <ContextMenu
          items={buildContextMenuItems(contextMenu.conversation)}
          isOpen
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
        />
      )}
    </aside>
  );
}
