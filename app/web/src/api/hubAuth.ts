// Web Hub auth adapter (issue #1537).
// Thin shell over the shared auth state machine (@shared/api/auth):
// the token lifecycle, OIDC PKCE flow, refresh fallback, logout cleanup and
// snapshot/listener pattern live in app/shared/src/api/auth/authStateMachine.ts;
// this file injects the Web platform ports (sessionStorage tokens, browser
// callback route, current-window redirect) and keeps the historical
// createHubAuth() / HubAuthState / HubAuth surface for existing callers.

import { createHubAuthCore } from '@shared/api/auth';
import type { HubAuth } from '@shared/api/auth';
import { createWebHubAuthPorts } from './auth/webPorts';
import { createHubClient } from './hubClient';
import type { HubClient } from './hubClient';

export { OidcError } from '@shared/api/auth';
export type { HubAuth, HubAuthState } from '@shared/api/auth';

export function createHubAuth(client?: HubClient): HubAuth {
  return createHubAuthCore(createWebHubAuthPorts(), {
    client,
    createClient: (opts) => createHubClient(opts),
  });
}
