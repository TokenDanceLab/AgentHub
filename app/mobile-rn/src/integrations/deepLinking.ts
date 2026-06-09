import type { MobileNavigationTarget } from './notificationIntents';

export const agentHubAuthCallbackPath = 'auth/callback';

const [agentHubAuthCallbackHost, agentHubAuthCallbackRoute] = agentHubAuthCallbackPath.split('/');

export type ParsedOidcCallback =
  | {
      kind: 'success';
      code: string;
      state: string;
    }
  | {
      kind: 'error';
      error: string;
      errorDescription?: string;
      state?: string;
    }
  | {
      kind: 'invalid';
      reason: 'invalid_callback' | 'missing_code' | 'missing_state';
    };

export type ParsedAgentHubDeepLink =
  | {
      kind: 'auth_callback';
      callback: ParsedOidcCallback;
    }
  | {
      kind: 'navigate';
      target: MobileNavigationTarget;
    }
  | {
      kind: 'ignore';
      reason: 'unknown_route';
    }
  | {
      kind: 'error';
      reason: 'missing_thread_id' | 'missing_run_id' | 'missing_approval_id';
    }
  | {
      kind: 'invalid';
      reason: 'invalid_url' | 'invalid_scheme';
    };

export interface LinkingLike {
  getInitialURL?: () => Promise<string | null>;
  addEventListener?: (
    type: 'url',
    listener: (event: { url: string }) => void,
  ) => { remove: () => void };
}

export interface AgentHubDeepLinkBridge {
  stop: () => void;
}

export interface StartAgentHubDeepLinkBridgeOptions {
  linking: LinkingLike;
  scheme?: string;
  onNavigate?: (target: MobileNavigationTarget) => void;
  onAuthCallback?: (callback: ParsedOidcCallback) => void;
  onIgnored?: (reason: Extract<ParsedAgentHubDeepLink, { kind: 'ignore' }>['reason']) => void;
  onError?: (reason: Exclude<ParsedAgentHubDeepLink, { kind: 'navigate' | 'auth_callback' | 'ignore' }>['reason']) => void;
}

export function createAgentHubAuthCallbackUrl(scheme = 'agenthub'): string {
  return `${scheme}://${agentHubAuthCallbackPath}`;
}

export function isAgentHubAuthCallback(url: string, scheme = 'agenthub'): boolean {
  return parseAgentHubAuthCallbackUrl(url, scheme) !== null;
}

export function parseOidcCallback(url: string, scheme = 'agenthub'): ParsedOidcCallback {
  const callbackUrl = parseAgentHubAuthCallbackUrl(url, scheme);

  if (callbackUrl === null) {
    return { kind: 'invalid', reason: 'invalid_callback' };
  }

  const error = callbackUrl.searchParams.get('error');

  if (error) {
    const errorDescription = callbackUrl.searchParams.get('error_description');
    const state = callbackUrl.searchParams.get('state');

    return {
      kind: 'error',
      error,
      ...(errorDescription ? { errorDescription } : {}),
      ...(state ? { state } : {}),
    };
  }

  const code = callbackUrl.searchParams.get('code');
  const state = callbackUrl.searchParams.get('state');

  if (!code) {
    return { kind: 'invalid', reason: 'missing_code' };
  }

  if (!state) {
    return { kind: 'invalid', reason: 'missing_state' };
  }

  return { kind: 'success', code, state };
}

