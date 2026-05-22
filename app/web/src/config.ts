export const EDGE_URL = import.meta.env.VITE_AGENTHUB_EDGE_URL ?? 'http://127.0.0.1:3210';

export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 5000;
export const EVENT_LOG_MAX = 1000;

export function edgeWebSocketUrl(baseUrl = EDGE_URL): string {
  const url = new URL('/v1/events', baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}
