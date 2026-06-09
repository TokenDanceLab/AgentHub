import { describe, expect, it } from 'vitest';

import {
  createHubSessionStorage,
  getHubSessionBoundary,
  isHubSessionExpired,
  reduceHubSession,
  type HubSessionSnapshot,
} from './sessionState';

function createMemoryAdapter(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));

  return {
    values,
    async getItemAsync(key: string) {
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      values.set(key, value);
    },
    async deleteItemAsync(key: string) {
      values.delete(key);
    },
  };
}

describe('Hub session reducer', () => {
  it('stores only Hub-issued session state after TokenDance ID exchange', () => {
    const next = reduceHubSession(
      { status: 'missing' },
      {
        type: 'session.received',
        accessToken: 'hub-access',
        refreshToken: 'hub-refresh',
        userSub: 'tokendance-Delicious233',
        expiresAt: '2026-06-08T10:30:00.000Z',
      },
    );

    expect(next).toEqual({
      status: 'active',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
      userSub: 'tokendance-Delicious233',
      expiresAt: '2026-06-08T10:30:00.000Z',
    });
    expect(Object.keys(next)).not.toContain('providerAccessToken');
    expect(Object.keys(next)).not.toContain('tokenDanceIdToken');
  });

  it('marks stale sessions expired without dropping refresh context', () => {
    const state: HubSessionSnapshot = {
      status: 'active',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
    };

    expect(reduceHubSession(state, { type: 'session.expired' })).toEqual({
      status: 'expired',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
    });
  });

  it('clears all local session fields on logout', () => {
    expect(
      reduceHubSession(
        {
          status: 'active',
          accessToken: 'hub-access',
          refreshToken: 'hub-refresh',
          userSub: 'tokendance-Delicious233',
        },
        { type: 'session.cleared' },
      ),
    ).toEqual({ status: 'missing' });
  });
});

describe('Hub session storage', () => {
  it('loads missing when no secure value has been saved', async () => {
    const storage = createHubSessionStorage(createMemoryAdapter());

    await expect(storage.load()).resolves.toEqual({ status: 'missing' });
  });

  it('saves and loads Hub session snapshots through an RN-safe adapter', async () => {
    const adapter = createMemoryAdapter();
    const storage = createHubSessionStorage(adapter);
    const session: HubSessionSnapshot = {
      status: 'active',
      accessToken: 'hub-access-TokenDance',
      refreshToken: 'hub-refresh-TokenDance',
      userSub: 'tokendance-Delicious233',
      expiresAt: '2026-06-08T10:30:00.000Z',
    };

    await storage.save(session);

    await expect(storage.load()).resolves.toEqual(session);
    const persisted = Array.from(adapter.values.values()).join('\n');
    expect(persisted).not.toContain('providerAccessToken');
    expect(persisted).not.toContain('github');
    expect(persisted).not.toContain('google');
    expect(persisted).not.toContain('feishu');
  });

  it('clears the saved Hub session snapshot', async () => {
    const adapter = createMemoryAdapter();
    const storage = createHubSessionStorage(adapter);

    await storage.save({
      status: 'active',
      accessToken: 'hub-access',
      refreshToken: 'hub-refresh',
      userSub: 'tokendance-Delicious233',
    });
    await storage.clear();

    await expect(storage.load()).resolves.toEqual({ status: 'missing' });
  });
});

describe('Hub session expiry and identity boundary', () => {
  it('detects expired Hub access sessions from expiresAt', () => {
    expect(
      isHubSessionExpired(
        {
          status: 'active',
          accessToken: 'hub-access',
          refreshToken: 'hub-refresh',
          userSub: 'tokendance-Delicious233',
          expiresAt: '2026-06-08T10:30:00.000Z',
        },
        new Date('2026-06-08T10:30:00.000Z'),
      ),
    ).toBe(true);
    expect(
      isHubSessionExpired(
        {
          status: 'active',
          accessToken: 'hub-access',
          refreshToken: 'hub-refresh',
          userSub: 'tokendance-Delicious233',
          expiresAt: '2026-06-08T10:30:01.000Z',
        },
        new Date('2026-06-08T10:30:00.000Z'),
      ),
    ).toBe(false);
  });

  it('selects the Hub and TokenDance ID boundary without provider tokens', () => {
    expect(
      getHubSessionBoundary({
        status: 'active',
        accessToken: 'hub-access',
        refreshToken: 'hub-refresh',
        userSub: 'tokendance-Delicious233',
      }),
    ).toEqual({
      hubSessionStatus: 'active',
      tokenDanceIdSubject: 'tokendance-Delicious233',
      hasHubAccessToken: true,
      hasHubRefreshToken: true,
      storesTokenDanceIdToken: false,
      storesThirdPartyProviderToken: false,
    });
  });
});
