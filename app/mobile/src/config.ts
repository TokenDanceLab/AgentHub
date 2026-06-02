import { setBaseUrl } from "@agenthub/shared";

// Hub Server URL — use VITE_HUB_URL / VITE_HUB_WS_URL env vars in production builds.
// In dev mode (vite dev / visual:qa) fall back to localhost so the mobile WebView
// talks to a locally running Hub without hitting production.
export const DEFAULT_HUB_URL =
  import.meta.env.VITE_HUB_URL ||
  (import.meta.env.DEV ? "http://localhost:8080" : "");

export const DEFAULT_HUB_WS_URL =
  import.meta.env.VITE_HUB_WS_URL ||
  (import.meta.env.DEV ? "ws://localhost:8080/client/ws" : "");

// Initialize shared API client to target Hub Server
setBaseUrl(DEFAULT_HUB_URL);
