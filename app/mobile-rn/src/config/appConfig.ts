export const mobileAppConfig = {
  defaultHubBaseUrl: 'http://127.0.0.1:8080',
  oidcIssuer: 'https://id.vectorcontrol.tech',
  authCallbackScheme: 'agenthub',
  /**
   * Mobile data mode:
   * - 'mock'        → JS memory fixtures, no network calls
   * - 'observed'    → read-only Hub (live sessions/messages, no mutations)
   * - 'approved-real' → full Hub+Edge (send messages, trigger tasks, etc.)
   *
   * On native this is set via EXPO_PUBLIC_AGENTHUB_DATA_MODE at build time.
   * Falls back to 'mock' when unset or when no Hub token is available.
   */
  get dataMode(): string | undefined {
    // Expo public env vars are inlined at build time on native,
    // and available on web via import.meta.env.
    if (typeof process !== 'undefined' && typeof process.env !== 'undefined') {
      const envValue = process.env.EXPO_PUBLIC_AGENTHUB_DATA_MODE;
      if (envValue) return envValue;
    }
    return undefined;
  },
} as const;
