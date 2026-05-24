// IMContactList.tsx — IM contact/session list sidebar for AgentHub Desktop.
// Shows search, session list with last message preview, online indicators,
// and unread count badges.
//
// Reference: docs/reference/cross-comparison/02-im-ux.md Section 2.2 / 3.1

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, MessageSquare } from 'lucide-react';
import EmptyState from './EmptyState';
import styles from './IMContactList.module.css';

// ── Types ───────────────────────────────────────

export interface Contact {
  id: string;
  name: string;
  avatar?: string;
  isOnline: boolean;
}

export interface Session {
  id: string;
  name?: string;
  type: 'private' | 'group';
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount?: number;
  isOnline?: boolean;
  /** Members for group display or other party for private */
  members?: Contact[];
}

export interface IMContactListProps {
  contacts: Contact[];
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onSearch: (query: string) => void;
}

// ── Relative time ────────────────────────────────

function briefTime(timestamp?: string): string {
  if (!timestamp) return '';
  const now = Date.now();
  const then = new Date(timestamp).getTime();
  const diff = now - then;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return '';
}

// ── Avatar initial ──────────────────────────────

function avatarInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

// ── Component ───────────────────────────────────

export default function IMContactList({
  contacts,
  sessions,
  activeSessionId,
  onSelectSession,
  onSearch,
}: IMContactListProps) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState('');

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const q = e.target.value;
      setSearchValue(q);
      onSearch(q);
    },
    [onSearch],
  );

  const getSessionName = (s: Session): string => {
    if (s.name) return s.name;
    if (s.type === 'private' && s.members && s.members.length > 0) {
      return s.members[0].name;
    }
    return 'Unknown';
  };

  const getSessionInitial = (s: Session): string => {
    const name = getSessionName(s);
    return avatarInitial(name);
  };

  const isSessionOnline = (s: Session): boolean => {
    if (s.isOnline !== undefined) return s.isOnline;
    if (s.type === 'private' && s.members && s.members.length > 0) {
      return s.members[0].isOnline;
    }
    return false;
  };

  return (
    <div className={styles.root}>
      {/* Search bar */}
      <div className={styles.searchBar}>
        <Search size={16} className={styles.searchIcon} />
        <input
          className={styles.searchInput}
          type="text"
          placeholder={t('im.contact.search')}
          value={searchValue}
          onChange={handleSearchChange}
          aria-label={t('im.contact.search')}
        />
      </div>

      {/* Session list */}
      <div className={styles.list} role="listbox" aria-label="Sessions">
        {sessions.length === 0 ? (
          <EmptyState
            icon={<MessageSquare size={20} />}
            title={t('im.contact.empty')}
            description=""
          />
        ) : (
          sessions.map((session) => {
            const isActive = session.id === activeSessionId;
            const isOnline = isSessionOnline(session);
            return (
              <button
                key={session.id}
                className={`${styles.sessionItem} ${isActive ? styles.sessionActive : ''}`}
                onClick={() => onSelectSession(session.id)}
                role="option"
                aria-selected={isActive}
              >
                {/* Avatar */}
                <div className={styles.avatarWrapper}>
                  <div className={`${styles.avatar} ${isOnline ? styles.avatarOnline : ''}`}>
                    {getSessionInitial(session)}
                  </div>
                  {isOnline && <span className={styles.onlineDot} />}
                </div>

                {/* Info */}
                <div className={styles.sessionInfo}>
                  <div className={styles.sessionTop}>
                    <span className={styles.sessionName}>{getSessionName(session)}</span>
                    {session.lastMessageTime && (
                      <span className={styles.sessionTime}>
                        {briefTime(session.lastMessageTime)}
                      </span>
                    )}
                  </div>
                  <div className={styles.sessionBottom}>
                    {session.lastMessage ? (
                      <span className={styles.lastMessage}>{session.lastMessage}</span>
                    ) : (
                      <span className={styles.noMessage}>{t('im.contact.empty')}</span>
                    )}
                    {session.unreadCount ? (
                      <span className={styles.unreadBadge}>
                        {session.unreadCount > 99 ? '99+' : session.unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
