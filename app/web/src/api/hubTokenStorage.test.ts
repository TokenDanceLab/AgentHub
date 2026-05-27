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
    localStorage.clear();
    sessionStorage.clear();
    await clearStoredHubAccessToken();
    await clearStoredHubRefreshToken();
  });

  it('stores Hub access tokens in sessionStorage only', async () => {
    await saveStoredHubAccessToken('hub-access');

    expect(sessionStorage.getItem('agenthub_hub_token')).toBe('hub-access');
    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    await expect(loadStoredHubAccessToken()).resolves.toBe('hub-access');
  });

  it('stores Hub refresh tokens in sessionStorage only', async () => {
    await saveStoredHubRefreshToken('hub-refresh');

    expect(sessionStorage.getItem('agenthub_hub_refresh_token')).toBe('hub-refresh');
    expect(localStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
    await expect(loadStoredHubRefreshToken()).resolves.toBe('hub-refresh');
  });

  it('clears legacy localStorage Hub token keys when loading or saving', async () => {
    localStorage.setItem('agenthub_hub_token', 'legacy-access');
    localStorage.setItem('agenthub_hub_refresh_token', 'legacy-refresh');

    await expect(loadStoredHubAccessToken()).resolves.toBeNull();
    await expect(loadStoredHubRefreshToken()).resolves.toBeNull();

    expect(localStorage.getItem('agenthub_hub_token')).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh_token')).toBeNull();
  });
});
