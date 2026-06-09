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
    this.onclose?.({ code: 1000, reason: 'TokenDance fake close' });
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
  it('connects only while the app is foregrounded and resyncs from the last event cursor', () => {
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
      baseUrl: 'https://hub.tokendance.test',
      createWebSocket,
      onStatusChange: (status) => statuses.push(status),
      onResyncRequired: (resync) => resyncs.push(resync),
    });

    expect(createWebSocket).toHaveBeenCalledWith('wss://hub.tokendance.test/v1/events');

    sockets[0]?.emitMessage(
      JSON.stringify({
        id: 'evt-Delicious233-2',
        type: 'approval.updated',
        createdAt: '2026-06-09T08:00:00.000Z',
        payload: { approvalId: 'approval-TokenDance' },
      }),
    );

    appState.transition('background');

    expect(sockets[0]?.close).toHaveBeenCalledTimes(1);
    expect(statuses).toContain('suspended');

    appState.transition('active');

    expect(resyncs).toEqual([{ reason: 'foreground', since: 'evt-Delicious233-2' }]);
    expect(createWebSocket).toHaveBeenLastCalledWith(
      'wss://hub.tokendance.test/v1/events?since=evt-Delicious233-2',
    );
    expect(bridge.getCursor()).toBe('evt-Delicious233-2');
  });

  it('stays suspended for an initially backgrounded app until foreground resumes', () => {
    const appState = new FakeAppState('background');
    const createWebSocket = vi.fn(() => new FakeSocket());
    const statuses: string[] = [];

    startHubLifecycleBridge({
      appState,
      baseUrl: 'http://127.0.0.1:8080',
      createWebSocket,
      initialSince: 'evt-TokenDance-1',
      onStatusChange: (status) => statuses.push(status),
    });

    expect(createWebSocket).not.toHaveBeenCalled();
    expect(statuses).toEqual(['suspended']);

    appState.transition('active');

    expect(createWebSocket).toHaveBeenCalledWith('ws://127.0.0.1:8080/v1/events?since=evt-TokenDance-1');
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
      baseUrl: 'https://hub.tokendance.test',
      createWebSocket,
      initialSince: 'evt-before-close',
      onResyncRequired: (resync) => resyncs.push(resync),
    });

    sockets[0]?.emitMessage(
      JSON.stringify({
        id: 'evt-before-remote-close',
        type: 'run.updated',
        createdAt: '2026-06-09T08:01:00.000Z',
        payload: { runId: 'run-TokenDance' },
      }),
    );
    sockets[0]?.emitClose();

    expect(resyncs).toEqual([{ reason: 'stream_closed', since: 'evt-before-remote-close' }]);
    expect(createWebSocket).toHaveBeenLastCalledWith(
      'wss://hub.tokendance.test/v1/events?since=evt-before-remote-close',
    );
    expect(sockets).toHaveLength(2);
  });

  it('removes AppState listeners and closes the active stream when stopped', () => {
    const appState = new FakeAppState('active');
    const socket = new FakeSocket();
    const createWebSocket = vi.fn(() => socket);
    const bridge = startHubLifecycleBridge({
      appState,
      baseUrl: 'https://hub.tokendance.test',
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
});
