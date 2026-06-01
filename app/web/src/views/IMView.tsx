import { useState, useMemo, useCallback } from 'react';
import { LogIn, MessageSquare, ShieldCheck, TerminalSquare, Users, WifiOff, X, Forward } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActivityCard, SectionHeader } from '@shared/ui';
import type { IMContact, IMMessage } from '@/components/IM/types';
import type { SortOption } from '@/components/IM/IMContactList';
import IMContactList from '@/components/IM/IMContactList';
import IMMessageView from '@/components/IM/IMMessageView';
import IMMessageInput from '@/components/IM/IMMessageInput';
import { useIMChat } from '@/hooks/useIMChat';
import { useHubStore } from '@/stores/hubStore';
import type { HubWSHandle } from '@/api/hubWS';
import type { ViewProps } from '@/viewRegistryConfig';
import styles from './IMView.module.css';

export default function IMView({ hubWS: hubWsProp }: ViewProps) {
  const { t } = useTranslation();
  const hubWS = (hubWsProp ?? null) as HubWSHandle | null;
  const {
    getSessionMessages,
    contacts,
    sendMessage,
    loadSessionMessages,
    upsertContact,
    recallMessage,
    forwardMessage,
    searchSessions,
    togglePinSession,
    toggleArchiveSession,
    toggleMuteSession,
  } = useIMChat({
    hubWS,
  });
  const userId = useHubStore((s) => s.userId);
  const authenticated = useHubStore((s) => s.authenticated);
  const setShowAuthModal = useHubStore((s) => s.setShowAuthModal);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<IMMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<IMMessage | null>(null);
  const [forwardTargetIds, setForwardTargetIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortOption>('recent');
  const [showArchived, setShowArchived] = useState(false);
  const [searchResults, setSearchResults] = useState<IMContact[] | null>(null);

  const displayContacts = useMemo(
    () => searchResults ?? contacts,
    [contacts, searchResults],
  );

  const messages = useMemo(
    () => (activeSessionId ? getSessionMessages(activeSessionId) : []),
    [activeSessionId, getSessionMessages],
  );

  const activeContact = displayContacts.find((c) => c.id === activeSessionId);

  const handleSelectContact = useCallback((contact: IMContact) => {
    setActiveSessionId(contact.id);
    setReplyingTo(null);
    setForwardingMessage(null);
    void loadSessionMessages(contact.id);
  }, [loadSessionMessages]);

  const handleSend = useCallback(
    (content: string) => {
      if (!activeSessionId) return;
      sendMessage(activeSessionId, content, replyingTo?.id);
      setReplyingTo(null);
    },
    [activeSessionId, sendMessage, replyingTo],
  );

  const handleAddContact = useCallback(
    (name: string) => {
      const id = `contact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      upsertContact({ id, name, type: 'user', online: false });
    },
    [upsertContact],
  );

  const handleReply = useCallback((message: IMMessage) => {
    setReplyingTo(message);
    setForwardingMessage(null);
  }, []);

  const handleRecall = useCallback(
    (message: IMMessage) => {
      recallMessage(message.id, message.sessionId);
    },
    [recallMessage],
  );

  const handleForward = useCallback((message: IMMessage) => {
    setForwardingMessage(message);
    setReplyingTo(null);
    setForwardTargetIds(new Set());
  }, []);

  const handleCancelForward = useCallback(() => {
    setForwardingMessage(null);
    setForwardTargetIds(new Set());
  }, []);

  const handleToggleForwardTarget = useCallback((sessionId: string) => {
    setForwardTargetIds((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      return next;
    });
  }, []);

  const handleConfirmForward = useCallback(() => {
    if (!forwardingMessage || forwardTargetIds.size === 0) return;
    forwardMessage(forwardingMessage.id, [...forwardTargetIds]);
    setForwardingMessage(null);
    setForwardTargetIds(new Set());
  }, [forwardingMessage, forwardTargetIds, forwardMessage]);

  // ── Search ──────────────────────────────────

  const handleSearchSessions = useCallback(
    (query: string) => {
      if (!query) {
        setSearchResults(null);
        return;
      }
      void searchSessions(query).then((results) => {
        setSearchResults(results);
      });
    },
    [searchSessions],
  );

  const handleClearSearch = useCallback(() => {
    setSearchResults(null);
  }, []);

  // ── Sort ────────────────────────────────────

  const handleSortChange = useCallback((sort: SortOption) => {
    setSortBy(sort);
  }, []);

  // ── Archive toggle ──────────────────────────

  const handleToggleShowArchived = useCallback(() => {
    setShowArchived((v) => !v);
  }, []);

  // ── Session actions ─────────────────────────

  const handlePinToggle = useCallback(
    (sessionId: string) => {
      void togglePinSession(sessionId);
    },
    [togglePinSession],
  );

  const handleArchiveToggle = useCallback(
    (sessionId: string) => {
      void toggleArchiveSession(sessionId);
    },
    [toggleArchiveSession],
  );

  const handleMuteToggle = useCallback(
    (sessionId: string) => {
      void toggleMuteSession(sessionId);
    },
    [toggleMuteSession],
  );

  // Filter contacts for forward target selection (exclude current active session)
  const forwardableContacts = useMemo(
    () => contacts.filter((c) => c.id !== activeSessionId),
    [contacts, activeSessionId],
  );

  if (!authenticated) {
    return (
      <div className={styles.root}>
        <div className={styles.lockedShell}>
          <div className={styles.lockedHeader}>
            <SectionHeader
              className={styles.imSectionHeader ?? ''}
              eyebrowClassName={styles.imEyebrow ?? ''}
              titleClassName={styles.imTitle ?? ''}
              eyebrow={t('im.locked.eyebrow')}
              title={t('im.locked.title')}
            />
            <span>{t('im.locked.description')}</span>
          </div>
          <div className={styles.lockedGrid}>
            <ActivityCard
              className={styles.lockedCard}
              icon={<ShieldCheck size={18} />}
              iconClassName={styles.infoCardIcon}
              bodyClassName={styles.infoCardBody}
              metaClassName={styles.infoCardMeta}
              contentClassName={styles.infoCardDescription}
              label={t('im.locked.sessionTitle')}
            >
              {t('im.locked.sessionDescription')}
            </ActivityCard>
            <ActivityCard
              className={styles.lockedCard}
              icon={<MessageSquare size={18} />}
              iconClassName={styles.infoCardIcon}
              bodyClassName={styles.infoCardBody}
              metaClassName={styles.infoCardMeta}
              contentClassName={styles.infoCardDescription}
              label={t('im.locked.surfaceTitle')}
            >
              {t('im.locked.surfaceDescription')}
            </ActivityCard>
            <ActivityCard
              className={styles.lockedCard}
              icon={<WifiOff size={18} />}
              iconClassName={styles.infoCardIcon}
              bodyClassName={styles.infoCardBody}
              metaClassName={styles.infoCardMeta}
              contentClassName={styles.infoCardDescription}
              label={t('im.locked.realtimeTitle')}
            >
              {t('im.locked.realtimeDescription')}
            </ActivityCard>
          </div>
          <div className={styles.lockedActions}>
            <button className={styles.lockedButton} type="button" onClick={() => setShowAuthModal(true)}>
              <LogIn size={16} />
              <span>{t('webShell.account.signIn')}</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.contactPanel}>
        <IMContactList
          contacts={displayContacts}
          selectedId={activeSessionId ?? undefined}
          onSelect={handleSelectContact}
          onAdd={handleAddContact}
          sortBy={sortBy}
          onSortChange={handleSortChange}
          showArchived={showArchived}
          onToggleShowArchived={handleToggleShowArchived}
          onPinToggle={handlePinToggle}
          onArchiveToggle={handleArchiveToggle}
          onMuteToggle={handleMuteToggle}
          onSearchSessions={handleSearchSessions}
          onClearSearch={handleClearSearch}
        />
      </div>

      <div className={styles.chatArea}>
        {activeContact ? (
          <>
            <div className={styles.chatHeader}>
              <span className={styles.chatTitle}>{activeContact.name}</span>
              <span className={styles.chatType}>{activeContact.type}</span>
              {activeContact.pinned && (
                <span className={styles.chatPinnedBadge}>{t('im.pinned')}</span>
              )}
              {activeContact.archived && (
                <span className={styles.chatArchivedBadge}>{t('im.archived')}</span>
              )}
            </div>

            {/* Forward target selection bar */}
            {forwardingMessage ? (
              <div className={styles.forwardBar}>
                <div className={styles.forwardBarHeader}>
                  <Forward size={14} />
                  <span>Forward message to...</span>
                  <button
                    type="button"
                    className={styles.forwardBarClose}
                    onClick={handleCancelForward}
                    aria-label="Cancel forward"
                  >
                    <X size={14} />
                  </button>
                </div>
                {forwardableContacts.length > 0 ? (
                  <div className={styles.forwardTargetList}>
                    {forwardableContacts.map((contact) => (
                      <label
                        key={contact.id}
                        className={`${styles.forwardTargetItem} ${forwardTargetIds.has(contact.id) ? styles.forwardTargetSelected : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={forwardTargetIds.has(contact.id)}
                          onChange={() => handleToggleForwardTarget(contact.id)}
                          className={styles.forwardCheckbox}
                        />
                        <span className={styles.forwardTargetName}>{contact.name}</span>
                        <span className={styles.forwardTargetType}>{contact.type}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <span className={styles.forwardNoTargets}>No other sessions to forward to</span>
                )}
                <div className={styles.forwardBarActions}>
                  <button
                    type="button"
                    className={styles.forwardCancelBtn}
                    onClick={handleCancelForward}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className={styles.forwardConfirmBtn}
                    onClick={handleConfirmForward}
                    disabled={forwardTargetIds.size === 0}
                  >
                    Forward ({forwardTargetIds.size})
                  </button>
                </div>
              </div>
            ) : null}

            <div className={styles.messageArea}>
              <IMMessageView
                messages={messages}
                currentUserId={userId ?? undefined}
                onReply={handleReply}
                onRecall={handleRecall}
                onForward={handleForward}
              />
            </div>

            {/* Reply indicator */}
            {replyingTo ? (
              <div className={styles.replyIndicator}>
                <span className={styles.replyIndicatorText}>
                  Replying to <strong>{replyingTo.senderName}</strong>
                </span>
                <span className={styles.replyIndicatorPreview}>
                  {replyingTo.content.length > 60
                    ? replyingTo.content.slice(0, 60) + '...'
                    : replyingTo.content}
                </span>
                <button
                  type="button"
                  className={styles.replyIndicatorClose}
                  onClick={() => setReplyingTo(null)}
                  aria-label="Cancel reply"
                >
                  <X size={14} />
                </button>
              </div>
            ) : null}

            <div className={styles.inputArea}>
              <IMMessageInput
                onSend={handleSend}
                disabled={!activeSessionId || !!forwardingMessage}
              />
            </div>
          </>
        ) : (
          <div className={styles.noSelection}>
            <div className={styles.noSelectionHeader}>
              <SectionHeader
                className={styles.imSectionHeader ?? ''}
                eyebrowClassName={styles.imEyebrow ?? ''}
                titleClassName={styles.imTitle ?? ''}
                eyebrow={t('im.noSelection.eyebrow')}
                title={t('im.noSelection.title')}
              />
              <span>{t('im.noSelection.description')}</span>
            </div>
            <div className={styles.noSelectionGrid}>
              <ActivityCard
                className={styles.noSelectionCard}
                icon={<Users size={17} />}
                iconClassName={styles.infoCardIcon}
                bodyClassName={styles.infoCardBody}
                metaClassName={styles.infoCardMeta}
                contentClassName={styles.infoCardDescription}
                label={t('im.noSelection.sessionsTitle')}
              >
                {t('im.noSelection.sessionsDescription')}
              </ActivityCard>
              <ActivityCard
                className={styles.noSelectionCard}
                icon={<MessageSquare size={17} />}
                iconClassName={styles.infoCardIcon}
                bodyClassName={styles.infoCardBody}
                metaClassName={styles.infoCardMeta}
                contentClassName={styles.infoCardDescription}
                label={t('im.noSelection.timelineTitle')}
              >
                {t('im.noSelection.timelineDescription')}
              </ActivityCard>
              <ActivityCard
                className={styles.noSelectionCard}
                icon={<TerminalSquare size={17} />}
                iconClassName={styles.infoCardIcon}
                bodyClassName={styles.infoCardBody}
                metaClassName={styles.infoCardMeta}
                contentClassName={styles.infoCardDescription}
                label={t('im.noSelection.dispatchTitle')}
              >
                {t('im.noSelection.dispatchDescription')}
              </ActivityCard>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
