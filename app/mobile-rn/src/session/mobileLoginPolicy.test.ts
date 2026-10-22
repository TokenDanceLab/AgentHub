import { describe, expect, it } from 'vitest';
import {
  isMobileAccountLoginEnabled,
  resolveMobileAccountLoginEnabled,
} from './mobileLoginPolicy';

describe('mobile Account login policy', () => {
  it('is disabled unless explicitly opted in', () => {
    expect(isMobileAccountLoginEnabled(undefined)).toBe(false);
    expect(isMobileAccountLoginEnabled('')).toBe(false);
    expect(isMobileAccountLoginEnabled('false')).toBe(false);
    expect(isMobileAccountLoginEnabled('1')).toBe(false);
  });

  it('accepts an explicit true opt-in', () => {
    expect(isMobileAccountLoginEnabled('true')).toBe(true);
    expect(isMobileAccountLoginEnabled(' TRUE ')).toBe(true);
  });

  it('requires both the explicit opt-in and a configured issuer', () => {
    expect(resolveMobileAccountLoginEnabled({
      EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED: 'true',
    })).toBe(false);
    expect(resolveMobileAccountLoginEnabled({
      EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED: 'true',
      EXPO_PUBLIC_ACCOUNT_OIDC_ISSUER: 'https://account.example',
    })).toBe(true);
  });
});
