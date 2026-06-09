import { describe, expect, it, vi } from 'vitest';

import {
  configureAgentHubAndroidNotificationChannel,
  startAgentHubNotificationBridge,
  type NotificationResponseLike,
} from './notificationBridge';

function createResponse(
  identifier: string,
  data: NotificationResponseLike['notification']['request']['content']['data'],
): NotificationResponseLike {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data,
        },
      },
    },
  };
}

describe('AgentHub notification bridge', () => {
  it('routes the last native notification response to a Mobile navigation target', async () => {
    const onNavigate = vi.fn();

    await startAgentHubNotificationBridge({
      notifications: {
        async getLastNotificationResponseAsync() {
          return createResponse('notification-1', {
            intent: 'approval',
            approvalId: 'approval-agenthub',
            runId: 'run-agenthub',
            threadId: 'thread-delicious233',
          });
        },
      },
      onNavigate,
    });

    expect(onNavigate).toHaveBeenCalledWith({
      screen: 'tasks',
      source: 'approval',
      approvalId: 'approval-agenthub',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });
  });

  it('routes listener responses and removes the native subscription on stop', async () => {
    let listener: ((response: NotificationResponseLike) => void) | undefined;
    const remove = vi.fn();
    const onNavigate = vi.fn();
    const bridge = await startAgentHubNotificationBridge({
      notifications: {
        addNotificationResponseReceivedListener(nextListener) {
          listener = nextListener;
          return { remove };
        },
      },
      onNavigate,
    });

    listener?.(createResponse('notification-2', {
      intent: 'run',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    }));
    bridge.stop();

    expect(onNavigate).toHaveBeenCalledWith({
      screen: 'tasks',
      source: 'run',
      runId: 'run-agenthub',
      threadId: 'thread-delicious233',
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it('deduplicates the initial response when native listener replays the same notification', async () => {
    let listener: ((response: NotificationResponseLike) => void) | undefined;
    const onNavigate = vi.fn();
    const response = createResponse('notification-3', {
      intent: 'thread',
      threadId: 'thread-delicious233',
    });

    await startAgentHubNotificationBridge({
      notifications: {
        async getLastNotificationResponseAsync() {
          return response;
        },
        addNotificationResponseReceivedListener(nextListener) {
          listener = nextListener;
          return { remove: vi.fn() };
        },
      },
      onNavigate,
    });
    listener?.(response);

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith({
      screen: 'thread',
      threadId: 'thread-delicious233',
    });
  });

  it('reports ignored and malformed notification payloads without exposing raw data', async () => {
    let listener: ((response: NotificationResponseLike) => void) | undefined;
    const onIgnored = vi.fn();
    const onError = vi.fn();

    await startAgentHubNotificationBridge({
      notifications: {
        addNotificationResponseReceivedListener(nextListener) {
          listener = nextListener;
          return { remove: vi.fn() };
        },
      },
      onError,
      onIgnored,
    });
    listener?.(createResponse('notification-4', { intent: 'tokendance-status' }));
    listener?.(createResponse('notification-5', { intent: 'run' }));

    expect(onIgnored).toHaveBeenCalledWith('unknown_intent');
    expect(onError).toHaveBeenCalledWith('missing_run_id');
    expect(onError).not.toHaveBeenCalledWith(expect.stringContaining('tokendance-status'));
  });

  it('configures a native Android review notification channel without user data', async () => {
    const setNotificationChannelAsync = vi.fn(async () => undefined);

    await configureAgentHubAndroidNotificationChannel({
      AndroidImportance: {
        DEFAULT: 'default',
        HIGH: 'high',
      },
      setNotificationChannelAsync,
    });

    expect(setNotificationChannelAsync).toHaveBeenCalledWith('agenthub-review', {
      name: 'AgentHub review',
      importance: 'high',
      vibrationPattern: [0, 180, 120, 180],
      lightColor: '#0071BC',
    });
    expect(JSON.stringify(setNotificationChannelAsync.mock.calls)).not.toContain('Delicious233');
  });
});
