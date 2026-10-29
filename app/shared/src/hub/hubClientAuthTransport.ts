import type { HubClientOptions } from './hubClientDomainTypes';

/** Apply the chosen credential plane once, for JSON and multipart requests. */
export function withHubAuthTransport(options: HubClientOptions): HubClientOptions {
  const auth = options.authTransport;
  if (!auth) return options;
  const { getToken: _getToken, onRefreshToken: _onRefreshToken, ...rest } = options;
  if (auth.kind === 'bearer') return { ...options, getToken: auth.getToken };

  const origin = new URL(auth.origin).origin;
  const fetchImpl = options.fetch ?? globalThis.fetch;
  return {
    ...rest,
    fetch: async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), origin);
      if (url.origin !== origin) throw new Error('Browser Hub requests must use the application origin');
      const headers = new Headers(init.headers);
      headers.delete('Authorization');
      const method = (init.method ?? 'GET').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        const csrf = auth.getCsrfToken();
        if (csrf) headers.set('X-Hub-CSRF', csrf);
      }
      const response = await fetchImpl(input, {
        ...init, headers, credentials: 'same-origin', redirect: 'error',
      });
      if (response.status === 401) auth.onUnauthorized?.();
      return response;
    },
  };
}
