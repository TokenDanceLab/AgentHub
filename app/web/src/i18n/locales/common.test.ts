import { describe, expect, it } from 'vitest';
import enCommon from './en/common.json';
import zhCommon from './zh/common.json';

describe('web common.json auth.error.oidc.tokenExchangeFailed', () => {
  it('en contains actionable guidance (retry/network/sign-in)', () => {
    const msg = enCommon['auth.error.oidc.tokenExchangeFailed'];
    expect(msg).toBeDefined();
    // Must contain at least two of: retry/try again, network, sign in/login
    const lower = msg.toLowerCase();
    const hasRetry = /retry|try again|try signing in/.test(lower);
    const hasNetwork = /network/.test(lower);
    const hasSignIn = /sign.?in|login/.test(lower);
    const guidanceCount = [hasRetry, hasNetwork, hasSignIn].filter(Boolean).length;
    expect(guidanceCount).toBeGreaterThanOrEqual(2);
    // Must NOT contain raw {{detail}} interpolation (we replaced it with static guidance)
    expect(msg).not.toContain('{{detail}}');
  });

  it('zh contains actionable guidance and no English technical strings', () => {
    const msg = zhCommon['auth.error.oidc.tokenExchangeFailed'];
    expect(msg).toBeDefined();
    // Must contain Chinese guidance keywords
    const hasRetry = /重试|重新/.test(msg);
    const hasNetwork = /网络/.test(msg);
    const hasLogin = /登录/.test(msg);
    const guidanceCount = [hasRetry, hasNetwork, hasLogin].filter(Boolean).length;
    expect(guidanceCount).toBeGreaterThanOrEqual(2);
    // Must NOT contain raw {{detail}} or English technical phrases
    expect(msg).not.toContain('{{detail}}');
    expect(msg).not.toMatch(/token exchange|authorization code|failed to exchange/i);
  });

  it('en and zh keys are paired (both exist and non-empty)', () => {
    expect(enCommon['auth.error.oidc.tokenExchangeFailed']).toBeTruthy();
    expect(zhCommon['auth.error.oidc.tokenExchangeFailed']).toBeTruthy();
  });
});

describe('web common.json webChat.signInRequired', () => {
  it('en and zh keys are paired (both exist and non-empty)', () => {
    expect(enCommon['webChat.signInRequired']).toBeTruthy();
    expect(zhCommon['webChat.signInRequired']).toBeTruthy();
  });

  it('zh value is Chinese (no English technical strings)', () => {
    const msg = zhCommon['webChat.signInRequired'];
    // Must contain CJK characters
    expect(msg).toMatch(/[\u4e00-\u9fff]/);
    // Must not be a raw key echo
    expect(msg).not.toBe('webChat.signInRequired');
  });
});
