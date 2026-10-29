// Browser navigation and cache ownership around the shared cookie-session core.

import { createBrowserSessionAuth } from '@shared/api/auth';
import { createWebBrowserAuthPorts } from './auth/webPorts';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';
import { setBrowserCsrfToken } from './browserSessionRuntime';
import { clearWebSessionData } from '@/platform/clearWebSessionData';
import { useHubStore } from '@/stores/hubStore';

export { OidcError } from '@shared/api/auth';
export type { HubAuth, HubAuthState } from '@shared/api/auth';

export function createHubAuth(client?: HubClient) {
  const ports = createWebBrowserAuthPorts();
  return createBrowserSessionAuth({
    ...ports,
    client: client ?? createHubClient(),
    setCsrfToken: setBrowserCsrfToken,
    syncSession(user) {
      if (!user || useHubStore.getState().userId !== user.id) clearWebSessionData();
      if (user) useHubStore.getState().setAuthenticated(true, user.id, user.username);
      else useHubStore.getState().clear();
    },
  });
}
