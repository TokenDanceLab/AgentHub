// Web config. Browser execution flows through Hub; Local Edge is Desktop-only.

// Browser cookies and CSRF proof are scoped to this origin; Vite proxies Hub.
export const HUB_URL = '';
export const HUB_WS_URL = typeof window === 'undefined' ? '/client/ws'
  : `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/client/ws`;
export const HEALTH_POLL_MS = 5000;
