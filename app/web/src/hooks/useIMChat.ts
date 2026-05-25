import { useState, useCallback, useRef, useEffect } from 'react';
import { createHubClient, type MessageResponse, type Session } from '@/api/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import { HUB_EVENTS } from '@shared/hubEvents';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import type { IMMessage, IMContact, AuthorityType } from '@/components/IM/types';
import { newClientMessageId, renderHubContent } from '@/utils/hubAdapters';

interface HubMessageLike {
  id?: string;
  message_id?: string;
  client_msg_id?: string;
  sessionId?: string;
  session_id?: string;
  seq_id?: number;
  sender_id: string;
  sender_type: string;
  content_type?: string;
  content: unknown;
  reply_to_message_id?: string;
  recalled?: boolean;
  created_at?: string;
  sender?: { username?: string; nickname?: string };
}

function hubMessageToIMMessage(msg: HubMessageLike, authority: AuthorityType = 'hub'): IMMessage {
  const sessionId = msg.session_id ?? msg.sessionId ?? '';
  const messageId =
    msg.client_msg_id ?? msg.id ?? msg.message_id ?? `${sessionId}-${msg.seq_id ?? Date.now()}`;
  const senderName = msg.sender?.nickname ?? msg.sender?.username ?? msg.sender_id;
  return {
    id: messageId,
    sessionId,
    senderId: msg.sender_id,
    senderName,
    senderType: msg.sender_type === 'agent' ? 'agent' : 'user',
    authority,
    content: msg.recalled ? '[Message recalled]' : renderHubContent(msg.content),
    timestamp: msg.created_at ?? new Date().toISOString(),
    replyToId: msg.reply_to_message_id,
  };
}

function sessionToContact(session: Session): IMContact {
  const sessionId = session.id ?? session.session_id ?? '';
  return {
    id: sessionId,
    name: session.name || (session.type === 'private' ? 'Private session' : 'Group session'),
    type: session.type === 'private' ? 'user' : 'group',
    authority: 'hub',
    online: false,
    lastSeen: session.updated_at,
  };
}

function mergeMessages(current: IMMessage[], incoming: IMMessage[]): IMMessage[] {
  const byId = new Map<string, IMMessage>();
  for (const msg of current) byId.set(msg.id, msg);
  for (const msg of incoming) byId.set(msg.id, msg);
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

interface UseIMChatOptions {
  hubWS: HubWSHandle | null;
}

export function useIMChat({ hubWS }: UseIMChatOptions) {
  const [messages, setMessages] = useState<Map<string, IMMessage[]>>(new Map());
  const [contacts, setContacts] = useState<IMContact[]>([]);
  const authenticated = useHubStore((s) => s.authenticated);
  const userId = useHubStore((s) => s.userId);
  const addToast = useToastStore((s) => s.addToast);
  const hubWSRef = useRef(hubWS);
  hubWSRef.current = hubWS;
  const hubClientRef = useRef(createHubClient({ getToken: getAccessToken }));

  const refreshSessions = useCallback(async () => {
    if (!authenticated || !getAccessToken()) return;
    try {
      const sessions = await hubClientRef.current.listSessions();
      setContacts(sessions.map(sessionToContact));
    } catch (error) {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to load Hub sessions',
      });
    }
  }, [authenticated, addToast]);

  const loadSessionMessages = useCallback(
    async (sessionId: string) => {
      if (!authenticated || !getAccessToken()) return;
      try {
        const snapshot = await hubClientRef.current.getMessages(sessionId, { limit: 50 });
        const converted = snapshot.map((msg: MessageResponse) => hubMessageToIMMessage(msg));
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(sessionId, mergeMessages(next.get(sessionId) ?? [], converted));
          return next;
        });
        const last = snapshot[snapshot.length - 1];
        if (last?.seq_id) {
          void hubClientRef.current.markRead(sessionId, last.seq_id).catch(() => {});
        }
      } catch (error) {
        addToast({
          type: 'error',
          message: error instanceof Error ? error.message : 'Failed to load Hub messages',
        });
      }
    },
    [authenticated, addToast],
  );

  useEffect(() => {
    if (!authenticated) {
      setContacts([]);
      setMessages(new Map());
      return;
    }
    void refreshSessions();
  }, [authenticated, refreshSessions]);

  // Wire Hub WS message.new events
  useEffect(() => {
    if (!hubWS || !authenticated) return;

    const unsub = hubWS.on(HUB_EVENTS.MESSAGE_NEW, (rawPayload: unknown) => {
      const msg = rawPayload as HubMessageLike;
      const sessionId = msg?.session_id ?? msg?.sessionId;
      const messageId = msg?.id ?? msg?.message_id;
      if (!messageId || !sessionId) return;

      const imMsg = hubMessageToIMMessage(msg);
      setMessages((prev) => {
        const next = new Map(prev);
        const sessionMessages = [...(next.get(sessionId) ?? [])];
        // Deduplicate by id
        if (sessionMessages.some((m) => m.id === imMsg.id)) return prev;
        sessionMessages.push(imMsg);
        next.set(sessionId, sessionMessages);
        return next;
      });
    });

    const unsubSession = hubWS.on(HUB_EVENTS.SESSION_CREATED, (rawPayload: unknown) => {
      const payload = rawPayload as Session | { session_id?: string; type?: string; name?: string };
      const id = ('id' in payload ? payload.id : undefined) ?? payload.session_id;
      if (!id) {
        void refreshSessions();
        return;
      }
      setContacts((prev) => {
        const contact = sessionToContact({ ...payload, id } as Session);
        if (prev.some((item) => item.id === contact.id)) return prev;
        return [contact, ...prev];
      });
    });

    return () => {
      unsub();
      unsubSession();
    };
  }, [hubWS, authenticated, refreshSessions]);

  // Send messages through Hub REST; Hub WS delivers the realtime message.new fanout.
  const sendMessage = useCallback(
    (sessionId: string, content: string) => {
      if (!authenticated || !getAccessToken()) {
        addToast({ type: 'error', message: 'Not connected to Hub' });
        return;
      }
      const clientMsgId = newClientMessageId();
      const optimistic: IMMessage = {
        id: clientMsgId,
        sessionId,
        senderId: userId ?? 'me',
        senderName: 'You',
        senderType: 'user',
        authority: 'hub',
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(sessionId, [...(next.get(sessionId) ?? []), optimistic]);
        return next;
      });
      void hubClientRef.current
        .sendMessage(sessionId, {
          client_msg_id: clientMsgId,
          content_type: 'text',
          content,
        })
        .then((res) => {
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(
              sessionId,
              (next.get(sessionId) ?? []).map((message) =>
                message.id === clientMsgId
                  ? { ...message, id: res.message_id, timestamp: res.created_at }
                  : message,
              ),
            );
            return next;
          });
        })
        .catch((error) => {
          setMessages((prev) => {
            const next = new Map(prev);
            next.set(
              sessionId,
              (next.get(sessionId) ?? []).filter((message) => message.id !== clientMsgId),
            );
            return next;
          });
          addToast({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to send Hub message',
          });
        });
    },
    [authenticated, addToast, userId],
  );

  const sendTyping = useCallback((sessionId: string) => {
    hubWSRef.current?.sendTyping(sessionId);
  }, []);

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
    sendTyping,
    getSessionMessages,
    loadSessionMessages,
    refreshSessions,
    upsertContact,
    removeContact,
    searchContacts,
  } as const;
}
