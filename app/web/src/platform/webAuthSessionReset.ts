/**
 * Web Hub session invalidation (#1816).
 *
 * When the Hub session becomes unrecoverable — the access-token refresh
 * exchange fails, or the Hub kicks this device — the client must fail
 * closed: drop the stored tokens, reset the Hub auth store, and surface the
 * login entry again instead of silently keeping a dead session.
 */

import {
  clearStoredHubAccessToken,
  clearStoredHubRefreshToken,
} from '@/api/hubTokenStorage';
import { useHubStore } from '@/stores/hubStore';

/**
 * Clears the stored Hub access/refresh tokens, resets the Hub auth store,
 * and opens the auth modal so the user can sign in again.
 */
export async function resetWebHubSession(): Promise<void> {
  await clearStoredHubAccessToken();
  await clearStoredHubRefreshToken();
  const hubStore = useHubStore.getState();
  hubStore.clear();
  hubStore.setShowAuthModal(true);
}
