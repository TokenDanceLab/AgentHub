import { beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN_KEY = 'agenthub_hub_token';
const USER_KEY = 'agenthub_hub_user';

async function loadStore() {
  vi.resetModules();
  return import('./hubStore');
}

describe('hubStore auth storage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('hydrates tab-scoped user metadata and clears the legacy localStorage user key', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'hub-access');
    sessionStorage.setItem(USER_KEY, JSON.stringify({ userId: 'u_1', username: 'alice' }));
    localStorage.setItem(USER_KEY, JSON.stringify({ userId: 'legacy', username: 'legacy' }));

    const { useHubStore } = await loadStore();
    const state = useHubStore.getState();

    expect(state.authenticated).toBe(true);
    expect(state.userId).toBe('u_1');
    expect(state.username).toBe('alice');
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it('stores user metadata in sessionStorage only when authentication changes', async () => {
    const { useHubStore } = await loadStore();

    useHubStore.getState().setAuthenticated(true, 'u_2', 'bob');

    expect(JSON.parse(sessionStorage.getItem(USER_KEY) || '{}')).toEqual({
      userId: 'u_2',
      username: 'bob',
    });
    expect(localStorage.getItem(USER_KEY)).toBeNull();

    useHubStore.getState().clear();

    expect(sessionStorage.getItem(USER_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });
});
