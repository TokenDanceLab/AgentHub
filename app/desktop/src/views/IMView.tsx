import { useState, useMemo, useCallback } from 'react';
import { MessageCircle } from 'lucide-react';
import type { IMContact, IMMessage } from '@/components/IM/types';
import IMContactList from '@/components/IM/IMContactList';
import IMMessageView from '@/components/IM/IMMessageView';
import IMMessageInput from '@/components/IM/IMMessageInput';
import { useIMChat } from '@/hooks/useIMChat';
import { useHubStore } from '@/stores/hubStore';
import type { HubClient } from '@/api/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import type { ViewProps } from '@/config/viewRegistry';
import styles from './IMView.module.css';

export default function IMView(props: ViewProps) {
  const hubWS = (props.hubWS ?? null) as HubWSHandle | null;
  const hubClient = (props.hubClient ?? null) as HubClient | null;
  const {
    getSessionMessages,
    loadSessionMessages,
    contacts,
    hubContacts,
    sendMessage,
    addContact,
    createPrivateSession,
    createGroupSession,
    status,
    error,
  } = useIMChat({
    hubClient,
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
    void loadSessionMessages(contact.id);
  }, [loadSessionMessages]);

  const handleSend = useCallback(
    async (content: string) => {
      if (!activeSessionId) return false;
      const result = await sendMessage(activeSessionId, content);
      return result?.ok !== false;
    },
    [activeSessionId, sendMessage],
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
          hubContacts={hubContacts}
          selectedId={activeSessionId ?? undefined}
          onSelect={handleSelectContact}
          onAddContact={async (userId) => (await addContact(userId)).ok}
          onCreatePrivateSession={async (userId) => (await createPrivateSession(userId)).ok}
          onCreateGroupSession={async (name, memberIds) => (await createGroupSession(name, memberIds)).ok}
        />
      </div>

      <div className={styles.chatArea}>
        {status === 'loading' ? (
          <div className={styles.noSelection}>
            <span>Loading Hub sessions...</span>
          </div>
        ) : status === 'error' ? (
          <div className={styles.noSelection} role="alert">
            <span>{error ?? 'Hub messages are unavailable.'}</span>
          </div>
        ) : contacts.length === 0 ? (
          <div className={styles.noSelection}>
            <span>No Hub conversations yet</span>
          </div>
        ) : activeContact ? (
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
                disabled={!activeSessionId || activeContact.dissolved}
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
