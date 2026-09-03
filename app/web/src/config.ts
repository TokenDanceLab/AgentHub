// Web config. Browser execution flows through Hub; Local Edge is Desktop-only.

function envOrDev(key: string, devDefault: string): string {
  const val = (import.meta.env as Record<string, string | undefined>)[key];
  if (val) return val;
  if (import.meta.env.DEV) return devDefault;
  console.error(`[AgentHub Web] ${key} is not set. Configure it for production deployment.`);
  return '';
}

export const HUB_URL = envOrDev('VITE_HUB_URL', 'http://localhost:8080');
export const HUB_WS_URL = envOrDev('VITE_HUB_WS_URL', 'ws://localhost:8080/client/ws');
export const HEALTH_POLL_MS = 5000;
export const RUNNERS_POLL_MS = 10000;
export const APP_VERSION = '0.4.1';
