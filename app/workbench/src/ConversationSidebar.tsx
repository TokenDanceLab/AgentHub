import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Virtualizer, type VirtualizerHandle } from 'virtua';
import type { WorkbenchConversation } from '@shared/platform';
import { DesignNavIcon } from './designIcons';
import { ContextMenu, type ContextMenuItem } from './floating';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import Modal from '@shared/ui/Modal';
import { Tooltip } from '@shared/ui/Tooltip';
import type { ConversationLiveStatus } from './workbenchAttentionModel';
import styles from './AgentHubWorkbench.module.css';

const SORT_STORAGE_KEY = 'agenthub.conversationSort';

/** F1 live-status dot copy (label map is the single per-status text source). */
const LIVE_STATUS_LABEL: Record<ConversationLiveStatus, string> = {
  running: '运行中',
  'awaiting-approval': '待批准',
  done: '已完成',
};
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
  /** Called with the new title after the user commits an inline rename. */
  onRenameConversation?: ((conversationId: string, title: string) => void) | undefined;
  /** Called after the user confirms deletion of a conversation. */
  onDeleteConversation?: ((conversationId: string) => void) | undefined;
  /** Called after a conversation link has been copied to the clipboard. */
  onCopyConversationLink?: ((conversationId: string, link: string) => void) | undefined;
  /** Called when the user wants to start a new conversation (#1819). The
   *  shell owns the create-session call chain (Edge `createThread` on
   *  Desktop, Hub `createPrivateSession` after peer selection on Web); this
   *  callback only signals intent. Renders the header button + empty-state
   *  CTA; both absent when the prop is not wired (backward compatible). */
  onStartNewConversation?: (() => void) | undefined;
  /**
   * F1 live status per conversation (running / awaiting-approval / done),
   * derived by the shell from the run/approval model via
   * `workbenchAttentionModel`. Rows without an entry render no dot.
   */
  liveStatusByConversation?: Record<string, ConversationLiveStatus> | undefined;
}

/**
 * Shareable conversation link. Follows the existing `agenthub://` scheme
 * family used by card/profile links (workbenchTranscriptChromeLabels /
 * workbenchProfileChromeHelpers); like those, it is a custom scheme that
 * consumers may route themselves.
 */
export function conversationLinkFor(conversationId: string): string {
  return `agenthub://threads/${conversationId}`;
}

/**
 * Copy text to the clipboard with a textarea fallback for environments where
 * `navigator.clipboard` is unavailable (older WebViews, permission denied).
 * Returns whether the copy attempt was written somewhere.
 */
function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).then(
      () => true,
      () => fallbackWriteClipboard(text),
    );
  }
  return Promise.resolve(fallbackWriteClipboard(text));
}

