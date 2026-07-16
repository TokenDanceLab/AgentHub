// Desktop Hub client — thin surface over shared SSOT (#432 / T3.3).
// - Method/DTO SSOT: @shared/hubClient
// - Desktop-only glue: default HUB_URL + Tauri proxy fetch fallback
// Do NOT add new Hub REST methods here; add them to app/shared/src/hubClient.ts first.

import { HUB_URL } from '@/config';
import { AppError } from '@shared/errors';
import {
  createHubClient as createSharedHubClient,
  type ExecutionTarget,
  type ExecutionTargetType,
  type HubClient as SharedHubClient,
  type HubClientOptions as SharedHubClientOptions,
} from '@shared/hubClient';

// Re-export shared types/methods surface for existing desktop imports.
export * from '@shared/hubClient';
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
async function tauriProxyFallback<T>(
  url: string,
  options: RequestInit,
  headers: Record<string, string>,
  originalError: unknown,
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



/**
 * Desktop createHubClient: shared client + Tauri-aware fetch fallback.
 * When WebView fetch fails, retry once via Rust `proxy_http_post`.
 */
export function createHubClient(opts: HubClientOptions = {}): SharedHubClient {
  const baseUrl = (opts.baseUrl || HUB_URL).replace(/\/+$/, '');
  const userFetch = opts.fetch;

  const desktopFetch: typeof fetch = async (input, init) => {
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

  const client = createSharedHubClient({
    ...opts,
    baseUrl,
    fetch: desktopFetch,
  });

  const toSharedTarget = (data: CreateExecutionTargetRequest | UpdateExecutionTargetRequest) => ({
    name: data.name ?? '',
    type: (data.target_type as ExecutionTargetType | undefined) ?? 'local_edge',
    target_type: data.target_type,
    host: data.host,
    port: data.port,
    workspace_root: data.workspace_root,
    workspace_allowlist: data.workspace_allowlist,
    trust_level: data.trust_level,
    device_id: data.device_id,
    capabilities: data.capabilities,
    metadata: data.metadata,
    auth_method: data.auth_method,
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
  });

  return {
    ...client,
    createExecutionTarget: (data: CreateExecutionTargetRequest) =>
      client.createExecutionTarget(toSharedTarget(data) as never),
    updateExecutionTarget: (id: string, data: UpdateExecutionTargetRequest) =>
      client.updateExecutionTarget(id, toSharedTarget(data) as never),
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

export type UpdateExecutionTargetRequest = Partial<CreateExecutionTargetRequest>;

export interface ExecutionTargetListResponse {
  items: ExecutionTarget[];
  page: {
    nextCursor?: string;
    hasMore: boolean;
  };
}
