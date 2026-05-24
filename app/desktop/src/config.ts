// Centralized config — single source of truth for URLs and intervals.
// Change these when deploying or connecting to a different Edge / Hub.

export const EDGE_URL = 'http://127.0.0.1:3210';
export const WS_URL = 'ws://127.0.0.1:3210/v1/events';
export const HUB_URL = import.meta.env.VITE_HUB_URL || 'http://localhost:8080';

export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 5000;
export const EVENT_LOG_MAX = 1000;
