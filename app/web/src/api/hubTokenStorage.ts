/** Remove credentials written by older Web releases. New Web sessions use HttpOnly cookies. */
export async function clearLegacyHubCredentials(): Promise<void> {
  for (const key of ['agenthub_hub_token', 'agenthub_hub_refresh_token', 'agenthub_token_source', 'agenthub_hub_user', 'agenthub_oidc_pkce_pending']) {
    for (const storageName of ['localStorage', 'sessionStorage'] as const) {
      try { window[storageName].removeItem(key); } catch { /* storage disabled */ }
    }
  }
}
