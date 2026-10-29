/**
 * Web Hub session invalidation (#1816).
 *
 * Browser 401, auth.revoked and device.kicked clear the profile/CSRF state
 * and reopen the login entry. Legacy stored credentials are also removed.
 */

import { clearLegacyHubCredentials } from '@/api/hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';
import { invalidateBrowserSession } from '@/api/browserSessionRuntime';

/**
 * Clears the stored Hub access/refresh tokens, resets the Hub auth store,
 * and opens the auth modal so the user can sign in again.
 */
export async function resetWebHubSession(): Promise<void> {
  invalidateBrowserSession();
  await clearLegacyHubCredentials();
  const hubStore = useHubStore.getState();
  hubStore.clear();
  hubStore.setShowAuthModal(true);
}
