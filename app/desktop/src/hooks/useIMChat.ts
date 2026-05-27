import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  createHubClient,
  type ContactInfo,
  type FriendRequestInfo,
  type HubClient,
  type HubNotification,
  type MessageResponse,
  type Session,
} from '@/api/hubClient';
import { createHubWS, type HubWSHandle } from '@/api/hubWS';
import type { HubMessage } from '@/api/hubEvents';
import { HUB_EVENTS } from '@shared/hubEvents';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import { useToastStore } from '@/stores/toastStore';
import type { IMMessage, IMContact, AuthorityType } from '@/components/IM/types';

type IMStatus = 'idle' | 'loading' | 'ready' | 'error';
type IMMessageWithHubState = IMMessage & {
  seqId?: number;
};
type IMActionStatus = 'pending' | 'error';
type IMActionState = Record<string, { status: IMActionStatus; error?: string }>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isCallable<TMethod extends keyof HubClient>(client: HubClient, method: TMethod): boolean {
  return typeof client[method] === 'function';
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'Hub action failed';
}

function readTextContent(content: string): string {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).text === 'string') {
      return (parsed as Record<string, string>).text ?? content;
    }
  } catch {
    // Plain text or non-JSON rich payloads should pass through unchanged.
  }
  return content;
}

function sessionIdOf(session: Session): string {
  return session.session_id ?? session.id ?? '';
}

function makeClientMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `desktop-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function hubMessageToIMMessage(
  msg: HubMessage | MessageResponse,
  authority: AuthorityType = 'hub',
): IMMessage {
  const record = msg as unknown as Record<string, unknown>;
  const message: IMMessageWithHubState = {
    id: msg.id,
    sessionId: msg.session_id,
    clientMsgId: readString(record.client_msg_id),
    senderId: msg.sender_id,
    senderName: msg.sender_id,
    senderType: msg.sender_type === 'agent' ? 'agent' : 'user',
    authority,
    content: msg.recalled ? '[Message recalled]' : readTextContent(msg.content),
    timestamp: msg.created_at ?? new Date().toISOString(),
    replyToId: msg.reply_to_message_id,
    recalled: msg.recalled,
    seqId: readNumber(record.seq_id),
    read: Boolean(record.read),
    readAt: readString(record.read_at),
  };
  return message;
}

function sessionToContact(session: Session, contactsByUserId: Map<string, ContactInfo>): IMContact {
  const sessionId = sessionIdOf(session);
  const memberUserIds = session.members
    ?.filter((member) => member.member_type === 'user')
    .map((member) => member.member_id) ?? [];
  const firstKnownMember = memberUserIds
    .map((id) => contactsByUserId.get(id))
    .find(Boolean);
  const lastMessage = session.last_message as Record<string, unknown> | undefined;
  const fallbackName = session.type === 'group' ? 'Group chat' : 'Direct chat';

  return {
    id: sessionId,
    name:
      session.name ??
      firstKnownMember?.remark ??
      firstKnownMember?.nickname ??
      firstKnownMember?.username ??
      fallbackName,
    type: session.type === 'group' ? 'group' : 'user',
    authority: 'hub',
    online: firstKnownMember?.online ?? false,
    avatar: firstKnownMember?.avatar_url,
    lastSeen:
      readString(lastMessage?.content) ??
      session.last_message_at ??
      session.updated_at ??
      session.created_at,
    statusHint:
      session.archived
        ? 'im.session.archived'
        : session.unread_count && session.unread_count > 0
          ? 'im.session.unread'
          : undefined,
    statusHintParams:
      session.unread_count && session.unread_count > 0
        ? { count: session.unread_count }
        : undefined,
    unreadCount: session.unread_count ?? 0,
  };
}

function mergeMessages(existing: IMMessage[], incoming: IMMessage[]): IMMessage[] {
  const byKey = new Map<string, IMMessage>();
  for (const message of existing) {
    byKey.set(message.clientMsgId ?? message.id, message);
    byKey.set(message.id, message);
  }
  for (const message of incoming) {
    const key = message.clientMsgId ?? message.id;
    const previous = byKey.get(message.id) ?? byKey.get(key);
    const merged = previous ? { ...previous, ...message } : message;
    byKey.set(key, merged);
    byKey.set(message.id, merged);
  }

  const unique = Array.from(new Set(byKey.values()));
  unique.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return unique;
}

function getPayloadSession(payload: unknown): Session | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const nested = record.session;
  if (nested && typeof nested === 'object') return nested as Session;
  if (typeof record.id === 'string') return record as unknown as Session;
  if (typeof record.session_id === 'string') {
    return {
      id: record.session_id,
      type: readString(record.type) ?? 'private',
      name: readString(record.name),
      owner_user_id: readString(record.owner_user_id) ?? '',
      updated_at: readString(record.updated_at),
      created_at: readString(record.created_at),
    };
  }
  return null;
}

interface UseIMChatOptions {
  hubClient?: HubClient | null;
  hubWS?: HubWSHandle | null;
}

export interface SendIMMessageResult {
  ok: boolean;
}

export interface HubIMActionResult {
  ok: boolean;
  reason?: 'unauthenticated' | 'interface-gap' | 'failed' | 'invalid';
  error?: string;
}

export function useIMChat({ hubClient, hubWS }: UseIMChatOptions = {}) {
  const defaultHubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const client = hubClient ?? defaultHubClient;
  const [ownedHubWS, setOwnedHubWS] = useState<HubWSHandle | null>(null);
  const activeHubWS = hubWS ?? ownedHubWS;
  const [messages, setMessages] = useState<Map<string, IMMessage[]>>(new Map());
  const [contacts, setContacts] = useState<IMContact[]>([]);
  const [hubContacts, setHubContacts] = useState<ContactInfo[]>([]);
  const [friendRequests, setFriendRequests] = useState<FriendRequestInfo[]>([]);
  const [notifications, setNotifications] = useState<HubNotification[]>([]);
  const [actionState, setActionState] = useState<IMActionState>({});
  const [status, setStatus] = useState<IMStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const authenticated = useHubStore((s) => s.authenticated);
  const userId = useHubStore((s) => s.userId);
  const addToast = useToastStore((s) => s.addToast);
  const contactsByUserIdRef = useRef<Map<string, ContactInfo>>(new Map());

  const actionCapabilities = useMemo(
    () => ({
      friendRequests:
        isCallable(client, 'acceptFriendRequest') &&
        isCallable(client, 'rejectFriendRequest'),
      notifications:
        isCallable(client, 'markNotificationRead') &&
        isCallable(client, 'readAllNotifications'),
      sessionRead: isCallable(client, 'markRead'),
      recallMessage: isCallable(client, 'recallMessage'),
    }),
    [client],
  );

  const markActionPending = useCallback((key: string) => {
    setActionState((prev) => ({ ...prev, [key]: { status: 'pending' } }));
  }, []);

  const markActionError = useCallback((key: string, message: string) => {
    setActionState((prev) => ({ ...prev, [key]: { status: 'error', error: message } }));
  }, []);

  const clearAction = useCallback((key: string) => {
    setActionState((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  useEffect(() => {
    if (hubWS || !authenticated || !getAccessToken()) {
      setOwnedHubWS(null);
      return;
    }

    const handle = createHubWS({ getToken: getAccessToken });
    setOwnedHubWS(handle);
    handle.connect();
    return () => {
      handle.close();
      setOwnedHubWS(null);
    };
  }, [hubWS, authenticated]);

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

  const removeContact = useCallback((contactId: string) => {
    setContacts((prev) => prev.filter((c) => c.id !== contactId));
  }, []);

  const refreshSessions = useCallback(async () => {
    if (!authenticated) {
      setStatus('idle');
      setError(null);
      setContacts([]);
      setHubContacts([]);
      setFriendRequests([]);
      setNotifications([]);
      setActionState({});
      setMessages(new Map());
      return;
    }

    setStatus('loading');
    setError(null);
    try {
      const [contactSnapshot, sessionSnapshot, friendRequestSnapshot, notificationSnapshot] = await Promise.all([
        client.listContacts(),
        client.listSessions(),
        client.listFriendRequests(),
        client.listNotifications({ limit: 20 }),
      ]);
      const contactsByUserId = new Map(contactSnapshot.map((contact) => [contact.user_id, contact]));
      contactsByUserIdRef.current = contactsByUserId;
      setHubContacts(contactSnapshot);
      setFriendRequests(friendRequestSnapshot);
      setNotifications(notificationSnapshot as HubNotification[]);
      setContacts(sessionSnapshot.map((session) => sessionToContact(session, contactsByUserId)));
      setStatus('ready');
    } catch (err) {
      setContacts([]);
      setHubContacts([]);
      setFriendRequests([]);
      setNotifications([]);
      setStatus('error');
      setError('im.state.unavailable');
      addToast({ type: 'error', message: 'Failed to load Hub sessions' });
      console.error('Failed to load IM sessions:', err);
    }
  }, [addToast, authenticated, client]);

  useEffect(() => {
    void refreshSessions();
  }, [refreshSessions]);

  const loadSessionMessages = useCallback(
    async (sessionId: string) => {
      if (!authenticated) return;
      try {
        const snapshot = await client.getMessages(sessionId, { limit: 50 });
        const incoming = snapshot.map((msg) => hubMessageToIMMessage(msg));
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(sessionId, mergeMessages(next.get(sessionId) ?? [], incoming));
          return next;
        });
      } catch (err) {
        addToast({ type: 'error', message: 'Failed to load Hub messages' });
        console.error('Failed to load IM messages:', err);
      }
    },
    [addToast, authenticated, client],
  );

  useEffect(() => {
    if (!activeHubWS || !authenticated) return;

    const unsubMessageNew = activeHubWS.on(HUB_EVENTS.MESSAGE_NEW, (rawPayload: unknown) => {
      const msg = rawPayload as HubMessage;
      if (!msg?.id || !msg?.session_id) return;

      const imMsg = hubMessageToIMMessage(msg);
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(msg.session_id, mergeMessages(next.get(msg.session_id) ?? [], [imMsg]));
        return next;
      });
    });

    const unsubRecall = activeHubWS.on(HUB_EVENTS.MESSAGE_RECALL, (rawPayload: unknown) => {
      const payload = rawPayload as Record<string, unknown>;
      const sessionId = readString(payload.session_id);
      const messageId = readString(payload.message_id) ?? readString(payload.id);
      if (!sessionId || !messageId) return;
      setMessages((prev) => {
        const next = new Map(prev);
        next.set(
          sessionId,
          (next.get(sessionId) ?? []).map((message) =>
            message.id === messageId
              ? { ...message, recalled: true, content: '[Message recalled]' }
              : message,
          ),
        );
        return next;
      });
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === sessionId
            ? { ...contact, statusHint: 'im.session.messageRecalled' }
            : contact,
        ),
      );
    });

    const upsertSessionFromPayload = (payload: unknown) => {
      const session = getPayloadSession(payload);
      if (session && sessionIdOf(session)) {
        upsertContact({
          ...sessionToContact(session, contactsByUserIdRef.current),
          statusHint: 'im.session.updated',
        });
      }
    };

    const unsubSessionCreated = activeHubWS.on(HUB_EVENTS.SESSION_CREATED, upsertSessionFromPayload);
    const unsubSessionUpdated = activeHubWS.on(HUB_EVENTS.SESSION_INFO_UPDATED, upsertSessionFromPayload);
    const unsubSessionDissolved = activeHubWS.on(HUB_EVENTS.SESSION_DISSOLVED, (rawPayload: unknown) => {
      const payload = rawPayload as Record<string, unknown>;
      const sessionId = readString(payload.session_id) ?? readString(payload.id);
      if (!sessionId) return;
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === sessionId
            ? {
                ...contact,
                dissolved: true,
                online: false,
                lastSeen: 'Dissolved',
                statusHint: 'im.session.dissolved',
              }
            : contact,
        ),
      );
    });

    const unsubRead = activeHubWS.on(HUB_EVENTS.MESSAGE_READ, (rawPayload: unknown) => {
      const payload = rawPayload as Record<string, unknown>;
      const sessionId = readString(payload.session_id);
      const readerId = readString(payload.user_id);
      const lastReadSeq = readNumber(payload.last_read_seq);
      const readAt = readString(payload.read_at) ?? new Date().toISOString();
      if (!sessionId || !readerId || lastReadSeq === undefined) return;

      setMessages((prev) => {
        const current = prev.get(sessionId);
        if (!current) return prev;
        const next = new Map(prev);
        next.set(
          sessionId,
          current.map((message) => {
            const hubMessage = message as IMMessageWithHubState;
            if (
              hubMessage.seqId === undefined ||
              hubMessage.seqId > lastReadSeq ||
              hubMessage.senderId === readerId
            ) {
              return message;
            }
            return {
              ...hubMessage,
              read: true,
              readBy: readerId,
              readAt,
            } as IMMessage;
          }),
        );
        return next;
      });
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === sessionId
            ? {
                ...contact,
                statusHint: 'im.session.readThrough',
                statusHintParams: { seq: lastReadSeq },
              }
            : contact,
        ),
      );
    });

    return () => {
      unsubMessageNew();
      unsubRecall();
      unsubSessionCreated();
      unsubSessionUpdated();
      unsubSessionDissolved();
      unsubRead();
    };
  }, [activeHubWS, authenticated, upsertContact]);

  const sendMessage = useCallback(
    async (sessionId: string, content: string): Promise<SendIMMessageResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to send messages' });
        return { ok: false };
      }
      const session = contacts.find((contact) => contact.id === sessionId);
      if (session?.dissolved) {
        addToast({ type: 'error', message: 'This Hub session is no longer available' });
        return { ok: false };
      }

      const clientMsgId = makeClientMessageId();
      try {
        const response = await client.sendMessage(sessionId, {
          client_msg_id: clientMsgId,
          content_type: 'text',
          content,
        });
        const confirmed: IMMessageWithHubState = {
          id: response.message_id,
          sessionId,
          clientMsgId,
          senderId: userId ?? 'me',
          senderName: userId ?? 'Me',
          senderType: 'user',
          authority: 'hub',
          content,
          timestamp: response.created_at,
          recalled: false,
          seqId: response.seq_id,
          read: false,
        };
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(sessionId, mergeMessages(next.get(sessionId) ?? [], [confirmed]));
          return next;
        });
        return { ok: true };
      } catch (err) {
        addToast({ type: 'error', message: 'Failed to send Hub message' });
        console.error('Failed to send IM message:', err);
        return { ok: false };
      }
    },
    [addToast, authenticated, client, contacts, userId],
  );

  const acceptFriendRequest = useCallback(
    async (requestId: string): Promise<HubIMActionResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to accept contact requests' });
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!actionCapabilities.friendRequests) {
        const message = 'Hub friend request action interface is not available';
        markActionError(`friend:${requestId}:accept`, message);
        return { ok: false, reason: 'interface-gap', error: message };
      }

      const key = `friend:${requestId}:accept`;
      markActionPending(key);
      try {
        await client.acceptFriendRequest(requestId);
        clearAction(key);
        setFriendRequests((prev) => prev.filter((request) => request.request_id !== requestId));
        addToast({ type: 'success', message: 'Friend request accepted' });
        void refreshSessions();
        return { ok: true };
      } catch (err) {
        const message = errorMessage(err);
        markActionError(key, message);
        addToast({ type: 'error', message: 'Failed to accept friend request' });
        console.error('Failed to accept friend request:', err);
        return { ok: false, reason: 'failed', error: message };
      }
    },
    [
      actionCapabilities.friendRequests,
      addToast,
      authenticated,
      clearAction,
      client,
      markActionError,
      markActionPending,
      refreshSessions,
    ],
  );

  const rejectFriendRequest = useCallback(
    async (requestId: string): Promise<HubIMActionResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to reject contact requests' });
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!actionCapabilities.friendRequests) {
        const message = 'Hub friend request action interface is not available';
        markActionError(`friend:${requestId}:reject`, message);
        return { ok: false, reason: 'interface-gap', error: message };
      }

      const key = `friend:${requestId}:reject`;
      markActionPending(key);
      try {
        await client.rejectFriendRequest(requestId);
        clearAction(key);
        setFriendRequests((prev) => prev.filter((request) => request.request_id !== requestId));
        addToast({ type: 'success', message: 'Friend request rejected' });
        return { ok: true };
      } catch (err) {
        const message = errorMessage(err);
        markActionError(key, message);
        addToast({ type: 'error', message: 'Failed to reject friend request' });
        console.error('Failed to reject friend request:', err);
        return { ok: false, reason: 'failed', error: message };
      }
    },
    [
      actionCapabilities.friendRequests,
      addToast,
      authenticated,
      clearAction,
      client,
      markActionError,
      markActionPending,
    ],
  );

  const markNotificationRead = useCallback(
    async (notificationId: string): Promise<HubIMActionResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to mark notifications read' });
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!actionCapabilities.notifications) {
        const message = 'Hub notification read interface is not available';
        markActionError(`notification:${notificationId}:read`, message);
        return { ok: false, reason: 'interface-gap', error: message };
      }

      const key = `notification:${notificationId}:read`;
      markActionPending(key);
      try {
        await client.markNotificationRead(notificationId);
        clearAction(key);
        setNotifications((prev) =>
          prev.map((notification) =>
            notification.id === notificationId ? { ...notification, read: true } : notification,
          ),
        );
        return { ok: true };
      } catch (err) {
        const message = errorMessage(err);
        markActionError(key, message);
        addToast({ type: 'error', message: 'Failed to mark notification read' });
        console.error('Failed to mark notification read:', err);
        return { ok: false, reason: 'failed', error: message };
      }
    },
    [
      actionCapabilities.notifications,
      addToast,
      authenticated,
      clearAction,
      client,
      markActionError,
      markActionPending,
    ],
  );

  const readAllNotifications = useCallback(async (): Promise<HubIMActionResult> => {
    if (!authenticated) {
      addToast({ type: 'error', message: 'Connect to Hub to mark notifications read' });
      return { ok: false, reason: 'unauthenticated' };
    }
    if (!actionCapabilities.notifications) {
      const message = 'Hub notification read-all interface is not available';
      markActionError('notification:all:read', message);
      return { ok: false, reason: 'interface-gap', error: message };
    }

    const key = 'notification:all:read';
    markActionPending(key);
    try {
      await client.readAllNotifications();
      clearAction(key);
      setNotifications((prev) => prev.map((notification) => ({ ...notification, read: true })));
      return { ok: true };
    } catch (err) {
      const message = errorMessage(err);
      markActionError(key, message);
      addToast({ type: 'error', message: 'Failed to mark all notifications read' });
      console.error('Failed to mark all notifications read:', err);
      return { ok: false, reason: 'failed', error: message };
    }
  }, [
    actionCapabilities.notifications,
    addToast,
    authenticated,
    clearAction,
    client,
    markActionError,
    markActionPending,
  ]);

  const markSessionRead = useCallback(
    async (sessionId: string): Promise<HubIMActionResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to mark sessions read' });
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!actionCapabilities.sessionRead) {
        const message = 'Hub session read interface is not available';
        markActionError(`session:${sessionId}:read`, message);
        return { ok: false, reason: 'interface-gap', error: message };
      }

      const current = messages.get(sessionId) ?? [];
      const lastReadSeq = current.reduce((max, message) => {
        const seqId = (message as IMMessageWithHubState).seqId;
        return seqId !== undefined && seqId > max ? seqId : max;
      }, 0);
      if (lastReadSeq <= 0) {
        const message = 'No Hub message sequence is loaded for this session';
        markActionError(`session:${sessionId}:read`, message);
        return { ok: false, reason: 'invalid', error: message };
      }

      const key = `session:${sessionId}:read`;
      markActionPending(key);
      try {
        await client.markRead(sessionId, lastReadSeq);
        clearAction(key);
        setContacts((prev) =>
          prev.map((contact) =>
            contact.id === sessionId
              ? {
                  ...contact,
                  unreadCount: 0,
                  statusHint: 'im.session.markedRead',
                  statusHintParams: { seq: lastReadSeq },
                }
              : contact,
          ),
        );
        return { ok: true };
      } catch (err) {
        const message = errorMessage(err);
        markActionError(key, message);
        addToast({ type: 'error', message: 'Failed to mark Hub session read' });
        console.error('Failed to mark Hub session read:', err);
        return { ok: false, reason: 'failed', error: message };
      }
    },
    [
      actionCapabilities.sessionRead,
      addToast,
      authenticated,
      clearAction,
      client,
      markActionError,
      markActionPending,
      messages,
    ],
  );

  const recallMessage = useCallback(
    async (message: IMMessage): Promise<HubIMActionResult> => {
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to recall messages' });
        return { ok: false, reason: 'unauthenticated' };
      }
      if (!actionCapabilities.recallMessage) {
        const error = 'Hub message recall interface is not available';
        markActionError(`message:${message.id}:recall`, error);
        return { ok: false, reason: 'interface-gap', error };
      }
      if (message.recalled) return { ok: true };

      const key = `message:${message.id}:recall`;
      markActionPending(key);
      try {
        await client.recallMessage(message.id);
        clearAction(key);
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(
            message.sessionId,
            (next.get(message.sessionId) ?? []).map((item) =>
              item.id === message.id
                ? {
                    ...item,
                    recalled: true,
                    content: '[Message recalled]',
                    actionError: undefined,
                  }
                : item,
            ),
          );
          return next;
        });
        return { ok: true };
      } catch (err) {
        const messageText = errorMessage(err);
        markActionError(key, messageText);
        setMessages((prev) => {
          const next = new Map(prev);
          next.set(
            message.sessionId,
            (next.get(message.sessionId) ?? []).map((item) =>
              item.id === message.id ? { ...item, actionError: messageText } : item,
            ),
          );
          return next;
        });
        addToast({ type: 'error', message: 'Failed to recall Hub message' });
        console.error('Failed to recall IM message:', err);
        return { ok: false, reason: 'failed', error: messageText };
      }
    },
    [
      actionCapabilities.recallMessage,
      addToast,
      authenticated,
      clearAction,
      client,
      markActionError,
      markActionPending,
    ],
  );

  const addContact = useCallback(
    async (targetUserId: string): Promise<HubIMActionResult> => {
      const trimmed = targetUserId.trim();
      if (!trimmed) return { ok: false };
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to add contacts' });
        return { ok: false };
      }

      try {
        await client.searchUser(trimmed);
        await client.sendFriendRequest(trimmed);
        addToast({ type: 'success', message: 'Friend request sent' });
        await refreshSessions();
        return { ok: true };
      } catch (err) {
        addToast({ type: 'error', message: 'Failed to add Hub contact' });
        console.error('Failed to add Hub contact:', err);
        return { ok: false };
      }
    },
    [addToast, authenticated, client, refreshSessions],
  );

  const createPrivateSession = useCallback(
    async (targetUserId: string): Promise<HubIMActionResult> => {
      const trimmed = targetUserId.trim();
      if (!trimmed) return { ok: false };
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to create chats' });
        return { ok: false };
      }

      try {
        const session = await client.createPrivateSession({ target_user_id: trimmed });
        upsertContact(sessionToContact(session, contactsByUserIdRef.current));
        await refreshSessions();
        addToast({ type: 'success', message: 'Direct chat created' });
        return { ok: true };
      } catch (err) {
        addToast({ type: 'error', message: 'Failed to create Hub direct chat' });
        console.error('Failed to create Hub direct chat:', err);
        return { ok: false };
      }
    },
    [addToast, authenticated, client, refreshSessions, upsertContact],
  );

  const createGroupSession = useCallback(
    async (name: string, memberIds: string[]): Promise<HubIMActionResult> => {
      const trimmedName = name.trim();
      const trimmedMemberIds = Array.from(
        new Set(memberIds.map((id) => id.trim()).filter(Boolean)),
      );
      if (!trimmedName || trimmedMemberIds.length === 0) return { ok: false };
      if (!authenticated) {
        addToast({ type: 'error', message: 'Connect to Hub to create groups' });
        return { ok: false };
      }

      try {
        const session = await client.createGroupSession({
          name: trimmedName,
          member_ids: trimmedMemberIds,
        });
        upsertContact(sessionToContact(session, contactsByUserIdRef.current));
        await refreshSessions();
        addToast({ type: 'success', message: 'Group chat created' });
        return { ok: true };
      } catch (err) {
        addToast({ type: 'error', message: 'Failed to create Hub group chat' });
        console.error('Failed to create Hub group chat:', err);
        return { ok: false };
      }
    },
    [addToast, authenticated, client, refreshSessions, upsertContact],
  );

  const getSessionMessages = useCallback(
    (sessionId: string): IMMessage[] => messages.get(sessionId) ?? [],
    [messages],
  );

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
    hubContacts,
    friendRequests,
    notifications,
    actionState,
    actionCapabilities,
    status,
    error,
    sendMessage,
    getSessionMessages,
    loadSessionMessages,
    refreshSessions,
    upsertContact,
    removeContact,
    searchContacts,
    addContact,
    createPrivateSession,
    createGroupSession,
    acceptFriendRequest,
    rejectFriendRequest,
    markNotificationRead,
    readAllNotifications,
    markSessionRead,
    recallMessage,
  } as const;
}
