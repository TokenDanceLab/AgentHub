import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
  loadStoredHubAccessToken,
  loadStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from './hubTokenStorage';

describe('hubTokenStorage', () => {
  beforeEach(async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  it('stores Hub access tokens in sessionStorage only in non-Tauri fallback', async () => {
    await saveStoredHubAccessToken('access_secret');

    expect(await loadStoredHubAccessToken()).toBe('access_secret');
    expect(sessionStorage.getItem('agenthub_hub_token')).toBe('access_secret');
    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();

    await clearStoredHubAccessToken();

    expect(await loadStoredHubAccessToken()).toBeNull();
    expect(sessionStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
  });

  it('keeps refresh tokens out of localStorage in non-Tauri fallback', async () => {
    await saveStoredHubRefreshToken('refresh_secret');

    expect(await loadStoredHubRefreshToken()).toBe('refresh_secret');
    expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();

    await clearStoredHubRefreshToken();

    expect(await loadStoredHubRefreshToken()).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
  });

  it('clears legacy localStorage Hub token keys when loading', async () => {
    localStorage.setItem('agenthub_hub_token', 'legacy-access');
    localStorage.setItem('agenthub_hub_refresh_token', 'legacy-refresh');

    expect(await loadStoredHubAccessToken()).toBeNull();
    expect(await loadStoredHubRefreshToken()).toBeNull();

    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
  });
});
