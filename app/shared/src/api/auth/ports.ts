/**
 * Platform port contracts for the shared Hub auth state machine (issue #1537).
 *
 * The core (authStateMachine.ts) is pure TypeScript and depends only on these
 * interfaces. Web/Desktop adapters implement the ports with browser/Tauri
 * behavior: token storage location, OIDC callback capture (URL vs local
 * callback server), authorization URL opening, and device identity.
 */

import type { HubClient, HubClientOptions } from '../../hub/hubClient';
import type {
  BrowserOIDCPending,
  HubTokenSource,
  OidcCallbackResult,
} from './types';

/** Hub token + token-source persistence (sessionStorage / credential store / memory). */
export interface HubTokenStoragePort {
  loadAccessToken(): Promise<string | null>;
  saveAccessToken(token: string | null): Promise<void>;
  clearAccessToken(): Promise<void>;
  loadRefreshToken(): Promise<string | null>;
  saveRefreshToken(token: string | null): Promise<void>;
  clearRefreshToken(): Promise<void>;
  loadTokenSource(): HubTokenSource;
  saveTokenSource(source: HubTokenSource): void;
}

/** OIDC PKCE pending-state persistence between login start and callback. */
export interface OidcPendingPort {
  save(pending: BrowserOIDCPending): void;
  load(): BrowserOIDCPending | null;
  clear(): void;
}

/**
 * How the platform receives the OIDC authorization response.
 *
 * - Browser-redirect mode (Web always, Desktop in Vite dev): the callback
 *   lands on the current page URL; `start()` returns a never-settling promise
 *   (the page unloads during the redirect) and `readBrowserCallback()` picks
 *   up code/state after the redirect returns.
 * - Local-callback-server mode (Desktop Tauri): the Rust backend listens on a
 *   loopback port and emits `oidc-callback` / `oidc-callback-error` events;
 *   `start()` returns a promise that resolves with the callback.
 */
export interface OidcCallbackChannelPort {
  start(): Promise<{ redirectUri: string; callback: Promise<OidcCallbackResult> }>;
  readBrowserCallback(): OidcCallbackResult | null;
  leaveCallbackRoute(): void;
}

/** Opens the TokenDance ID authorization URL (current window or system browser). */
export interface OidcRedirectPort {
  open(authorizationUrl: string): Promise<void>;
}

/** Device identity used by Hub for the OIDC device proof. */
export interface DeviceIdentityPort {
  getOrCreateDeviceId(): string;
  deviceType: string;
}

/** Platform session UI store sync (zustand hubStore per app). */
export interface HubSessionSyncPort {
  setAuthenticated(userId: string | null, username: string | null): void;
  clear(): void;
}

/** Complete port bundle required by the shared auth state machine. */
export interface HubAuthPorts {
  deviceIdentity: DeviceIdentityPort;
  tokenStorage: HubTokenStoragePort;
  pendingStorage: OidcPendingPort;
  callbackChannel: OidcCallbackChannelPort;
  redirectOpener: OidcRedirectPort;
  sessionSync: HubSessionSyncPort;
}

/** Platform client factory used by the core for Hub REST calls. */
export type HubClientFactory = (opts?: HubClientOptions) => HubClient;
