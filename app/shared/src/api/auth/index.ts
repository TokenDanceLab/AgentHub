/**
 * Shared Hub authentication state machine barrel (issue #1537).
 *
 * Platform adapters (app/web/src/api/hubAuth.ts, app/desktop/src/api/hubAuth.ts)
 * re-export the public surface below and inject their own ports.
 */

export { createHubAuthCore } from './authStateMachine';
export type { HubAuthCoreOptions } from './authStateMachine';
export { generateCodeVerifier, computeCodeChallenge, base64UrlEncode } from './pkce';
export { OidcError } from './types';
export type {
  HubAuth,
  HubAuthState,
  HubTokenSource,
  HubTokenResponse,
  OidcCallbackResult,
  BrowserOIDCPending,
} from './types';
export type {
  HubAuthPorts,
  HubClientFactory,
  HubTokenStoragePort,
  OidcPendingPort,
  OidcCallbackChannelPort,
  OidcRedirectPort,
  DeviceIdentityPort,
  HubSessionSyncPort,
} from './ports';
