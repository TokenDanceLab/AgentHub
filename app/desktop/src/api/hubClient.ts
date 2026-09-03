// Desktop Hub client — thin surface over shared SSOT (#432 / T3.3).
// Method/DTO SSOT: @shared/hub/hubClient; desktop-only glue: HUB_URL + Tauri proxy.
// Do NOT add new Hub REST methods here; add them to app/shared/src/hub/hubClient.ts first.

import { HUB_URL } from '@/config';
import { AppError } from '@shared/errors';
import {
  createHubClient as createSharedHubClient,
  type ExecutionTarget,
  type ExecutionTargetType,
  type HubClient as SharedHubClient,
  type HubClientOptions as SharedHubClientOptions,
  type HubExecutionTargetRequest,
} from '@shared/hub/hubClient';
import {
  clearStoredHubRefreshToken,
  loadStoredHubRefreshToken,
  saveStoredHubAccessToken,
  saveStoredHubRefreshToken,
} from './hubTokenStorage';

// Re-export shared types/methods surface for existing desktop imports.
export * from '@shared/hub/hubClient';
export interface HubClientOptions extends SharedHubClientOptions {
  /** Defaults to desktop HUB_URL when omitted. */
  baseUrl?: string;
}

// Tauri proxy fallback ─────────────────────────────────────────────────

/**
 * When WebView2 `fetch()` fails (e.g. doesn't respect HTTP_PROXY env vars),
 * fall back to the Rust backend's `reqwest`-based proxy which does.
 * Only used in Tauri mode; returns `{ used: false }` in browser mode.
 */
async function tauriProxyFallback(
  url: string,
  options: RequestInit,
  headers: Record<string, string>,
  _originalError: unknown,
): Promise<{ used: true; value: unknown } | { used: false }> {
  const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  if (!isTauri) return { used: false };

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const body = typeof options.body === 'string' ? options.body : '';
    console.debug('[hubClient] tauri proxy fallback →', options.method || 'POST', url);
    const resp = await invoke<{ status: number; body: string; headers: Record<string, string> }>(
      'proxy_http_post',
      { url, body, headers },
    );
    console.debug('[hubClient] tauri proxy response', resp.status, url);

    // Parse the response body
    let parsed: unknown;
    try {
      parsed = resp.body ? JSON.parse(resp.body) : undefined;
    } catch {
      parsed = undefined;
    }

    if (resp.status < 200 || resp.status >= 300) {
      throw new AppError(
        {
          error: {
            code: resp.status >= 500 ? 'internal_error' : 'bad_request',
            message: `HTTP ${resp.status} (via Tauri proxy)`,
          },
        },
        resp.status,
        parsed,
      );
    }

    // Unwrap Hub envelope if present
    if (
      parsed &&
      typeof parsed === 'object' &&
      'code' in parsed &&
      typeof (parsed as { code?: unknown }).code === 'string'
    ) {
      const envelope = parsed as { code: string; data?: unknown; message?: string };
      if (envelope.code === 'OK' || envelope.code === 'ok') {
        return { used: true, value: envelope.data };
      }
      throw new AppError(
        {
          error: {
            code: envelope.code || 'hub_error',
            message: envelope.message || 'Hub request failed (via Tauri proxy)',
          },
        },
        resp.status,
        parsed,
      );
    }

    return { used: true, value: parsed };
  } catch (proxyErr) {
    console.warn('[hubClient] tauri proxy fallback also failed:', proxyErr);
    return { used: false };
  }
}

// ── Tauri proxy fetch fallback ──────────────────────────────────────────────

/**
 * Build a fetch impl that retries through the Rust `reqwest` proxy when the
 * WebView2 `fetch()` throws (e.g. HTTP_PROXY env vars not honored). Browser
 * builds (no `__TAURI_INTERNALS__`) short-circuit inside tauriProxyFallback.
 */
