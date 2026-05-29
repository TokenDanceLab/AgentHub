import { useState, useMemo, useCallback } from 'react';
import { LogIn, MessageSquare, ShieldCheck, TerminalSquare, Users, WifiOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ActivityCard, SectionHeader } from '@shared/ui';
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
