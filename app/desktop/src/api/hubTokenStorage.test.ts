import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearStoredHubRefreshToken,
  loadStoredHubRefreshToken,
  saveStoredHubRefreshToken,
} from './hubTokenStorage';

describe('hubTokenStorage', () => {
  beforeEach(async () => {
    delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    localStorage.clear();
    await clearStoredHubRefreshToken();
  });

  it('keeps refresh tokens out of localStorage in non-Tauri fallback', async () => {
    await saveStoredHubRefreshToken('refresh_secret');

    expect(await loadStoredHubRefreshToken()).toBe('refresh_secret');
    expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();

    await clearStoredHubRefreshToken();

    expect(await loadStoredHubRefreshToken()).toBeNull();
    expect(localStorage.getItem('agenthub_hub_refresh')).toBeNull();
  });
});
