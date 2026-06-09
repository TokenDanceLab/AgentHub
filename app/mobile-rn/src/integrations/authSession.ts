export interface TokenDanceIdDiscovery {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}

export interface TokenDanceIdAuthRequestOptions {
  issuer: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  scopes?: string[];
}

export interface TokenDanceIdAuthRequest {
  issuer: string;
  clientId: string;
  redirectUri: string;
  responseType: 'code';
  usePkce: true;
  codeChallengeMethod: 'S256';
  state: string;
  codeChallenge: string;
  scopes: string[];
}

export interface ExpoAuthSessionLike {
  makeRedirectUri(options: { scheme: string; path: string }): string;
}

export interface ExpoWebBrowserLike {
  maybeCompleteAuthSession?: () => void;
  openAuthSessionAsync: (
    url: string,
    redirectUrl?: string,
  ) => Promise<{ type: string; url?: string }>;
}

export interface OpenTokenDanceIdAuthSessionOptions extends TokenDanceIdAuthRequestOptions {
  webBrowser?: ExpoWebBrowserLike;
}

const DEFAULT_TOKEN_DANCE_ID_SCOPES = ['openid', 'profile', 'email'] as const;

export function getTokenDanceIdDiscovery(issuer: string): TokenDanceIdDiscovery {
  const normalizedIssuer = normalizeIssuer(issuer);

  return {
    issuer: normalizedIssuer,
    authorizationEndpoint: `${normalizedIssuer}/oauth/authorize`,
    tokenEndpoint: `${normalizedIssuer}/oauth/token`,
  };
}

export function createTokenDanceIdAuthRequest(
  options: TokenDanceIdAuthRequestOptions,
): TokenDanceIdAuthRequest {
  return {
    issuer: normalizeIssuer(options.issuer),
    clientId: options.clientId,
    redirectUri: options.redirectUri,
    responseType: 'code',
    usePkce: true,
    codeChallengeMethod: 'S256',
    state: options.state,
    codeChallenge: options.codeChallenge,
    scopes: options.scopes ?? [...DEFAULT_TOKEN_DANCE_ID_SCOPES],
  };
}

export function buildTokenDanceIdAuthorizationUrl(
  options: TokenDanceIdAuthRequestOptions,
): string {
  const request = createTokenDanceIdAuthRequest(options);
  const discovery = getTokenDanceIdDiscovery(request.issuer);
  const url = new URL(discovery.authorizationEndpoint);

  url.searchParams.set('response_type', request.responseType);
  url.searchParams.set('client_id', request.clientId);
  url.searchParams.set('redirect_uri', request.redirectUri);
  url.searchParams.set('scope', request.scopes.join(' '));
  url.searchParams.set('state', request.state);
  url.searchParams.set('code_challenge', request.codeChallenge);
  url.searchParams.set('code_challenge_method', request.codeChallengeMethod);

  return url.toString();
}

export function createExpoAgentHubRedirectUri(
  authSession: ExpoAuthSessionLike,
  scheme = 'agenthub',
): string {
  return authSession.makeRedirectUri({ scheme, path: 'auth/callback' });
}

export async function openTokenDanceIdAuthSession(
  options: OpenTokenDanceIdAuthSessionOptions,
): Promise<{ type: string; url?: string }> {
  const webBrowser = options.webBrowser ?? await loadExpoWebBrowser();
  const authUrl = buildTokenDanceIdAuthorizationUrl(options);

  webBrowser.maybeCompleteAuthSession?.();
  return webBrowser.openAuthSessionAsync(authUrl, options.redirectUri);
}

export async function createExpoAgentHubRedirectUriFromRuntime(
  scheme = 'agenthub',
): Promise<string> {
  const authSession = await import('expo-auth-session');
  return createExpoAgentHubRedirectUri(authSession, scheme);
}

async function loadExpoWebBrowser(): Promise<ExpoWebBrowserLike> {
  return import('expo-web-browser');
}

function normalizeIssuer(issuer: string): string {
  return issuer.replace(/\/+$/, '');
}
