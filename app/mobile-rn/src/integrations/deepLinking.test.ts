import { describe, expect, it, vi } from 'vitest';

import {
  createAgentHubAuthCallbackUrl,
  isAgentHubAuthCallback,
  parseAgentHubDeepLink,
  parseOidcCallback,
  startAgentHubDeepLinkBridge,
} from './deepLinking';

describe('AgentHub mobile deep links', () => {
  it('uses the AgentHub OIDC callback scheme', () => {
    expect(createAgentHubAuthCallbackUrl()).toBe('agenthub://auth/callback');
  });

  it('accepts only AgentHub auth callback URLs', () => {
    expect(isAgentHubAuthCallback('agenthub://auth/callback?code=abc&state=123')).toBe(true);
    expect(isAgentHubAuthCallback('agenthub://runs/123')).toBe(false);
    expect(isAgentHubAuthCallback('agenthub://auth/callback-extra?code=abc&state=123')).toBe(false);
    expect(isAgentHubAuthCallback('https://id.vectorcontrol.tech/callback')).toBe(false);
  });

  it('parses TokenDance ID OIDC authorization code callbacks', () => {
    expect(parseOidcCallback('agenthub://auth/callback?code=auth-code&state=pkce-state')).toEqual({
      kind: 'success',
      code: 'auth-code',
      state: 'pkce-state',
    });
  });

  it('decodes callback parameters', () => {
    expect(parseOidcCallback('agenthub://auth/callback?code=code%201&state=state%2F2')).toEqual({
      kind: 'success',
      code: 'code 1',
      state: 'state/2',
    });
  });

  it('returns a testable structure for OIDC error callbacks', () => {
    expect(
      parseOidcCallback(
        'agenthub://auth/callback?error=access_denied&error_description=User%20cancelled&state=pkce-state',
      ),
    ).toEqual({
      kind: 'error',
      error: 'access_denied',
      errorDescription: 'User cancelled',
      state: 'pkce-state',
    });
  });

  it('rejects non-AgentHub callbacks and malformed URLs', () => {
    expect(parseOidcCallback('https://id.vectorcontrol.tech/callback?code=abc&state=123')).toEqual({
      kind: 'invalid',
      reason: 'invalid_callback',
    });
    expect(parseOidcCallback('agenthub://runs/123?code=abc&state=123')).toEqual({
      kind: 'invalid',
      reason: 'invalid_callback',
    });
    expect(parseOidcCallback('not a url')).toEqual({
      kind: 'invalid',
      reason: 'invalid_callback',
    });
  });

  it('rejects successful callbacks without code or state', () => {
    expect(parseOidcCallback('agenthub://auth/callback?state=pkce-state')).toEqual({
      kind: 'invalid',
      reason: 'missing_code',
    });
    expect(parseOidcCallback('agenthub://auth/callback?code=auth-code')).toEqual({
      kind: 'invalid',
      reason: 'missing_state',
    });
  });

  it('maps AgentHub app deep links to navigation targets', () => {
    expect(parseAgentHubDeepLink('agenthub://thread/thread-delicious233')).toEqual({
      kind: 'navigate',
      target: {
        screen: 'thread',
        threadId: 'thread-delicious233',
      },
    });
    expect(parseAgentHubDeepLink('agenthub://run/run-agenthub?threadId=thread-delicious233')).toEqual({
      kind: 'navigate',
      target: {
        screen: 'tasks',
        source: 'run',
        runId: 'run-agenthub',
        threadId: 'thread-delicious233',
      },
    });
    expect(
      parseAgentHubDeepLink('agenthub://approval/approval-agenthub?runId=run-agenthub&threadId=thread-delicious233'),
    ).toEqual({
      kind: 'navigate',
      target: {
        screen: 'tasks',
        source: 'approval',
        approvalId: 'approval-agenthub',
        runId: 'run-agenthub',
        threadId: 'thread-delicious233',
      },
    });
    expect(parseAgentHubDeepLink('agenthub://activity/activity-agenthub?runId=run-agenthub')).toEqual({
      kind: 'navigate',
      target: {
        screen: 'tasks',
        source: 'activity',
        activityId: 'activity-agenthub',
        runId: 'run-agenthub',
      },
    });
  });

  it('keeps OIDC callbacks separate from product navigation deep links', () => {
    expect(parseAgentHubDeepLink('agenthub://auth/callback?code=auth-code&state=pkce-state')).toEqual({
      kind: 'auth_callback',
      callback: {
        kind: 'success',
        code: 'auth-code',
        state: 'pkce-state',
      },
    });
  });

  it('reports malformed or unrelated AgentHub deep links without throwing', () => {
    expect(parseAgentHubDeepLink('not a url')).toEqual({
      kind: 'invalid',
      reason: 'invalid_url',
    });
    expect(parseAgentHubDeepLink('https://id.vectorcontrol.tech/callback')).toEqual({
      kind: 'invalid',
      reason: 'invalid_scheme',
    });
    expect(parseAgentHubDeepLink('agenthub://run')).toEqual({
      kind: 'error',
      reason: 'missing_run_id',
    });
    expect(parseAgentHubDeepLink('agenthub://workspace/mobile')).toEqual({
      kind: 'ignore',
      reason: 'unknown_route',
    });
  });

  it('starts a deep link bridge from initial URL and listener events', async () => {
    let listener: ((event: { url: string }) => void) | undefined;
    const remove = vi.fn();
    const onNavigate = vi.fn();
    const onAuthCallback = vi.fn();
    const bridge = await startAgentHubDeepLinkBridge({
      linking: {
        async getInitialURL() {
          return 'agenthub://thread/thread-delicious233';
        },
        addEventListener(_type, nextListener) {
          listener = nextListener;
          return { remove };
        },
      },
      onAuthCallback,
      onNavigate,
    });

    listener?.({ url: 'agenthub://run/run-agenthub?threadId=thread-delicious233' });
    listener?.({ url: 'agenthub://auth/callback?code=auth-code&state=pkce-state' });
    listener?.({ url: 'agenthub://run/run-agenthub?threadId=thread-delicious233' });
    bridge.stop();

    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenNthCalledWith(1, {
      screen: 'thread',
      threadId: 'thread-delicious233',
    });
    expect(onNavigate).toHaveBeenNthCalledWith(2, {
      screen: 'tasks',
      source: 'run',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });
    expect(onAuthCallback).toHaveBeenCalledWith({
      kind: 'success',
      code: 'auth-code',
      state: 'pkce-state',
    });
    expect(remove).toHaveBeenCalledOnce();
  });
});
