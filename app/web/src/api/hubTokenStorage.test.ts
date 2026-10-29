import { describe, expect, it } from 'vitest';
import { clearLegacyHubCredentials } from './hubTokenStorage';

describe('legacy Web credential migration', () => {
  it('removes credentials from both browser stores while preserving user preferences', async () => {
    for (const storage of [localStorage, sessionStorage]) {
      storage.setItem('agenthub_hub_token', 'legacy-access');
      storage.setItem('agenthub_hub_refresh_token', 'legacy-refresh');
      storage.setItem('agenthub_oidc_pkce_pending', 'legacy-flow');
      storage.setItem('agenthub-language', 'zh');
    }
    await clearLegacyHubCredentials();
    for (const storage of [localStorage, sessionStorage]) {
      expect(storage.getItem('agenthub_hub_token')).toBeNull();
      expect(storage.getItem('agenthub_hub_refresh_token')).toBeNull();
      expect(storage.getItem('agenthub_oidc_pkce_pending')).toBeNull();
      expect(storage.getItem('agenthub-language')).toBe('zh');
    }
  });
});
