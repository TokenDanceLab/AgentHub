import { describe, expect, it } from 'vitest';

import { createSecureStoreAdapter } from './secureStoreAdapter';
import { createHubSessionStorage } from './sessionState';

function createFakeSecureStore() {
  const values = new Map<string, string>();

  return {
    values,
    calls: [] as string[],
    async getItemAsync(key: string) {
      this.calls.push(`get:${key}`);
      return values.get(key) ?? null;
    },
    async setItemAsync(key: string, value: string) {
      this.calls.push(`set:${key}:${value}`);
      values.set(key, value);
    },
    async deleteItemAsync(key: string) {
      this.calls.push(`delete:${key}`);
      values.delete(key);
    },
  };
}

describe('SecureStore Hub session adapter', () => {
  it('adapts an expo-secure-store shaped object to HubSessionStorageAdapter', async () => {
    const fakeSecureStore = createFakeSecureStore();
    const adapter = createSecureStoreAdapter(fakeSecureStore);

    await adapter.setItemAsync('agenthub.mobile.hubSession.v1', 'hub-session-TokenDance');
    await expect(adapter.getItemAsync('agenthub.mobile.hubSession.v1')).resolves.toBe(
      'hub-session-TokenDance',
    );
    await adapter.deleteItemAsync('agenthub.mobile.hubSession.v1');
    await expect(adapter.getItemAsync('agenthub.mobile.hubSession.v1')).resolves.toBeNull();

    expect(fakeSecureStore.calls).toEqual([
      'set:agenthub.mobile.hubSession.v1:hub-session-TokenDance',
      'get:agenthub.mobile.hubSession.v1',
      'delete:agenthub.mobile.hubSession.v1',
      'get:agenthub.mobile.hubSession.v1',
    ]);
  });

  it('persists only Hub-issued session fields through the storage boundary', async () => {
    const fakeSecureStore = createFakeSecureStore();
    const storage = createHubSessionStorage(createSecureStoreAdapter(fakeSecureStore));

    await storage.save({
      status: 'active',
      accessToken: 'hub-access-TokenDance',
      refreshToken: 'hub-refresh-TokenDance',
      userSub: 'tokendance-Delicious233',
      expiresAt: '2026-06-08T10:30:00.000Z',
    });

    const persisted = Array.from(fakeSecureStore.values.values()).join('\n');

    expect(persisted).toContain('hub-access-TokenDance');
    expect(persisted).toContain('tokendance-Delicious233');
    expect(persisted).not.toContain('id_token');
    expect(persisted).not.toContain('providerAccessToken');
    expect(persisted.toLowerCase()).not.toContain('github');
    expect(persisted.toLowerCase()).not.toContain('google');
    expect(persisted.toLowerCase()).not.toContain('feishu');
  });
});
