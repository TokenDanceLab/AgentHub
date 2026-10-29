import { getOrCreateDeviceId } from '@shared/api/deviceId';
import { clearLegacyHubCredentials } from '@/api/hubTokenStorage';
import { OidcError, type OidcCallbackResult } from '@shared/api/auth';

const APP_BASE_PATH = import.meta.env.BASE_URL || '/';
const OIDC_CALLBACK_PATH = import.meta.env.VITE_OIDC_CALLBACK_PATH
  || `${APP_BASE_PATH === '/' ? '' : APP_BASE_PATH.replace(/\/$/, '')}/auth/account/callback`;

/** Web navigation/storage glue only; PKCE and login state are server-owned. */
export function createWebBrowserAuthPorts() {
  return {
    getDeviceId: getOrCreateDeviceId,
    clearLegacyCredentials: clearLegacyHubCredentials,
    readCallback(): OidcCallbackResult | null {
      const url = new URL(window.location.href);
      if (url.pathname !== OIDC_CALLBACK_PATH) return null;
      const code = url.searchParams.get('code')?.trim();
      const state = url.searchParams.get('state')?.trim();
      const iss = url.searchParams.get('iss')?.trim();
      if (!code || !state || !iss) {
        window.history.replaceState({}, document.title, APP_BASE_PATH);
        throw new OidcError('tokenExchangeFailed', 'Account login was not completed. Please retry.');
      }
      return { code, state, iss };
    },
    leaveCallback() { window.history.replaceState({}, document.title, APP_BASE_PATH); },
    async openUrl(url: string) { window.location.assign(url); },
  };
}
