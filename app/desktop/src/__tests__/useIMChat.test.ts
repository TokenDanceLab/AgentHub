import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIMChat } from '@/hooks/useIMChat';
import type { HubWSHandle } from '@/api/hubWS';
import type { HubEventType } from '@shared/hubEvents';
import { HUB_EVENTS } from '@shared/hubEvents';
import type { IMContact } from '@/components/IM';

// Mock useHubStore
vi.mock('@/stores/hubStore', () => ({
  useHubStore: vi.fn((selector?: (s: { authenticated: boolean }) => unknown) => {
    const state = { authenticated: true };
    return selector ? selector(state) : state;
  }),
}));

// Mock useToastStore
vi.mock('@/stores/toastStore', () => ({
  useToastStore: vi.fn((selector?: (s: { addToast: () => void }) => unknown) => {
    const state = { addToast: vi.fn() };
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

function fireMessageNew(ws: ReturnType<typeof createMockHubWS>, msg: Record<string, unknown>) {
  const handler = ws._handlers.find((h) => h.type === HUB_EVENTS.MESSAGE_NEW);
  if (handler) handler.fn(msg);
}

describe('useIMChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns stable API shape', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));
    expect(result.current).toHaveProperty('messages');
    expect(result.current).toHaveProperty('contacts');
    expect(result.current).toHaveProperty('sendMessage');
    expect(result.current).toHaveProperty('getSessionMessages');
    expect(result.current).toHaveProperty('upsertContact');
    expect(result.current).toHaveProperty('removeContact');
    expect(result.current).toHaveProperty('searchContacts');
  });

  it('adds message when Hub WS emits message.new', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      fireMessageNew(ws, {
        id: 'm1',
        session_id: 'sess-1',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        content_type: 'text',
        content: 'Hello!',
        recalled: false,
        created_at: new Date().toISOString(),
      });
    });

    const msgs = result.current.getSessionMessages('sess-1');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('Hello!');
    expect(msgs[0].senderType).toBe('user');
    expect(msgs[0].authority).toBe('hub');
  });

  it('deduplicates messages by id', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));
    const msgPayload = {
      id: 'm1',
      session_id: 'sess-1',
      seq_id: 1,
      sender_type: 'user',
      sender_id: 'user-1',
      content_type: 'text',
      content: 'Hello!',
      recalled: false,
      created_at: new Date().toISOString(),
    };

    act(() => {
      fireMessageNew(ws, msgPayload);
    });
    act(() => {
      fireMessageNew(ws, msgPayload);
    });

    expect(result.current.getSessionMessages('sess-1')).toHaveLength(1);
  });

  it('ignores messages without id or session_id', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      fireMessageNew(ws, { session_id: 'sess-1' }); // no id
    });
    act(() => {
      fireMessageNew(ws, { id: 'm1' }); // no session_id
    });

    expect(result.current.getSessionMessages('sess-1')).toHaveLength(0);
  });

  it('marks recalled messages', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      fireMessageNew(ws, {
        id: 'm1',
        session_id: 'sess-1',
        seq_id: 1,
        sender_type: 'user',
        sender_id: 'user-1',
        content_type: 'text',
        content: 'original',
        recalled: true,
        created_at: new Date().toISOString(),
      });
    });

    expect(result.current.getSessionMessages('sess-1')[0].content).toBe('[Message recalled]');
  });

  it('separates messages by session', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      fireMessageNew(ws, {
        id: 'm1', session_id: 'sess-1', seq_id: 1,
        sender_type: 'user', sender_id: 'u1', content_type: 'text',
        content: 'A', recalled: false, created_at: new Date().toISOString(),
      });
      fireMessageNew(ws, {
        id: 'm2', session_id: 'sess-2', seq_id: 1,
        sender_type: 'user', sender_id: 'u2', content_type: 'text',
        content: 'B', recalled: false, created_at: new Date().toISOString(),
      });
    });

    expect(result.current.getSessionMessages('sess-1')).toHaveLength(1);
    expect(result.current.getSessionMessages('sess-2')).toHaveLength(1);
    expect(result.current.getSessionMessages('sess-3')).toHaveLength(0);
  });

  it('upsertContact adds a new contact', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.upsertContact({
        id: 'c1', name: 'Alice', type: 'user', online: true,
      });
    });

    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.contacts[0].name).toBe('Alice');
  });

  it('upsertContact updates existing contact', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.upsertContact({
        id: 'c1', name: 'Alice', type: 'user', online: true,
      });
    });
    act(() => {
      result.current.upsertContact({
        id: 'c1', name: 'Alice Updated', type: 'user', online: false,
      });
    });

    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.contacts[0].name).toBe('Alice Updated');
    expect(result.current.contacts[0].online).toBe(false);
  });

  it('removeContact deletes a contact', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.upsertContact({ id: 'c1', name: 'Alice', type: 'user', online: true });
      result.current.upsertContact({ id: 'c2', name: 'Bob', type: 'user', online: true });
    });
    act(() => {
      result.current.removeContact('c1');
    });

    expect(result.current.contacts).toHaveLength(1);
    expect(result.current.contacts[0].id).toBe('c2');
  });

  it('searchContacts returns all when query is empty', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.upsertContact({ id: 'c1', name: 'Alice', type: 'user', online: true });
      result.current.upsertContact({ id: 'c2', name: 'Bob', type: 'user', online: true });
    });

    expect(result.current.searchContacts('')).toHaveLength(2);
  });

  it('searchContacts filters by name', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.upsertContact({ id: 'c1', name: 'Alice', type: 'user', online: true });
      result.current.upsertContact({ id: 'c2', name: 'Bob', type: 'user', online: true });
    });

    expect(result.current.searchContacts('ali')).toHaveLength(1);
    expect(result.current.searchContacts('ali')[0].name).toBe('Alice');
  });

  it('sendMessage sends through Hub WS', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      result.current.sendMessage('sess-1', 'Hello!');
    });

    expect(ws.send).toHaveBeenCalledWith('message.send', {
      session_id: 'sess-1',
      content: 'Hello!',
    });
  });

  it('handles agent messages with senderType agent', () => {
    const ws = createMockHubWS();
    const { result } = renderHook(() => useIMChat({ hubWS: ws }));

    act(() => {
      fireMessageNew(ws, {
        id: 'm1', session_id: 'sess-1', seq_id: 1,
        sender_type: 'agent', sender_id: 'claude-1', content_type: 'text',
        content: 'Processing done', recalled: false, created_at: new Date().toISOString(),
      });
    });

    const msg = result.current.getSessionMessages('sess-1')[0];
    expect(msg.senderType).toBe('agent');
  });
});
