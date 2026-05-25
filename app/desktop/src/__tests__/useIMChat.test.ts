import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useIMChat } from '@/hooks/useIMChat';
import type { HubClient } from '@/api/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import type { HubEventType } from '@shared/hubEvents';
import { HUB_EVENTS } from '@shared/hubEvents';

const addToast = vi.fn();
let authenticated = true;

vi.mock('@/hooks/useAuth', () => ({
  getAccessToken: () => 'token',
}));

vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn((selector?: (s: { authenticated: boolean; userId: string | null }) => unknown) => {
    const state = { authenticated, userId: 'user-1' };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: vi.fn((selector?: (s: { addToast: typeof addToast }) => unknown) => {
    const state = { addToast };
    return selector ? selector(state) : state;
  }),
}));

interface HandlerEntry {
  type: HubEventType;
  fn: (payload: unknown) => void;
}

function createMockHubWS(): HubWSHandle & { _handlers: HandlerEntry[] } {
  const handlers: HandlerEntry[] = [];
  return {
    _handlers: handlers,
    connect: vi.fn(),
    send: vi.fn(),
    sendTyping: vi.fn(),
    on: vi.fn((type: HubEventType, handler: (payload: unknown) => void) => {
      handlers.push({ type, fn: handler });
      return () => {
        const idx = handlers.findIndex((h) => h.fn === handler);
        if (idx >= 0) handlers.splice(idx, 1);
      };
    }),
    onAny: vi.fn(),
    onStatus: vi.fn(),
    close: vi.fn(),
    reconnect: vi.fn(),
    getStatus: vi.fn(() => 'connected' as const),
    isAuthenticated: vi.fn(() => true),
  };
}

function fire(ws: ReturnType<typeof createMockHubWS>, type: HubEventType, payload: unknown) {
  const handler = ws._handlers.find((h) => h.type === type);
  if (handler) handler.fn(payload);
}

