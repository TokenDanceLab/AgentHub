import { describe, expect, it } from 'vitest';

import { createAgentHubAuthCallbackUrl, isAgentHubAuthCallback } from './deepLinking';

describe('AgentHub mobile deep links', () => {
  it('uses the AgentHub OIDC callback scheme', () => {
    expect(createAgentHubAuthCallbackUrl()).toBe('agenthub://auth/callback');
  });

  it('accepts only AgentHub auth callback URLs', () => {
    expect(isAgentHubAuthCallback('agenthub://auth/callback?code=abc&state=123')).toBe(true);
    expect(isAgentHubAuthCallback('agenthub://runs/123')).toBe(false);
    expect(isAgentHubAuthCallback('https://id.vectorcontrol.tech/callback')).toBe(false);
  });
});