export function parseAgentHubDeepLink(url: string, scheme = 'agenthub'): ParsedAgentHubDeepLink {
  const parsedUrl = parseAgentHubUrl(url);

  if (parsedUrl === null) {
    return { kind: 'invalid', reason: 'invalid_url' };
  }

  if (parsedUrl.protocol !== `${scheme}:`) {
    return { kind: 'invalid', reason: 'invalid_scheme' };
  }

  if (parsedUrl.hostname === agentHubAuthCallbackHost && parsedUrl.pathname === `/${agentHubAuthCallbackRoute}`) {
    return {
      kind: 'auth_callback',
      callback: parseOidcCallback(url, scheme),
    };
  }

  const route = parsedUrl.hostname;
  const routeId = readPathId(parsedUrl);

  if (route === 'thread' || route === 'threads') {
    if (routeId == null) {
      return { kind: 'error', reason: 'missing_thread_id' };
    }
    return {
      kind: 'navigate',
      target: {
        screen: 'thread',
        threadId: routeId,
      },
    };
  }

  if (route === 'run' || route === 'runs') {
    if (routeId == null) {
      return { kind: 'error', reason: 'missing_run_id' };
    }
    return {
      kind: 'navigate',
      target: {
        screen: 'run',
        runId: routeId,
        ...optionalSearchId('threadId', parsedUrl),
      },
    };
  }

  if (route === 'approval' || route === 'approvals') {
    if (routeId == null) {
      return { kind: 'error', reason: 'missing_approval_id' };
    }
    return {
      kind: 'navigate',
      target: {
        screen: 'approval',
        approvalId: routeId,
        ...optionalSearchId('runId', parsedUrl),
        ...optionalSearchId('threadId', parsedUrl),
      },
    };
  }

  if (route === 'activity' || route === 'activities') {
    return {
      kind: 'navigate',
      target: {
        screen: 'activity',
        ...optionalPathId('activityId', routeId),
        ...optionalSearchId('runId', parsedUrl),
        ...optionalSearchId('threadId', parsedUrl),
      },
    };
  }

  return { kind: 'ignore', reason: 'unknown_route' };
}

export async function startAgentHubDeepLinkBridge(
  options: StartAgentHubDeepLinkBridgeOptions,
): Promise<AgentHubDeepLinkBridge> {
  const scheme = options.scheme ?? 'agenthub';
  const seenUrls = new Set<string>();

  const handleUrl = (url: string) => {
    if (seenUrls.has(url)) {
      return;
    }
    seenUrls.add(url);

    const result = parseAgentHubDeepLink(url, scheme);

    if (result.kind === 'navigate') {
      options.onNavigate?.(result.target);
      return;
    }

    if (result.kind === 'auth_callback') {
      options.onAuthCallback?.(result.callback);
      return;
    }

    if (result.kind === 'ignore') {
      options.onIgnored?.(result.reason);
      return;
    }

    options.onError?.(result.reason);
  };

  const initialUrl = await options.linking.getInitialURL?.();
  if (initialUrl) {
    handleUrl(initialUrl);
  }

  const subscription = options.linking.addEventListener?.('url', (event) => {
    handleUrl(event.url);
  });

  return {
    stop() {
      subscription?.remove();
    },
  };
}

export async function startExpoAgentHubDeepLinkBridge(
  options: Omit<StartAgentHubDeepLinkBridgeOptions, 'linking'>,
): Promise<AgentHubDeepLinkBridge> {
  const linking = await import('expo-linking');
  return startAgentHubDeepLinkBridge({ ...options, linking });
}

function parseAgentHubAuthCallbackUrl(url: string, scheme: string): URL | null {
  const parsedUrl = parseAgentHubUrl(url);

  if (
    parsedUrl === null ||
    parsedUrl.protocol !== `${scheme}:` ||
    parsedUrl.hostname !== agentHubAuthCallbackHost ||
    parsedUrl.pathname !== `/${agentHubAuthCallbackRoute}`
  ) {
    return null;
  }

  return parsedUrl;
}

function parseAgentHubUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function readPathId(url: URL): string | undefined {
  const id = decodeURIComponent(url.pathname.replace(/^\/+/, '').split('/')[0] ?? '').trim();
  return id.length > 0 ? id : undefined;
}

function readSearchString(url: URL, key: string): string | undefined {
  const value = url.searchParams.get(key)?.trim();
  return value ? value : undefined;
}

function optionalSearchId<Key extends string>(key: Key, url: URL): Partial<Record<Key, string>> {
  const value = readSearchString(url, key);
  return value == null ? {} : { [key]: value } as Record<Key, string>;
}

function optionalPathId<Key extends string>(key: Key, value: string | undefined): Partial<Record<Key, string>> {
  return value == null ? {} : { [key]: value } as Record<Key, string>;
}
