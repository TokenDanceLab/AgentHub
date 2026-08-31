/**
 * Shared Hub authentication types (issue #1537).
 *
 * The Hub auth state machine (token lifecycle, OIDC PKCE flow, refresh
 * fallback, logout cleanup) is platform-agnostic and lives in the shared
 * package. Web/Desktop adapters inject platform ports for browser/Tauri
 * behavior and keep the historical `HubAuthState` / `HubAuth` surface.
 */

import type { HubUserProfile } from '../../hub/hubClient';

/** Which Hub auth method produced the current session. */
export type HubTokenSource = 'tokendance' | 'hub' | null;

/** Immutable snapshot of the Hub authentication state published to listeners. */
export interface HubAuthState {
  token: string | null;
  refreshToken: string | null;
  user: HubUserProfile | null;
  isAuthenticated: boolean;
  tokenSource: HubTokenSource;
}

/** Public API of the Hub auth state machine (compatible with legacy per-app HubAuth). */
export interface HubAuth {
  getState: () => HubAuthState;
  subscribe: (fn: (state: HubAuthState) => void) => () => void;
  loginWithTokenDance: () => Promise<void>;
  logout: () => Promise<void>;
  tryAutoLogin: () => Promise<boolean>;
}

/** Code + state extracted from an OIDC authorization response callback. */
export interface OidcCallbackResult {
  code: string;
  state: string;
}

/**
 * PKCE state persisted between the login start and the callback landing.
 * In browser-redirect mode this survives the page unload via sessionStorage;
 * in local-callback-server mode (Tauri) it may stay memory-only.
 */
export interface BrowserOIDCPending {
  state: string;
  codeVerifier: string;
  deviceId: string;
  redirectUri: string;
  createdAt: number;
}

/** Hub token response after OIDC code exchange or login. */
export interface HubTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: HubUserProfile | null;
}

/**
 * OIDC auth error with an i18n code so UI can map to localized messages.
 * `code` is the suffix under `auth.error.oidc.<code>` in locale files.
 * `detail` carries dynamic context (e.g. upstream error text) for interpolation.
 */
export class OidcError extends Error {
  code: string;
  detail?: string;
  cause?: unknown;

  constructor(code: string, fallbackMessage: string, detail?: string) {
    super(fallbackMessage);
    this.name = 'OidcError';
    this.code = code;
    if (detail) this.detail = detail;
  }
}

/**
 * Backend OIDC error codes — SSOT mirror of the OIDC section in
 * `hub-server/internal/errcode/codes.go` (#2123 P1-2).
 *
 * Contract: every code emitted by the Hub OIDC handlers must exist here,
 * and every entry here must exist on the backend. CI enforces the mirror via
 * `scripts/verify/verify-oidc-code-ssot.py`; adding an OIDC code on only one
 * side fails the validate job.
 */
export const OidcBackendErrorCodes = {
  invalidState: 'oidc_invalid_state',
  codeExchangeFailed: 'oidc_code_exchange_failed',
  idTokenInvalid: 'oidc_id_token_invalid',
  subNotFound: 'oidc_sub_not_found',
} as const;

export type OidcBackendErrorCode =
  (typeof OidcBackendErrorCodes)[keyof typeof OidcBackendErrorCodes];

const oidcBackendCodeValues = new Set<string>(
  Object.values(OidcBackendErrorCodes),
);

/** True when `value` is one of the backend OIDC error codes. */
export function isOidcBackendErrorCode(value: unknown): value is OidcBackendErrorCode {
  return typeof value === 'string' && oidcBackendCodeValues.has(value);
}

/**
 * Single bridge table from backend OIDC codes to the frontend i18n suffix
 * used by OidcError (`auth.error.oidc.<code>` locale keys).
 */
export const oidcBackendCodeToI18nCode: Record<OidcBackendErrorCode, string> = {
  oidc_invalid_state: 'stateMismatch',
  oidc_code_exchange_failed: 'tokenExchangeFailed',
  oidc_id_token_invalid: 'tokenExchangeFailed',
  oidc_sub_not_found: 'tokenExchangeFailed',
};
