import type { HubBrowserSession, HubClient } from '../../hub/hubClient';
import { OidcError, type HubAuth, type HubAuthState, type OidcCallbackResult } from './types';

export interface BrowserSessionAuth extends HubAuth {
  logoutAccount(): Promise<void>;
  invalidate(): void;
}

export interface BrowserSessionAuthPorts {
  client: Pick<HubClient, 'browserAuthorize' | 'browserCallback' | 'browserSession' | 'browserLogout' | 'browserLogoutAccount'>;
  getDeviceId(): string;
  readCallback(): OidcCallbackResult | null;
  leaveCallback(): void;
  openUrl(url: string): Promise<void>;
  clearLegacyCredentials(): Promise<void>;
  setCsrfToken(token: string | null): void;
  syncSession(user: HubAuthState['user']): void;
}

/** Cookie authority lives on Hub; only profile and CSRF proof enter JS memory. */
export function createBrowserSessionAuth(ports: BrowserSessionAuthPorts): BrowserSessionAuth {
  const anonymous = (): HubAuthState => Object.freeze({
    token: null, refreshToken: null, user: null, isAuthenticated: false, tokenSource: null,
  });
  let state = anonymous();
  let generation = 0;
  let restoring: Promise<boolean> | null = null;
  const listeners = new Set<(state: HubAuthState) => void>();
  const notify = () => listeners.forEach((listener) => listener(state));
  const invalidate = () => {
    generation++;
    state = anonymous();
    ports.setCsrfToken(null);
    ports.syncSession(null);
    notify();
  };
  const accept = (session: HubBrowserSession, expectedGeneration: number): boolean => {
    if (expectedGeneration !== generation) return false;
    if (!session.user?.id || !session.csrf_token || !(Date.parse(session.expires_at) > Date.now())) {
      throw new Error('Invalid Hub browser session response');
    }
    ports.setCsrfToken(session.csrf_token);
    state = Object.freeze({ ...anonymous(), user: session.user, isAuthenticated: true, tokenSource: 'account' });
    ports.syncSession(session.user);
    notify();
    return true;
  };
  const restore = async () => {
    const expectedGeneration = generation;
    await ports.clearLegacyCredentials();
    const callback = ports.readCallback();
    try {
      return accept(callback
        ? await ports.client.browserCallback(callback)
        : await ports.client.browserSession(), expectedGeneration);
    } catch (error) {
      const status = (error as { status?: number; statusCode?: number }).status
        ?? (error as { statusCode?: number }).statusCode;
      if (status === 401) {
        if (expectedGeneration === generation) invalidate();
        return false;
      }
      if (callback) throw new OidcError('tokenExchangeFailed', 'Account login could not be completed. Please retry.');
      throw error;
    } finally {
      if (callback) ports.leaveCallback();
    }
  };
  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate,
    async loginWithAccount() {
      await ports.clearLegacyCredentials();
      const result = await ports.client.browserAuthorize(ports.getDeviceId()).catch(() => {
        throw new OidcError('startFailed', 'Unable to start Account login. Please retry.');
      });
      const issuer = new URL(result.issuer);
      const destination = new URL(result.authorization_url);
      if (destination.origin !== issuer.origin || !result.state) {
        throw new OidcError('issuerInvalid', 'Invalid Account authorization destination');
      }
      await ports.openUrl(destination.href);
    },
    tryAutoLogin() {
      restoring ??= restore().finally(() => { restoring = null; });
      return restoring;
    },
    async logout() {
      // A failed server revoke must not be reported as a successful logout.
      await ports.client.browserLogout();
      invalidate();
    },
    async logoutAccount() {
      const result = await ports.client.browserLogoutAccount();
      invalidate();
      // Hub validates this destination against trusted issuer discovery.
      const destination = new URL(result.logout_url);
      if (!['https:', 'http:'].includes(destination.protocol) || destination.username || destination.password) {
        throw new Error('Invalid Account logout destination');
      }
      await ports.openUrl(destination.href);
    },
  };
}
