import { EDGE_AUTH_TOKEN } from '@/config';

const EDGE_AUTH_STORAGE_KEY = 'agenthub:edge_auth_token';

let runtimeEdgeAuthToken = '';

export function setEdgeAuthToken(token: string | null | undefined): void {
  runtimeEdgeAuthToken = token?.trim() ?? '';
  try {
    if (runtimeEdgeAuthToken) {
      sessionStorage.setItem(EDGE_AUTH_STORAGE_KEY, runtimeEdgeAuthToken);
    } else {
      sessionStorage.removeItem(EDGE_AUTH_STORAGE_KEY);
    }
  } catch {
    // Session storage can be unavailable in restricted previews.
  }
}

export function getEdgeAuthToken(): string {
  if (EDGE_AUTH_TOKEN) return EDGE_AUTH_TOKEN;
  if (runtimeEdgeAuthToken) return runtimeEdgeAuthToken;
  try {
    const token = sessionStorage.getItem(EDGE_AUTH_STORAGE_KEY)?.trim();
    if (token) return token;
  } catch {
    // Fall through to legacy localStorage.
  }
  try {
    return localStorage.getItem(EDGE_AUTH_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

/**
 * Refresh the Edge auth token from the Vite dev server middleware (`/__edge_token`).
 * This is only useful in dev mode — in production Tauri the token is always
 * available via the `invoke('get_edge_auth_token')` bridge.
 *
 * Returns the new token, or empty string if unavailable.
 */
export async function refreshEdgeAuthToken(): Promise<string> {
  // Only attempt in dev mode with a Vite dev server running.
  if (!import.meta.env.DEV) return getEdgeAuthToken();
  try {
    const res = await fetch('/__edge_token');
    if (!res.ok) return getEdgeAuthToken();
    const token = (await res.text()).trim();
    if (token) {
      setEdgeAuthToken(token);
    }
    return token;
  } catch {
    return getEdgeAuthToken();
  }
}

export function edgeAuthHeaders(base?: HeadersInit): HeadersInit | undefined {
  const token = getEdgeAuthToken();
  if (!token) return base;
  return {
    ...headersToRecord(base),
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Fixed Sec-WebSocket-Protocol marker negotiated with Edge /v1/events upgrades.
 * Paired with the raw Edge token as a second subprotocol value.
 * Must match edge-server httpserver.WSEdgeBearerSubprotocol.
 */
export const EDGE_WS_BEARER_SUBPROTOCOL = 'agenthub.edge.bearer.v1';

/**
 * Build WebSocket subprotocols that carry an Edge auth token without putting
 * it in the URL. Returns undefined when token is missing so the socket opens
 * without auth protocols.
 *
 * Convention (preferred desktop/browser path):
 *   protocols: ["agenthub.edge.bearer.v1", "<edge-token>"]
 */
export function buildEdgeWSAuthProtocols(
  token: string | null | undefined = getEdgeAuthToken(),
): string[] | undefined {
  if (!token) return undefined;
  return [EDGE_WS_BEARER_SUBPROTOCOL, token];
}

/**
 * Legacy query-token helper. Prefer Sec-WebSocket-Protocol via
 * buildEdgeWSAuthProtocols; query access_token is rejected by Edge (#965).
 * Kept only for optional tests / temporary fallback callers (default off).
 */
export function withEdgeAuthQuery(url: string): string {
  const token = getEdgeAuthToken();
  if (!token) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('access_token', token);
  return parsed.toString();
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}
