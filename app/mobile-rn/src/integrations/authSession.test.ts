import { describe, expect, it } from 'vitest';

import {
  buildTokenDanceIdAuthorizationUrl,
  createExpoAgentHubRedirectUri,
  createTokenDanceIdAuthRequest,
  getTokenDanceIdDiscovery,
  openTokenDanceIdAuthSession,
} from './authSession';

describe('TokenDance ID mobile auth session', () => {
  it('builds only the TokenDance ID OIDC Authorization Code + PKCE request', () => {
    const request = createTokenDanceIdAuthRequest({
      issuer: 'https://id.tokendance.test',
      clientId: 'agenthub-mobile-TokenDance',
      redirectUri: 'agenthub://auth/callback',
      state: 'state-Delicious233',
      codeChallenge: 'challenge-TokenDance',
    });

    expect(request).toEqual({
      issuer: 'https://id.tokendance.test',
      clientId: 'agenthub-mobile-TokenDance',
      redirectUri: 'agenthub://auth/callback',
      responseType: 'code',
      usePkce: true,
      codeChallengeMethod: 'S256',
      state: 'state-Delicious233',
      codeChallenge: 'challenge-TokenDance',
      scopes: ['openid', 'profile', 'email'],
    });
    expect(Object.keys(request)).not.toContain('provider');
    expect(JSON.stringify(request).toLowerCase()).not.toContain('github');
    expect(JSON.stringify(request).toLowerCase()).not.toContain('google');
    expect(JSON.stringify(request).toLowerCase()).not.toContain('feishu');
  });

  it('normalizes issuer discovery endpoints without adding provider routes', () => {
    expect(getTokenDanceIdDiscovery('https://id.tokendance.test/')).toEqual({
      issuer: 'https://id.tokendance.test',
      authorizationEndpoint: 'https://id.tokendance.test/oauth/authorize',
      tokenEndpoint: 'https://id.tokendance.test/oauth/token',
    });
  });

  it('creates an encoded authorization URL for system browser launch', () => {
    const url = buildTokenDanceIdAuthorizationUrl({
      issuer: 'https://id.tokendance.test',
      clientId: 'agenthub-mobile-TokenDance',
      redirectUri: 'agenthub://auth/callback',
      state: 'state Delicious233',
      codeChallenge: 'challenge/TokenDance',
      scopes: ['openid', 'profile'],
    });

    expect(url).toBe(
      'https://id.tokendance.test/oauth/authorize?response_type=code&client_id=agenthub-mobile-TokenDance&redirect_uri=agenthub%3A%2F%2Fauth%2Fcallback&scope=openid+profile&state=state+Delicious233&code_challenge=challenge%2FTokenDance&code_challenge_method=S256',
    );
  });

  it('creates the native Expo redirect URI through AuthSession', () => {
    const redirectUri = createExpoAgentHubRedirectUri({
      makeRedirectUri(options) {
        return `${options.scheme}://${options.path}`;
      },
    });

    expect(redirectUri).toBe('agenthub://auth/callback');
  });

  it('opens the TokenDance ID URL in a system auth session without provider tokens', async () => {
    const openedUrls: string[] = [];
    const result = await openTokenDanceIdAuthSession({
      issuer: 'https://id.tokendance.test',
      clientId: 'agenthub-mobile-TokenDance',
      redirectUri: 'agenthub://auth/callback',
      state: 'state-Delicious233',
      codeChallenge: 'challenge-TokenDance',
      webBrowser: {
        maybeCompleteAuthSession() {
          openedUrls.push('completed');
        },
        async openAuthSessionAsync(url, redirectUrl) {
          openedUrls.push(url);
          openedUrls.push(redirectUrl ?? '');
          return { type: 'opened', url: 'agenthub://auth/callback?code=code&state=state-Delicious233' };
        },
      },
    });

    expect(result).toEqual({
      type: 'opened',
      url: 'agenthub://auth/callback?code=code&state=state-Delicious233',
    });
    expect(openedUrls[0]).toBe('completed');
    expect(openedUrls[1]).toContain('https://id.tokendance.test/oauth/authorize?');
    expect(openedUrls[1]).toContain('code_challenge=challenge-TokenDance');
    expect(openedUrls[1]?.toLowerCase()).not.toContain('github');
    expect(openedUrls[1]?.toLowerCase()).not.toContain('google');
    expect(openedUrls[1]?.toLowerCase()).not.toContain('feishu');
    expect(openedUrls[2]).toBe('agenthub://auth/callback');
  });
});
