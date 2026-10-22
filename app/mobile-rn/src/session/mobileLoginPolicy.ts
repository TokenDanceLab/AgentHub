/**
 * Mobile remains a fixture/contract lane until a packaged build, secure
 * redirect registration, and approved-real Account evidence exist. Real
 * Account login is therefore opt-in, not the default.
 */
export function isMobileAccountLoginEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true';
}

export function resolveMobileAccountLoginEnabled(
  envOverride?: Record<string, string | undefined>,
): boolean {
  const env = envOverride ?? (globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  }).process?.env;
  return isMobileAccountLoginEnabled(env?.EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED)
    && Boolean(env?.EXPO_PUBLIC_ACCOUNT_OIDC_ISSUER?.trim());
}
