export const agentHubAuthCallbackPath = 'auth/callback';

export function createAgentHubAuthCallbackUrl(scheme = 'agenthub'): string {
  return `${scheme}://${agentHubAuthCallbackPath}`;
}

export function isAgentHubAuthCallback(url: string, scheme = 'agenthub'): boolean {
  return url.startsWith(createAgentHubAuthCallbackUrl(scheme));
}
