import { useState, useCallback, useRef, useEffect } from 'react';
import type { HubWSHandle } from '@/api/hubWS';
import type { HubMessage } from '@/api/hubEvents';
import { HUB_EVENTS } from '@shared/hubEvents';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import type { IMMessage, IMContact, AuthorityType } from '@/components/IM/types';

function hubMessageToIMMessage(msg: HubMessage, authority: AuthorityType = 'hub'): IMMessage {
  return {
    id: msg.id,
    sessionId: msg.session_id,
    senderId: msg.sender_id,
    senderName: msg.sender_id,
    senderType: msg.sender_type === 'agent' ? 'agent' : 'user',
    authority,
    content: msg.recalled ? '[Message recalled]' : msg.content,
    timestamp: msg.created_at,
    replyToId: msg.reply_to_message_id,
  };
}

interface UseIMChatOptions {
  hubWS: HubWSHandle | null;
}

export function useIMChat({ hubWS }: UseIMChatOptions) {
  const [messages, setMessages] = useState<Map<string, IMMessage[]>>(new Map());
  const [contacts, setContacts] = useState<IMContact[]>([]);
  const authenticated = useHubStore((s) => s.authenticated);
  const addToast = useToastStore((s) => s.addToast);
  const hubWSRef = useRef(hubWS);
  hubWSRef.current = hubWS;

  // Wire Hub WS message.new events
  useEffect(() => {
    if (!hubWS || !authenticated) return;

    const unsub = hubWS.on(HUB_EVENTS.MESSAGE_NEW, (rawPayload: unknown) => {
      const msg = rawPayload as HubMessage;
      if (!msg?.id || !msg?.session_id) return;

      const imMsg = hubMessageToIMMessage(msg);
      setMessages((prev) => {
        const next = new Map(prev);
        const sessionMessages = [...(next.get(msg.session_id) ?? [])];
        // Deduplicate by id
        if (sessionMessages.some((m) => m.id === imMsg.id)) return prev;
        sessionMessages.push(imMsg);
        next.set(msg.session_id, sessionMessages);
        return next;
      });
    });

    return () => {
      unsub();
    };
  }, [hubWS, authenticated]);

  // Send a message through Hub WS
  const sendMessage = useCallback(
    (sessionId: string, content: string) => {
      const ws = hubWSRef.current;
      if (!ws || !authenticated) {
        addToast({ type: 'error', message: 'Not connected to Hub' });
        return;
      }
      ws.send('message.send', { session_id: sessionId, content });
    },
    [authenticated, addToast],
  );

  // Get messages for a specific session
  const getSessionMessages = useCallback(
    (sessionId: string): IMMessage[] => messages.get(sessionId) ?? [],
    [messages],
  );

  // Add or update a contact
  const upsertContact = useCallback((contact: IMContact) => {
    setContacts((prev) => {
      const idx = prev.findIndex((c) => c.id === contact.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...contact };
        return next;
      }
      return [...prev, contact];
    });
  }, []);

  // Remove a contact
  const removeContact = useCallback((contactId: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  }, []);

  // Search contacts by name
  const searchContacts = useCallback(
    (query: string): IMContact[] => {
      if (!query.trim()) return contacts;
      const lower = query.toLowerCase();
      return contacts.filter((c) => c.name.toLowerCase().includes(lower));
    },
    [contacts],
  );

  return {
    messages,
    contacts,
    sendMessage,
    getSessionMessages,
    upsertContact,
    removeContact,
    searchContacts,
  } as const;
}