function createDesktopFetch(userFetch?: typeof fetch): typeof fetch {
  return async (input, init) => {
    try {
      return await (userFetch ?? globalThis.fetch)(input, init);
    } catch (fetchErr) {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const headers: Record<string, string> = {};
      const h = init?.headers;
      if (h instanceof Headers) {
        h.forEach((v, k) => {
          headers[k] = v;
        });
      } else if (Array.isArray(h)) {
        for (const [k, v] of h) headers[k] = v;
      } else if (h && typeof h === 'object') {
        Object.assign(headers, h);
      }
      const tauriResult = await tauriProxyFallback(url, init ?? {}, headers, fetchErr);
      if (!tauriResult.used) throw fetchErr;
      // Reconstruct a Response-like object for shared unwrap path.
      const body = JSON.stringify(
        // proxy already unwraps Hub envelope into data; re-wrap as OK for shared unwrapHubResponse
        { code: 'OK', data: tauriResult.value },
      );
      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  };
}

// ── 401 token refresh singleton (P0: wire onRefreshToken site-wide) ────────
// Single-flight: N concurrent 401s share one refresh promise.
// Cache: last successful access token is served for REFRESH_CACHE_TTL_MS so
// subsequent requests whose getToken() still reads the (stale) auth singleton
// token get the fresh token without another 401 round-trip.

const REFRESH_CACHE_TTL_MS = 25_000;
let refreshInFlight: Promise<string | null> | null = null;
let cachedRefreshedToken: { token: string; expires: number } | null = null;

/**
 * Returns the most recently refreshed access token if it is still within its
 * cache window. Used to short-circuit getToken() after a refresh so the stale
 * in-memory auth singleton does not cause another 401 storm.
 */
export function getCachedRefreshedAccessToken(): string | null {
  if (cachedRefreshedToken && Date.now() < cachedRefreshedToken.expires) {
    return cachedRefreshedToken.token;
  }
  cachedRefreshedToken = null;
  return null;
}

/**
 * Single-flight Hub access-token refresh. Reads the stored refresh token,
 * exchanges it via the public auth refresh endpoint, persists both tokens to
 * the Tauri credential store, and returns the new access token (or null when
 * there is no refresh token / the exchange fails). Concurrent callers await
 * the same in-flight promise.
 */
async function refreshHubAccessTokenOnce(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const refreshToken = await loadStoredHubRefreshToken();
    if (!refreshToken) return null;
    try {
      // Use the shared client directly (no onRefreshToken → no recursion) so
      // the refresh call reuses the same Tauri-aware desktop fetch path.
      const refreshClient = createSharedHubClient({
        baseUrl: HUB_URL.replace(/\/+$/, ''),
        fetch: createDesktopFetch(),
      });
      const res = await refreshClient.refresh(refreshToken);
      await saveStoredHubAccessToken(res.access_token);
      if (res.refresh_token) {
        await saveStoredHubRefreshToken(res.refresh_token);
      }
      cachedRefreshedToken = {
        token: res.access_token,
        expires: Date.now() + REFRESH_CACHE_TTL_MS,
      };
      return res.access_token;
    } catch (err) {
      cachedRefreshedToken = null;
      // Refresh token invalid/expired — clear it so we don't retry a dead token.
      await clearStoredHubRefreshToken();
      console.warn('[hubClient] 401 token refresh failed:', err);
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/**
 * Desktop createHubClient: shared client + Tauri-aware fetch fallback + 401
 * auto-refresh. When WebView fetch fails, retry once via Rust `proxy_http_post`.
 * 401 responses trigger a single-flight token refresh and one retry.
 */
export function createHubClient(opts: HubClientOptions = {}): SharedHubClient {
  const baseUrl = (opts.baseUrl || HUB_URL).replace(/\/+$/, '');
  const { getToken: userGetToken, ...restOpts } = opts;

  const client = createSharedHubClient({
    ...restOpts,
    baseUrl,
    fetch: createDesktopFetch(opts.fetch),
    onRefreshToken: opts.onRefreshToken ?? refreshHubAccessTokenOnce,
    ...(userGetToken
      ? { getToken: () => getCachedRefreshedAccessToken() ?? userGetToken() }
      : {}),
  });

  // Shape the desktop execution-target request into the Hub wire payload.
  // exactOptionalPropertyTypes forbids assigning `undefined` to optional string
  // fields, so optional top-level fields are only set when defined. The shared
  // builder serializes this object verbatim, so the wire shape is unchanged.
  const toSharedTarget = (data: CreateExecutionTargetRequest | UpdateExecutionTargetRequest): HubExecutionTargetRequest => {
    const target: HubExecutionTargetRequest = {
      name: data.name ?? '',
      type: (data.target_type as ExecutionTargetType | undefined) ?? 'local_edge',
      config: {
        host: data.host,
        port: data.port,
        workspace_root: data.workspace_root,
        workspace_allowlist: data.workspace_allowlist,
        trust_level: data.trust_level,
        device_id: data.device_id,
        capabilities: data.capabilities,
        metadata: data.metadata,
        auth_method: data.auth_method,
      },
    };
    if (data.target_type !== undefined) target.target_type = data.target_type;
    if (data.host !== undefined) target.host = data.host;
    if (data.port !== undefined) target.port = data.port;
    if (data.workspace_root !== undefined) target.workspace_root = data.workspace_root;
    if (data.workspace_allowlist !== undefined) target.workspace_allowlist = data.workspace_allowlist;
    if (data.trust_level !== undefined) target.trust_level = data.trust_level;
    if (data.device_id !== undefined) target.device_id = data.device_id;
    if (data.capabilities !== undefined) target.capabilities = data.capabilities;
    if (data.metadata !== undefined) target.metadata = data.metadata;
    if (data.auth_method !== undefined) target.auth_method = data.auth_method;
    return target;
  };

  return {
    ...client,
    createExecutionTarget: (data: CreateExecutionTargetRequest) =>
      client.createExecutionTarget(toSharedTarget(data)),
    updateExecutionTarget: (id: string, data: UpdateExecutionTargetRequest) =>
      client.updateExecutionTarget(id, toSharedTarget(data)),
  };
}

// ── Desktop compatibility type shims (historical shapes used by local UI) ──
// Prefer Hub* / shared types for new code. These keep existing imports compiling
// while execution-target inventory still uses richer desktop fields.

export type ExecutionTargetHealthState = 'unknown' | 'healthy' | 'degraded' | 'offline' | string;
export type ExecutionTargetTrustLevel = 'local' | 'remote' | 'cloud' | 'relay' | string;

export interface CreateExecutionTargetRequest {
  name: string;
  target_type?: ExecutionTargetType;
  host?: string;
  port?: number | string;
  workspace_root?: string;
  workspace_allowlist?: string[] | string;
  trust_level?: ExecutionTargetTrustLevel;
  device_id?: string;
  capabilities?: Record<string, unknown> | string;
  metadata?: Record<string, unknown> | string;
  auth_method?: 'none' | 'ssh_tunnel' | 'tailscale_mtls' | 'hub_jwt' | string;
}


export interface ExecutionTargetListResponse {
  items: ExecutionTarget[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}
