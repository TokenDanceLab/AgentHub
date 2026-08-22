import { describe, expect, it, vi } from 'vitest';

import { startHubLifecycleBridge, type MobileAppStateStatus } from './hubLifecycle';
import type { HubWebSocketLike } from './hubEvents';

class FakeSocket implements HubWebSocketLike {
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  close = vi.fn();

  emitMessage(data: unknown) {
    this.onmessage?.({ data });
  }

  emitClose() {
    this.onclose?.({ code: 1000, reason: 'fake close' });
  }
}

class FakeAppState {
  currentState: MobileAppStateStatus;
  private listeners = new Set<(state: MobileAppStateStatus) => void>();

  constructor(initialState: MobileAppStateStatus) {
    this.currentState = initialState;
  }

  addEventListener(_event: 'change', listener: (state: MobileAppStateStatus) => void) {
    this.listeners.add(listener);

    return {
      remove: () => {
        this.listeners.delete(listener);
      },
    };
  }

  transition(nextState: MobileAppStateStatus) {
    this.currentState = nextState;
    this.listeners.forEach((listener) => listener(nextState));
  }

  get listenerCount() {
    return this.listeners.size;
  }
}

describe('Mobile Hub lifecycle bridge', () => {
  it('connects to /client/ws and tracks cursor via seq_id', () => {
    const appState = new FakeAppState('active');
    const sockets: FakeSocket[] = [];
    const statuses: string[] = [];
    const resyncs: unknown[] = [];
    const createWebSocket = vi.fn((_url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    const bridge = startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      createWebSocket,
      onStatusChange: (status) => statuses.push(status),
      onResyncRequired: (resync) => resyncs.push(resync),
    });

    expect(createWebSocket).toHaveBeenCalledWith('wss://hub.example.test/client/ws', undefined);

    // Server frame: { type, payload, seq_id }
    sockets[0]?.emitMessage(
      JSON.stringify({
        type: 'message.new',
        payload: { session_id: 's1', content: 'hello' },
        seq_id: 10,
      }),
    );

    appState.transition('background');

    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('suspended');

    appState.transition('active');

    expect(resyncs).toEqual([{ reason: 'foreground', since: '10' }]);
    expect(createWebSocket).toHaveBeenLastCalledWith(
      'wss://hub.example.test/client/ws?since=10',
      undefined,
    );
    expect(bridge.getCursor()).toBe('10');
  });

  it('stays suspended for an initially backgrounded app until foreground resumes', () => {
    const appState = new FakeAppState('background');
    const createWebSocket = vi.fn(() => new FakeSocket());
    const statuses: string[] = [];

    startHubLifecycleBridge({
      appState,
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket,
      initialSince: '5',
      onStatusChange: (status) => statuses.push(status),
    });

    expect(createWebSocket).not.toHaveBeenCalled();
    expect(statuses).toEqual(['suspended']);

    appState.transition('active');

    expect(createWebSocket).toHaveBeenCalledWith(
      'ws://127.0.0.1:8080/client/ws?since=5',
      undefined,
    );
    expect(statuses).toContain('resync_required');
  });

  it('reconnects with a resync request when the foreground stream closes remotely', () => {
    const appState = new FakeAppState('active');
    const sockets: FakeSocket[] = [];
    const resyncs: unknown[] = [];
    const createWebSocket = vi.fn((_url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      createWebSocket,
      initialSince: '3',
      onResyncRequired: (resync) => resyncs.push(resync),
    });

    sockets[0]?.emitMessage(
      JSON.stringify({
        type: 'session.created',
        payload: { session_id: 's2', name: 'New Chat' },
        seq_id: 7,
      }),
    );
    sockets[0]?.emitClose();

    expect(resyncs).toEqual([{ reason: 'stream_closed', since: '7' }]);
    expect(createWebSocket).toHaveBeenLastCalledWith(
      'wss://hub.example.test/client/ws?since=7',
      undefined,
    );
    expect(sockets).toHaveLength(2);
  });

  it('passes JWT via Sec-WebSocket-Protocol when provided (no query access_token)', () => {
    const appState = new FakeAppState('active');
    const createWebSocket = vi.fn((url: string, protocols?: string[]) => {
      expect(new URL(url).searchParams.has('access_token')).toBe(false);
      expect(url).toBe('wss://hub.example.test/client/ws');
      expect(protocols).toEqual(['agenthub.bearer.v1', 'test-jwt']);
      return new FakeSocket();
    });

    startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      token: 'test-jwt',
      createWebSocket,
    });

    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });

  it('removes AppState listeners and closes the active stream when stopped', () => {
    const appState = new FakeAppState('active');
    const socket = new FakeSocket();
    const createWebSocket = vi.fn(() => socket);
    const bridge = startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      createWebSocket,
    });

    expect(appState.listenerCount).toBe(1);

    bridge.stop();
    bridge.stop();
    appState.transition('background');
    appState.transition('active');

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(appState.listenerCount).toBe(0);
    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect when the stream closes while the app is backgrounded', () => {
    const appState = new FakeAppState('active');
    const sockets: FakeSocket[] = [];
    const resyncs: unknown[] = [];
    const createWebSocket = vi.fn((_url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      createWebSocket,
      onResyncRequired: (resync) => resyncs.push(resync),
    });

    appState.transition('background');
    sockets[0]?.emitClose();

    expect(resyncs).toHaveLength(0);
    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });

  it('forwards stream transport errors to onError while the stream stays open', () => {
    const appState = new FakeAppState('active');
    const sockets: FakeSocket[] = [];
    const errors: unknown[] = [];
    const createWebSocket = vi.fn((_url: string) => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });

    startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.example.test',
      createWebSocket,
      onError: (error) => errors.push(error),
    });

    sockets[0]?.onerror?.('transport-failure');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'socket_error' });
    expect(createWebSocket).toHaveBeenCalledTimes(1);
  });
});
