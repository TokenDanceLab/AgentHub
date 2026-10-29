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

  it('starts signed out despite legacy bearer storage and clears saved user metadata', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'hub-access');
    sessionStorage.setItem(USER_KEY, JSON.stringify({ userId: 'u_1', username: 'alice' }));
    localStorage.setItem(USER_KEY, JSON.stringify({ userId: 'legacy', username: 'legacy' }));

    const { useHubStore } = await loadStore();
    const state = useHubStore.getState();

    expect(state.authenticated).toBe(false);
    expect(state.userId).toBeNull();
    expect(state.username).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it('keeps authenticated user metadata in memory only', async () => {
    const { useHubStore } = await loadStore();

    useHubStore.getState().setAuthenticated(true, 'u_2', 'bob');

    expect(sessionStorage.getItem(USER_KEY)).toBeNull();
    expect(useHubStore.getState()).toMatchObject({ authenticated: true, userId: 'u_2', username: 'bob' });
    expect(localStorage.getItem(USER_KEY)).toBeNull();

    useHubStore.getState().clear();

    expect(sessionStorage.getItem(USER_KEY)).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });
});