function createMockHubClient(overrides: Partial<HubClient> = {}): HubClient {
  return {
    listContacts: vi.fn(async () => [
      {
        user_id: 'friend-1',
        username: 'alice',
        nickname: 'Alice',
        online: true,
        type: 'friend',
      },
    ]),
    listSessions: vi.fn(async () => [
      {
        id: 'sess-1',
        type: 'private',
        owner_user_id: 'user-1',
        members: [
          {
            id: 'member-1',
            session_id: 'sess-1',
            member_type: 'user',
            member_id: 'friend-1',
            role: 'member',
          },
        ],
      },
    ]),
    listFriendRequests: vi.fn(async () => [
      {
        request_id: 'fr-1',
        user_id: 'friend-2',
        username: 'bob',
        nickname: 'Bob',
        message: 'hi',
        created_at: '2026-05-25T00:00:00.000Z',
      },
    ]),
    listNotifications: vi.fn(async () => [
      {
        id: 'notif-1',
        user_id: 'user-1',
        type: 'mention',
        payload: JSON.stringify({ title: 'Mention' }),
        read: false,
        created_at: '2026-05-25T00:00:00.000Z',
      },
    ]),
    getMessages: vi.fn(async () => [
      {
        id: 'm1',
        session_id: 'sess-1',
        seq_id: 1,
        client_msg_id: 'client-1',
        sender_type: 'user',
        sender_id: 'friend-1',
        content_type: 'text',
        content: 'Hello',
        recalled: false,
        created_at: '2026-05-25T00:00:00.000Z',
      },
    ]),
    sendMessage: vi.fn(async () => ({
      message_id: 'm-out',
      seq_id: 2,
      created_at: '2026-05-25T00:01:00.000Z',
    })),
    searchUser: vi.fn(async () => ({
      user_id: 'friend-2',
      username: 'bob',
      nickname: 'Bob',
      relationship: 'none',
    })),
    sendFriendRequest: vi.fn(async () => undefined),
    acceptFriendRequest: vi.fn(async () => undefined),
    rejectFriendRequest: vi.fn(async () => undefined),
    createPrivateSession: vi.fn(async () => ({
      id: 'sess-private',
      type: 'private',
      owner_user_id: 'user-1',
      members: [
        {
          id: 'member-2',
          session_id: 'sess-private',
          member_type: 'user',
          member_id: 'friend-2',
          role: 'member',
        },
      ],
    })),
    createGroupSession: vi.fn(async () => ({
      id: 'sess-group',
      type: 'group',
      name: 'Build Room',
      owner_user_id: 'user-1',
    })),
    markNotificationRead: vi.fn(async () => undefined),
    readAllNotifications: vi.fn(async () => undefined),
    markRead: vi.fn(async () => undefined),
    recallMessage: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as HubClient;
}

describe('useIMChat', () => {
  beforeEach(() => {
    authenticated = true;
    addToast.mockClear();
    vi.clearAllMocks();
  });

  it('loads contacts and sessions as Hub conversation rows', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));

    await waitFor(() => expect(result.current.contacts).toHaveLength(1));
    expect(hubClient.listContacts).toHaveBeenCalled();
    expect(hubClient.listSessions).toHaveBeenCalled();
    expect(hubClient.listFriendRequests).toHaveBeenCalled();
    expect(hubClient.listNotifications).toHaveBeenCalledWith({ limit: 20 });
    expect(result.current.friendRequests).toHaveLength(1);
    expect(result.current.notifications).toHaveLength(1);
    expect(result.current.contacts[0]).toMatchObject({
      id: 'sess-1',
      name: 'Alice',
      type: 'user',
      authority: 'hub',
      online: true,
    });
  });

  it('maps Hub session_id list items as conversation ids', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      listSessions: vi.fn(async () => [
        {
          session_id: 'sess-real',
          type: 'private',
          name: 'Real DM',
          owner_user_id: 'user-1',
          last_message_at: '2026-05-25T00:02:00.000Z',
        },
      ]),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));

    await waitFor(() => expect(result.current.contacts).toHaveLength(1));
    expect(result.current.contacts[0]).toMatchObject({
      id: 'sess-real',
      name: 'Real DM',
      type: 'user',
      authority: 'hub',
    });
  });

  it('loads messages when a session is selected', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.loadSessionMessages('sess-1');
    });

    expect(hubClient.getMessages).toHaveBeenCalledWith('sess-1', { limit: 50 });
    expect(result.current.getSessionMessages('sess-1')[0].content).toBe('Hello');
  });

  it('renders Hub JSON text message content as plain text', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      getMessages: vi.fn(async () => [
        {
          id: 'm-json',
          session_id: 'sess-1',
          seq_id: 1,
          client_msg_id: 'client-json',
          sender_type: 'user',
          sender_id: 'friend-1',
          content_type: 'text',
          content: '{"text":"Hello from Hub"}',
          recalled: false,
          created_at: '2026-05-25T00:00:00.000Z',
        },
      ]),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.loadSessionMessages('sess-1');
    });

    expect(result.current.getSessionMessages('sess-1')[0].content).toBe('Hello from Hub');
  });

  it('sendMessage uses Hub REST and records the confirmed response', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('sess-1', 'From desktop');
    });

    expect(hubClient.sendMessage).toHaveBeenCalledWith('sess-1', {
      client_msg_id: expect.any(String),
      content_type: 'text',
      content: 'From desktop',
    });
    expect(result.current.getSessionMessages('sess-1')[0]).toMatchObject({
      id: 'm-out',
      content: 'From desktop',
      senderId: 'user-1',
    });
  });

  it('does not add a fake message when REST send fails', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      sendMessage: vi.fn(async () => {
        throw new Error('network down');
      }),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('sess-1', 'Lost');
    });

    expect(result.current.getSessionMessages('sess-1')).toHaveLength(0);
    expect(addToast).toHaveBeenCalledWith({ type: 'error', message: 'Failed to send Hub message' });
  });

  it('deduplicates message.new against a REST-confirmed client message', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('sess-1', 'Merged');
    });
    const confirmed = result.current.getSessionMessages('sess-1')[0];

    act(() => {
      fire(ws, HUB_EVENTS.MESSAGE_NEW, {
        id: 'm-out',
        session_id: 'sess-1',
        seq_id: 2,
        client_msg_id: confirmed.clientMsgId,
        sender_type: 'user',
        sender_id: 'user-1',
        content_type: 'text',
        content: 'Merged',
        recalled: false,
        created_at: '2026-05-25T00:01:00.000Z',
      });
    });

    expect(result.current.getSessionMessages('sess-1')).toHaveLength(1);
  });

  it('marks messages read from Hub message.read receipts', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.sendMessage('sess-1', 'Needs receipt');
    });

    act(() => {
      fire(ws, HUB_EVENTS.MESSAGE_READ, {
        session_id: 'sess-1',
        user_id: 'friend-1',
        last_read_seq: 2,
        read_at: '2026-05-25T00:03:00.000Z',
      });
    });

    expect(result.current.getSessionMessages('sess-1')[0]).toMatchObject({
      id: 'm-out',
      read: true,
      readBy: 'friend-1',
      readAt: '2026-05-25T00:03:00.000Z',
    });
    expect(result.current.contacts[0]).toMatchObject({
      statusHint: 'im.session.readThrough',
      statusHintParams: { seq: 2 },
    });
  });

  it('shows recall and session lifecycle hints from Hub WS events', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.loadSessionMessages('sess-1');
    });

    act(() => {
      fire(ws, HUB_EVENTS.MESSAGE_RECALL, {
        session_id: 'sess-1',
        message_id: 'm1',
      });
    });

    expect(result.current.getSessionMessages('sess-1')[0]).toMatchObject({
      recalled: true,
      content: '[Message recalled]',
    });
    expect(result.current.contacts[0]).toMatchObject({
      statusHint: 'im.session.messageRecalled',
    });

    act(() => {
      fire(ws, HUB_EVENTS.SESSION_DISSOLVED, {
        session_id: 'sess-1',
      });
    });

    expect(result.current.contacts[0]).toMatchObject({
      dissolved: true,
      online: false,
      statusHint: 'im.session.dissolved',
    });
  });

  it('adds a session when Hub WS emits session.created', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({ listSessions: vi.fn(async () => []) });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => {
      fire(ws, HUB_EVENTS.SESSION_CREATED, {
        id: 'sess-2',
        type: 'group',
        name: 'Build Room',
        owner_user_id: 'user-1',
      });
    });

    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.contacts[0]).toMatchObject({
      id: 'sess-2',
      name: 'Build Room',
      type: 'group',
      statusHint: 'im.session.updated',
    });
  });

  it('uses Hub contact search before sending a friend request', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.addContact('friend-2');
    });

    expect(hubClient.searchUser).toHaveBeenCalledWith('friend-2');
    expect(hubClient.sendFriendRequest).toHaveBeenCalledWith('friend-2');
  });

  it('accepts friend requests through Hub and keeps action state recoverable on failure', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      acceptFriendRequest: vi
        .fn()
        .mockRejectedValueOnce(new Error('accept failed'))
        .mockResolvedValueOnce(undefined),
      listFriendRequests: vi
        .fn()
        .mockResolvedValueOnce([
          {
            request_id: 'fr-1',
            user_id: 'friend-2',
            username: 'bob',
            nickname: 'Bob',
            message: 'hi',
            created_at: '2026-05-25T00:00:00.000Z',
          },
        ])
        .mockResolvedValueOnce([]),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.friendRequests).toHaveLength(1));

    await act(async () => {
      const response = await result.current.acceptFriendRequest('fr-1');
      expect(response).toMatchObject({ ok: false, reason: 'failed', error: 'accept failed' });
    });

    expect(result.current.friendRequests).toHaveLength(1);
    expect(result.current.actionState['friend:fr-1:accept']).toMatchObject({
      status: 'error',
      error: 'accept failed',
    });

    await act(async () => {
      await result.current.acceptFriendRequest('fr-1');
    });

    expect(hubClient.acceptFriendRequest).toHaveBeenCalledWith('fr-1');
    expect(result.current.friendRequests).toHaveLength(0);
    expect(result.current.actionState['friend:fr-1:accept']).toBeUndefined();
  });

  it('rejects friend requests only after Hub confirms', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.friendRequests).toHaveLength(1));

    await act(async () => {
      await result.current.rejectFriendRequest('fr-1');
    });

    expect(hubClient.rejectFriendRequest).toHaveBeenCalledWith('fr-1');
    expect(result.current.friendRequests).toHaveLength(0);
  });

  it('marks notifications read and read-all through Hub without fake success on failure', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      markNotificationRead: vi.fn(async () => {
        throw new Error('read failed');
      }),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.notifications).toHaveLength(1));

    await act(async () => {
      await result.current.markNotificationRead('notif-1');
    });

    expect(result.current.notifications[0]?.read).toBe(false);
    expect(result.current.actionState['notification:notif-1:read']).toMatchObject({
      status: 'error',
      error: 'read failed',
    });

    await act(async () => {
      await result.current.readAllNotifications();
    });

    expect(hubClient.readAllNotifications).toHaveBeenCalled();
    expect(result.current.notifications[0]?.read).toBe(true);
  });

  it('marks a loaded session read through Hub using the latest sequence', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));
    await act(async () => {
      await result.current.loadSessionMessages('sess-1');
      await result.current.sendMessage('sess-1', 'Needs local read state');
    });

    await act(async () => {
      await result.current.markSessionRead('sess-1');
    });

    expect(hubClient.markRead).toHaveBeenCalledWith('sess-1', 2);
    expect(result.current.contacts[0]).toMatchObject({
      unreadCount: 0,
      statusHint: 'im.session.markedRead',
      statusHintParams: { seq: 2 },
    });
  });

  it('recalls messages through Hub and preserves recoverable state on failure', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient({
      recallMessage: vi.fn(async () => {
        throw new Error('recall failed');
      }),
    });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));
    await act(async () => {
      await result.current.sendMessage('sess-1', 'Recall me');
    });
    const message = result.current.getSessionMessages('sess-1')[0];

    await act(async () => {
      await result.current.recallMessage(message);
    });

    expect(hubClient.recallMessage).toHaveBeenCalledWith('m-out');
    expect(result.current.getSessionMessages('sess-1')[0]).toMatchObject({
      id: 'm-out',
      content: 'Recall me',
      recalled: false,
      actionError: 'recall failed',
    });
  });

  it('reports interface gaps when an injected client omits optional IM action methods', async () => {
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();
    delete (hubClient as unknown as { acceptFriendRequest?: unknown }).acceptFriendRequest;

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.friendRequests).toHaveLength(1));

    await act(async () => {
      const response = await result.current.acceptFriendRequest('fr-1');
      expect(response).toMatchObject({ ok: false, reason: 'interface-gap' });
    });

    expect(result.current.friendRequests).toHaveLength(1);
    expect(result.current.actionCapabilities.friendRequests).toBe(false);
  });

  it('creates private sessions through Hub without fake local contacts', async () => {
    const ws = createMockHubWS();
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'sess-1',
          type: 'private',
          owner_user_id: 'user-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sess-private',
          type: 'private',
          owner_user_id: 'user-1',
          members: [
            {
              id: 'member-2',
              session_id: 'sess-private',
              member_type: 'user',
              member_id: 'friend-2',
              role: 'member',
            },
          ],
        },
      ]);
    const hubClient = createMockHubClient({ listSessions });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.createPrivateSession('friend-2');
    });

    expect(hubClient.createPrivateSession).toHaveBeenCalledWith({ target_user_id: 'friend-2' });
    expect(hubClient.listSessions).toHaveBeenCalledTimes(2);
    expect(result.current.contacts.some((contact) => contact.id === 'sess-private')).toBe(true);
  });

  it('creates group sessions through Hub with trimmed member IDs', async () => {
    const ws = createMockHubWS();
    const listSessions = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: 'sess-1',
          type: 'private',
          owner_user_id: 'user-1',
        },
      ])
      .mockResolvedValueOnce([
        {
          id: 'sess-group',
          type: 'group',
          name: 'Build Room',
          owner_user_id: 'user-1',
        },
      ]);
    const hubClient = createMockHubClient({ listSessions });

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));
    await waitFor(() => expect(result.current.contacts).toHaveLength(1));

    await act(async () => {
      await result.current.createGroupSession(' Build Room ', [' friend-2 ', 'friend-3', 'friend-2']);
    });

    expect(hubClient.createGroupSession).toHaveBeenCalledWith({
      name: 'Build Room',
      member_ids: ['friend-2', 'friend-3'],
    });
    expect(hubClient.listSessions).toHaveBeenCalledTimes(2);
    expect(result.current.contacts.some((contact) => contact.id === 'sess-group')).toBe(true);
  });

  it('shows an idle empty state when signed out', async () => {
    authenticated = false;
    const ws = createMockHubWS();
    const hubClient = createMockHubClient();

    const { result } = renderHook(() => useIMChat({ hubClient, hubWS: ws }));

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(hubClient.listSessions).not.toHaveBeenCalled();
    expect(hubClient.listFriendRequests).not.toHaveBeenCalled();
    expect(hubClient.listNotifications).not.toHaveBeenCalled();
    expect(result.current.contacts).toHaveLength(0);
  });
});
