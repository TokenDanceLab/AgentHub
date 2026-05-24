import { useState, useMemo, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import type { IMContact, IMMessage } from '@/components/IM/types';
import IMContactList from '@/components/IM/IMContactList';
import IMMessageView from '@/components/IM/IMMessageView';
import IMMessageInput from '@/components/IM/IMMessageInput';
import { useIMChat } from '@/hooks/useIMChat';
import { useHubStore } from '@/stores/hubStore';
import type { HubWSHandle } from '@/api/hubWS';
import type { ViewProps } from '@/config/viewRegistry';
import styles from './IMView.module.css';

export default function IMView({ hubWS: hubWsProp }: ViewProps) {
  const hubWS = (hubWsProp ?? null) as HubWSHandle | null;
  const { getSessionMessages, contacts, sendMessage, upsertContact } = useIMChat({
    hubWS,
  });
  const userId = useHubStore((s) => s.userId);
  const authenticated = useHubStore((s) => s.authenticated);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const messages = useMemo(
    () => (activeSessionId ? getSessionMessages(activeSessionId) : []),
    [activeSessionId, getSessionMessages],
  );

  const activeContact = contacts.find((c) => c.id === activeSessionId);

  const handleSelectContact = useCallback((contact: IMContact) => {
    setActiveSessionId(contact.id);
  }, []);

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

  // Not authenticated: show a prompt to connect
  if (!authenticated) {
    return (
      <div className={styles.root}>
        <div className={styles.empty}>
          <MessageCircle size={48} className={styles.emptyIcon} aria-hidden="true" />
          <span className={styles.emptyTitle}>IM Chat</span>
          <span>Connect to Hub to start chatting</span>
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
            <span>Select a contact to start messaging</span>
          </div>
        )}
      </div>
    </div>
  );
}
