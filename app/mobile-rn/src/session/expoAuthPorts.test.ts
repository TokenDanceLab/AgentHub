import { describe, expect, it } from 'vitest';
import { createMobileAuthCorePorts } from './expoAuthPorts';
import type { HubSessionStorageAdapter } from '@/session/sessionState';

function createMemoryAdapter(): {
  adapter: HubSessionStorageAdapter;
  store: Record<string, string>;
} {
  const store: Record<string, string | undefined> = {};
  const adapter: HubSessionStorageAdapter = {
    getItemAsync(key) {
      return Promise.resolve(store[key] ?? null);
    },
    setItemAsync(key, value) {
      store[key] = value;
      return Promise.resolve();
    },
    deleteItemAsync(key) {
      store[key] = undefined;
      return Promise.resolve();
    },
  };
  return { adapter, store: store as Record<string, string> };
}

function createPorts(overrides: {
  randomDeviceId?: () => string;
} = {}) {
  const { adapter, store } = createMemoryAdapter();
  let currentTime = 1_000_000;
  const ports = createMobileAuthCorePorts({
    storageAdapter: adapter,
    redirectUri: 'agenthub://auth/callback',
    openAuthUrl: async () => {},
    now: () => currentTime,
    randomDeviceId: () => '00000000-0000-4000-8000-000000000001',
    ...overrides,
  });
  return {
    ports,
    adapter,
    store,
    advanceTime(ms: number) {
      currentTime += ms;
    },
  };
}

const HUB_SESSION_KEY = 'agenthub.mobile.hubSession.v1';
const DEVICE_ID_KEY = 'agenthub.mobile.deviceId.v1';

describe('createMobileAuthCorePorts', () => {
  it('persists device identity once loaded and reuses it synchronously', async () => {
    const { ports, store } = createPorts();
    store[DEVICE_ID_KEY] = '11111111-1111-4111-8111-111111111111';

    await ports.ensureDeviceIdentityLoaded();

    expect(ports.ports.deviceIdentity.getOrCreateDeviceId()).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(ports.ports.deviceIdentity.deviceType).toBe('mobile');
  });

  it('generates and persists a device id when none is stored', async () => {
    const { ports, store } = createPorts();

    const first = ports.ports.deviceIdentity.getOrCreateDeviceId();
    const second = ports.ports.deviceIdentity.getOrCreateDeviceId();

    expect(first).toBe('00000000-0000-4000-8000-000000000001');
    expect(second).toBe(first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store[DEVICE_ID_KEY]).toBe(first);
  });

  it('round-trips tokens through the hub session slot without losing sibling fields', async () => {
    const { ports, store } = createPorts();
    store[HUB_SESSION_KEY] = JSON.stringify({
      status: 'active',
      refreshToken: 'refresh-1',
      userSub: 'user-1',
      expiresAt: '2099-01-01T00:00:00.000Z',
    });

    await ports.ports.tokenStorage.saveAccessToken('access-new');

    const snap = JSON.parse(store[HUB_SESSION_KEY]!) as Record<string, unknown>;
    expect(snap.status).toBe('active');
    expect(snap.refreshToken).toBe('refresh-1');
    expect(snap.userSub).toBe('user-1');
    expect(snap.expiresAt).toBe('2099-01-01T00:00:00.000Z');

    expect(await ports.ports.tokenStorage.loadAccessToken()).toBe('access-new');
    expect(await ports.ports.tokenStorage.loadRefreshToken()).toBe('refresh-1');
  });

  it('clears tokens individually and returns null loads afterwards', async () => {
    const { ports } = createPorts();

    await ports.ports.tokenStorage.saveAccessToken('access-1');
    await ports.ports.tokenStorage.saveRefreshToken('refresh-1');
    await ports.ports.tokenStorage.clearAccessToken();

    expect(await ports.ports.tokenStorage.loadAccessToken()).toBeNull();
    expect(await ports.ports.tokenStorage.loadRefreshToken()).toBe('refresh-1');

    await ports.ports.tokenStorage.clearRefreshToken();
    expect(await ports.ports.tokenStorage.loadRefreshToken()).toBeNull();
  });

  it('queues an incoming callback when no login is in flight and consumes it once', async () => {
    const { ports } = createPorts();
    const callback = { code: 'code-cold', state: 'state-cold' };

    ports.handleIncomingOidcCallback(callback);

    expect(ports.ports.callbackChannel.readBrowserCallback()).toEqual(callback);
    expect(ports.ports.callbackChannel.readBrowserCallback()).toBeNull();
  });

  it('resolves the in-flight login callback through the channel', async () => {
    const { ports } = createPorts();
    const started = ports.ports.callbackChannel.start();
    const callbackPromise = started.then((control) => control.callback);

    ports.handleIncomingOidcCallback({ code: 'code-1', state: 'state-1' });

    await expect(callbackPromise).resolves.toEqual({ code: 'code-1', state: 'state-1' });
  });

  it('rejects the in-flight login on state mismatch', async () => {
    const { ports } = createPorts();
    ports.ports.pendingStorage.save({
      state: 'server-state',
      codeVerifier: 'verifier',
      deviceId: 'device-1',
      redirectUri: 'agenthub://auth/callback',
      createdAt: 1_000_000,
    });

    const started = ports.ports.callbackChannel.start();
    const callbackPromise = started.then((control) => control.callback);

    ports.handleIncomingOidcCallback({ code: 'code-1', state: 'other-state' });

    await expect(callbackPromise).rejects.toThrow(/state mismatch/i);
  });

  it('rejects the in-flight login after the pending expiry window', async () => {
    const { ports, advanceTime } = createPorts();
    ports.ports.pendingStorage.save({
      state: 'server-state',
      codeVerifier: 'verifier',
      deviceId: 'device-1',
      redirectUri: 'agenthub://auth/callback',
      createdAt: 1_000_000,
    });

    const started = ports.ports.callbackChannel.start();
    const callbackPromise = started.then((control) => control.callback);

    advanceTime(11 * 60 * 1000);
    ports.handleIncomingOidcCallback({ code: 'code-1', state: 'server-state' });

    await expect(callbackPromise).rejects.toThrow(/expired/i);
  });
});
