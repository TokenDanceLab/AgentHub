// Web config. Browser execution flows through Hub; Local Edge is Desktop-only.
export const HUB_URL = import.meta.env.VITE_HUB_URL || 'http://localhost:8080';
export const HUB_WS_URL = import.meta.env.VITE_HUB_WS_URL || 'ws://localhost:8080/client/ws';
export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 10000;
export const EVENT_LOG_MAX = 1000;
export const APP_VERSION = '0.1.0';
