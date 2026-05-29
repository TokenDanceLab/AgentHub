import { useState, useMemo, useCallback } from 'react';
import { LogIn, MessageSquare, ShieldCheck, TerminalSquare, Users, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { IMContact, IMMessage } from '@/components/IM/types';
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
  const { getSessionMessages, contacts, sendMessage, loadSessionMessages, upsertContact } = useIMChat({
    hubWS,
  });
  const userId = useHubStore((s) => s.userId);
  const authenticated = useHubStore((s) => s.authenticated);
  const setShowAuthModal = useHubStore((s) => s.setShowAuthModal);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const messages = useMemo(
    () => (activeSessionId ? getSessionMessages(activeSessionId) : []),
    [activeSessionId, getSessionMessages],
  );

  const activeContact = contacts.find((c) => c.id === activeSessionId);

  const handleSelectContact = useCallback((contact: IMContact) => {
    setActiveSessionId(contact.id);
    void loadSessionMessages(contact.id);
  }, [loadSessionMessages]);

  const handleSend = useCallback(
    (content: string) => {
      if (!activeSessionId) return;
      sendMessage(activeSessionId, content);
    },
    [activeSessionId, sendMessage],
  );

  const handleAddContact = useCallback(
    (name: string) => {
      const id = `contact-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      upsertContact({ id, name, type: 'user', online: false });
    },
    [upsertContact],
  );

  if (!authenticated) {
    return (
      <div className={styles.root}>
        <div className={styles.lockedShell}>
          <div className={styles.lockedHeader}>
            <p>{t('im.locked.eyebrow')}</p>
            <h2>{t('im.locked.title')}</h2>
            <span>{t('im.locked.description')}</span>
          </div>
          <div className={styles.lockedGrid}>
            <div className={styles.lockedCard}>
              <ShieldCheck size={18} />
              <strong>{t('im.locked.sessionTitle')}</strong>
              <span>{t('im.locked.sessionDescription')}</span>
            </div>
            <div className={styles.lockedCard}>
              <MessageSquare size={18} />
              <strong>{t('im.locked.surfaceTitle')}</strong>
              <span>{t('im.locked.surfaceDescription')}</span>
            </div>
            <div className={styles.lockedCard}>
              <WifiOff size={18} />
              <strong>{t('im.locked.realtimeTitle')}</strong>
              <span>{t('im.locked.realtimeDescription')}</span>
            </div>
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
          contacts={contacts}
          selectedId={activeSessionId ?? undefined}
          onSelect={handleSelectContact}
          onAdd={handleAddContact}
        />
      </div>

      <div className={styles.chatArea}>
        {activeContact ? (
          <>
            <div className={styles.chatHeader}>
              <span className={styles.chatTitle}>{activeContact.name}</span>
              <span className={styles.chatType}>{activeContact.type}</span>
            </div>
            <div className={styles.messageArea}>
              <IMMessageView
                messages={messages}
                currentUserId={userId ?? undefined}
              />
            </div>
            <div className={styles.inputArea}>
              <IMMessageInput
                onSend={handleSend}
                disabled={!activeSessionId}
              />
            </div>
          </>
        ) : (
          <div className={styles.noSelection}>
            <div className={styles.noSelectionHeader}>
              <p>{t('im.noSelection.eyebrow')}</p>
              <h2>{t('im.noSelection.title')}</h2>
              <span>{t('im.noSelection.description')}</span>
            </div>
            <div className={styles.noSelectionGrid}>
              <div className={styles.noSelectionCard}>
                <Users size={17} />
                <strong>{t('im.noSelection.sessionsTitle')}</strong>
                <span>{t('im.noSelection.sessionsDescription')}</span>
              </div>
              <div className={styles.noSelectionCard}>
                <MessageSquare size={17} />
                <strong>{t('im.noSelection.timelineTitle')}</strong>
                <span>{t('im.noSelection.timelineDescription')}</span>
              </div>
              <div className={styles.noSelectionCard}>
                <TerminalSquare size={17} />
                <strong>{t('im.noSelection.dispatchTitle')}</strong>
                <span>{t('im.noSelection.dispatchDescription')}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
