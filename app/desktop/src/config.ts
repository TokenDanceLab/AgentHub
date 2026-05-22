// Centralized config — single source of truth for URLs and intervals.
// Change these when deploying or connecting to a different Edge.

export const EDGE_URL = 'http://127.0.0.1:3210';
export const WS_URL = 'ws://127.0.0.1:3210/v1/events';

export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 5000;
export const EVENT_LOG_MAX = 1000;