function fallbackWriteClipboard(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  let copied: boolean;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(textarea);
  return copied;
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onAvatarClick,
  onPinConversation,
  onArchiveConversation,
  onRenameConversation,
  onDeleteConversation,
  onCopyConversationLink,
  onStartNewConversation,
  liveStatusByConversation,
}: ConversationSidebarProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [searchQuery, setSearchQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sortBy, setSortBy] = useState<SortBy>(loadSortBy);
  /** Conversation id whose row is in inline rename mode (null = none). */
  const [renamingId, setRenamingId] = useState<string | null>(null);
  /** Conversation awaiting delete confirmation in the dialog. */
  const [deleteTarget, setDeleteTarget] = useState<WorkbenchConversation | null>(null);
  /** Conversation awaiting archive confirmation in the dialog (#1821). */
  const [archiveTarget, setArchiveTarget] = useState<WorkbenchConversation | null>(null);
  /**
   * Set when Escape cancels an inline rename. Blur fires after the input is
   * removed in some browsers — the flag keeps that late blur from committing
   * a cancelled rename (#1821).
   */
  const cancelRenameRef = useRef(false);

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

  const canShowContextMenu = Boolean(onPinConversation || onArchiveConversation || onAvatarClick || onRenameConversation || onDeleteConversation || onCopyConversationLink);

  const openContextMenu = (anchor: HTMLElement, index: number) => {
    const conversation = sortedConversations[index];
    if (!canShowContextMenu || !conversation) return;
    // Opening a menu on another row exits any active inline rename.
    setRenamingId(null);
    setFocusIndex(index);
    menuAnchorRef.current = anchor;
    const rect = anchor.getBoundingClientRect();
    setContextMenu({ conversation, x: rect.left + 16, y: rect.top });
  };

  // Attached to the row wrapper (selection button + action cluster are
  // siblings), so right-clicking anywhere on a row still opens its menu.
  const handleRowContextMenu = (event: React.MouseEvent<HTMLElement>, index: number) => {
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
        label: showArchived ? t('aria.unarchive') : t('sidebar.archive'),
        onClick: () => onArchiveConversation(conversation.id, !showArchived),
      });
    }
    // #1508: rename / copy link / delete. Each entry only appears when the
    // consumer wires the corresponding callback (backward compatible).
    if (onRenameConversation) {
      items.push({
        icon: 'edit',
        label: t('context.renameConversation'),
        onClick: () => {
          cancelRenameRef.current = false;
          setRenamingId(conversation.id);
        },
      });
    }
    if (onCopyConversationLink) {
      items.push({
        icon: 'link',
        label: t('context.copyConversationLink'),
        onClick: () => {
          const link = conversationLinkFor(conversation.id);
          void copyTextToClipboard(link).then(() => onCopyConversationLink(conversation.id, link));
        },
      });
    }
    if (onDeleteConversation) {
      items.push({
        icon: 'archive',
        label: t('context.deleteConversation'),
        danger: true,
        onClick: () => setDeleteTarget(conversation),
      });
    }
    return items;
  };

  const handleRenameSubmit = (conversation: WorkbenchConversation, value: string) => {
    const nextTitle = value.trim();
    setRenamingId(null);
    if (!nextTitle || nextTitle === conversation.title) return;
    onRenameConversation?.(conversation.id, nextTitle);
  };

  const focusedConversationId = sortedConversations[focusIndex]?.id;

  return (
    <aside aria-label={t('aria.conversationSidebar')} className={styles.sidebar}>
      <div className={styles.sidebarSearchRow}>
        <input
          aria-label={t('aria.searchConversations')}
          className={styles.sidebarSearch}
          placeholder={t('sidebar.searchPlaceholder')}
          type="search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {onStartNewConversation && (
          <button
            aria-label={t('aria.newConversation')}
            className={styles.sidebarNewButton}
            title={t('aria.newConversation')}
            type="button"
            onClick={onStartNewConversation}
          >
            <DesignNavIcon name="plus" size={16} />
          </button>
        )}
      </div>
      <select
        aria-label={t('aria.sortConversations') ?? '排序方式'}
        className={styles.sidebarSort}
        value={sortBy}
        onChange={(event) => setSortBy(event.target.value as SortBy)}
      >
        <option value="recent">{t('sidebar.sortRecent')}</option>
        <option value="name">{t('sidebar.sortName')}</option>
        <option value="active">{t('sidebar.sortActive')}</option>
      </select>
      {archivedCount > 0 && (
        <button type="button"
          className={styles.archiveFilterToggle}
          data-active={showArchived ? 'true' : undefined}
          onClick={() => setShowArchived((prev) => !prev)}
        >
          <span className={styles.archiveFilterIcon} aria-hidden="true">
            <DesignNavIcon name="archive" size={14} />
          </span>
          <span>{showArchived ? t('sidebar.archived') : t('sidebar.archive')}</span>
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
            {searchQuery.trim() ? (
              <>
                <span className={styles.conversationEmptyTitle}>
                  {t('sidebar.emptySearchTitle')}
                </span>
                <span className={styles.conversationEmptyHint}>
                  {t('sidebar.emptySearchHint')}
                </span>
                <button
                  type="button"
                  className={styles.conversationEmptyAction}
                  onClick={() => setSearchQuery('')}
                >
                  {t('sidebar.clearSearch')}
                </button>
              </>
            ) : (
              <>
                <span className={styles.conversationEmptyTitle}>
                  {t('sidebar.emptyTitle')}
                </span>
                <span className={styles.conversationEmptyHint}>
                  {t('sidebar.emptyHint')}
                </span>
                {onStartNewConversation && (
                  <button
                    type="button"
                    className={styles.conversationEmptyAction}
                    onClick={onStartNewConversation}
                  >
                    {t('sidebar.newConversation')}
                  </button>
                )}
              </>
            )}
          </li>
        ) : (
          <Virtualizer ref={virtualizerRef} scrollRef={listRef} bufferSize={800}>
            {sortedConversations.map((conversation, index) => {
              const initial = conversation.avatarLabel ?? conversation.title.slice(0, 1);
              const isActive = conversation.id === activeConversationId;
              const isGroup = conversation.kind === 'group';
              const isPinned = Boolean(conversation.pinned);
              const isFocusedRow = index === focusIndex;
              const liveStatus = liveStatusByConversation?.[conversation.id];

              return (
                <li
                  aria-selected={isActive ? 'true' : undefined}
                  data-pinned={isPinned ? 'true' : undefined}
                  id={conversationOptionId(conversation.id)}
                  key={conversation.id}
                  role="option"
                >
                  {renamingId === conversation.id ? (
                    <form
                      className={styles.conversationRenameForm}
                      onSubmit={(event) => {
                        event.preventDefault();
                        const input = event.currentTarget.querySelector<HTMLInputElement>('input');
                        handleRenameSubmit(conversation, input?.value ?? '');
                      }}
                    >
                      <input
                        aria-label={t('aria.renameConversation')}
                        autoFocus
                        className={styles.conversationRenameInput}
                        defaultValue={conversation.title}
                        // #1821: blur commits the typed value instead of
                        // discarding it silently (Enter blurs → single commit
                        // path; Escape cancels via cancelRenameRef).
                        onBlur={(event) => {
                          if (cancelRenameRef.current) {
                            cancelRenameRef.current = false;
                            return;
                          }
                          handleRenameSubmit(conversation, event.currentTarget.value);
                        }}
                        onFocus={(event) => event.currentTarget.select()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            event.currentTarget.blur();
                            return;
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            event.stopPropagation();
                            cancelRenameRef.current = true;
                            setRenamingId(null);
                          }
                        }}
                        type="text"
                      />
                    </form>
                  ) : (
                    <div
                      className={styles.conversationRow}
                      data-active={isActive ? 'true' : undefined}
                      onClick={() => {
                        setFocusIndex(index);
                        onSelectConversation?.(conversation.id);
                      }}
                      onContextMenu={(event) => handleRowContextMenu(event, index)}
                    >
                      <button type="button"
                        aria-current={isActive ? 'true' : undefined}
                        className={styles.conversationButton}
                        data-agent-profile={conversation.kind === 'direct' ? conversation.title : undefined}
                        data-pinned={isPinned ? 'true' : undefined}
                        data-unread={conversation.unreadCount ? 'true' : undefined}
                        onKeyDown={(event) => handleRowKeyDown(event, index)}
                        ref={(el) => {
                          rowButtonRefs.current[index] = el;
                        }}
                        tabIndex={isFocusedRow ? 0 : -1}
                      >
                        {liveStatus && (
                          <span
                            aria-label={LIVE_STATUS_LABEL[liveStatus]}
                            className={styles.conversationLiveDot}
                            data-live-status={liveStatus}
                            title={LIVE_STATUS_LABEL[liveStatus]}
                          />
                        )}
                        <span
                          aria-label={`${conversation.title} 资料卡`}
                          className={`${styles.conversationAvatar} ${onAvatarClick ? styles.conversationAvatarClickable : ''}`}
                          style={{
                            background: conversation.avatarUrl ? undefined : (conversation.avatarColor ?? 'var(--td-plum)'),
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
                          <span className={styles.conversationPinIndicator} aria-label={t('aria.pinned')}>
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
                      </button>
                      {/* Row actions are a sibling of the selection button
                          (#1715): no button may nest inside the row button. */}
                      <span className={styles.conversationActions} onClick={(event) => event.stopPropagation()}>
                        {onPinConversation && (
                          <Tooltip label={isPinned ? '取消置顶' : '置顶'}>
                            <button type="button"
                              aria-label={isPinned ? '取消置顶' : '置顶'}
                              className={styles.conversationActionBtn}
                              data-active={isPinned ? 'true' : undefined}
                              onClick={() => onPinConversation(conversation.id, !isPinned)}
                              tabIndex={-1}
                            >
                              <DesignNavIcon name="pin" size={14} />
                            </button>
                          </Tooltip>
                        )}
                        {onArchiveConversation && !showArchived && (
                          <Tooltip label={t("aria.archive")}>
                            <button type="button"
                              aria-label={t('aria.archive')}
                              className={styles.conversationActionBtn}
                              onClick={() => setArchiveTarget(conversation)}
                              tabIndex={-1}
                            >
                              <DesignNavIcon name="archive" size={14} />
                            </button>
                          </Tooltip>
                        )}
                        {onArchiveConversation && showArchived && (
                          <Tooltip label={t("aria.unarchive")}>
                            <button type="button"
                              aria-label={t('aria.unarchive')}
                              className={styles.conversationActionBtn}
                              onClick={() => onArchiveConversation(conversation.id, false)}
                              tabIndex={-1}
                            >
                              <DesignNavIcon name="inbox" size={14} />
                            </button>
                          </Tooltip>
                        )}
                      </span>
                    </div>
                  )}
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
      {deleteTarget && (
        <Modal
          contentClassName={styles.conversationDeleteContent}
          onClose={() => setDeleteTarget(null)}
          open
          title={t('conversation.deleteTitle')}
        >
          <p className={styles.conversationDeleteText}>
            {t('conversation.deleteBody', { title: deleteTarget.title })}
          </p>
          <div className={styles.conversationDeleteActions}>
            <button type="button"
              className={styles.conversationDeleteCancel}
              onClick={() => setDeleteTarget(null)}
            >
              {t('conversation.cancel')}
            </button>
            <button type="button"
              className={styles.conversationDeleteConfirm}
              onClick={() => {
                const target = deleteTarget;
                setDeleteTarget(null);
                onDeleteConversation?.(target.id);
              }}
            >
              {t('conversation.deleteConfirm')}
            </button>
          </div>
        </Modal>
      )}
      {archiveTarget && (
        <Modal
          contentClassName={styles.conversationDeleteContent}
          onClose={() => setArchiveTarget(null)}
          open
          title={t('conversation.archiveTitle')}
        >
          <p className={styles.conversationDeleteText}>
            {t('conversation.archiveBody', {
              title: archiveTarget.title,
            })}
          </p>
          <div className={styles.conversationDeleteActions}>
            <button type="button"
              className={styles.conversationDeleteCancel}
              onClick={() => setArchiveTarget(null)}
            >
              {t('conversation.cancel')}
            </button>
            <button type="button"
              className={styles.conversationDeleteConfirm}
              onClick={() => {
                const target = archiveTarget;
                setArchiveTarget(null);
                onArchiveConversation?.(target.id, true);
              }}
            >
              {t('conversation.archiveConfirm')}
            </button>
          </div>
        </Modal>
      )}
    </aside>
  );
}
