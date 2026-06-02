// Centralized config — single source of truth for URLs and intervals.
// Change these when deploying or connecting to a different Edge / Hub.
//
// EDGE_URL and WS_URL can be overridden at runtime:
//   - VITE_EDGE_URL env var (build-time)
//   - EDGE_URL query param (?edge_url=http://host:port) for port-forwarding
//   - localStorage key "agenthub_edge_url" (persisted across restarts)
// Priority: query param > localStorage > env var > default

const defaultEdgeHost = '127.0.0.1:3210';

function resolveEdgeUrl(): string {
  // 1. Query param (highest priority — for port-forwarding / temporary overrides)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get('edge_url');
    if (qp) return qp.replace(/\/+$/, '');
  }
  // 2. localStorage (persisted across restarts)
  try {
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem('agenthub_edge_url');
      if (stored) return stored.replace(/\/+$/, '');
    }
  } catch { /* localStorage unavailable */ }
  // 3. Build-time env var
  const envUrl = import.meta.env.VITE_EDGE_URL;
  if (envUrl) return envUrl.replace(/\/+$/, '');
  // 4. Default
  return `http://${defaultEdgeHost}`;
}

function resolveWsUrl(): string {
  // Derive WS URL from the resolved HTTP URL
  const edgeUrl = resolveEdgeUrl();
  try {
    const u = new URL(edgeUrl);
    u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    u.pathname = '/v1/events';
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return `ws://${defaultEdgeHost}/v1/events`;
  }
}

export function getEdgeBaseUrl(): string { return resolveEdgeUrl(); }
export function getEdgeWsUrl(): string { return resolveWsUrl(); }

// Update the persisted edge URL (call from settings UI).
export function setPersistedEdgeUrl(url: string): void {
  try {
    if (typeof window !== 'undefined') {
      if (url) {
        window.localStorage.setItem('agenthub_edge_url', url.replace(/\/+$/, ''));
      } else {
        window.localStorage.removeItem('agenthub_edge_url');
      }
    }
  } catch { /* localStorage unavailable */ }
}

export function getPersistedEdgeUrl(): string {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage.getItem('agenthub_edge_url') || '';
    }
  } catch { /* localStorage unavailable */ }
  return '';
}

export const EDGE_URL = resolveEdgeUrl();
export const WS_URL = resolveWsUrl();
export const EDGE_AUTH_TOKEN = import.meta.env.VITE_EDGE_AUTH_TOKEN || '';

function envOrDev(key: string, devDefault: string): string {
  const val = (import.meta.env as Record<string, string | undefined>)[key];
  if (val) return val;
  if (import.meta.env.DEV) return devDefault;
  console.error(`[AgentHub Desktop] ${key} is not set. Configure it for production deployment.`);
  return '';
}

export const HUB_URL = envOrDev('VITE_HUB_URL', 'http://localhost:8080');
export const HUB_WS_URL = envOrDev('VITE_HUB_WS_URL', 'ws://localhost:8080/client/ws');
export const TOKENDANCE_LOGIN_URL = import.meta.env.VITE_TOKENDANCE_LOGIN_URL || '';

export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 5000;
export const EVENT_LOG_MAX = 1000;
export const APP_VERSION = '0.1.0';
