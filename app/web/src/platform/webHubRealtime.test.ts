import { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { describe, expect, it, vi } from 'vitest';
import { invalidateWebWorkbenchHubQueries } from './webHubRealtime';

describe('webHubRealtime', () => {
  it('invalidates Hub sessions and the active session messages for message events', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.MESSAGE_NEW, {
      session_id: 'hub-session-1',
      message_id: 'message-1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-sessions'] });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['web-v4', 'hub-messages', 'hub-session-1'],
    });
  });

  it('reads nested message session ids from Hub event payloads', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.MESSAGE_RECALL, {
      message: { session_id: 'hub-session-nested', message_id: 'message-2' },
    });

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['web-v4', 'hub-messages', 'hub-session-nested'],
    });
  });

  it('invalidates all Hub messages when agent task events omit a session id', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      result_summary: 'done',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-sessions'] });
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'hub-messages'] });
  });

  it('ignores unrelated Hub events', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.DEVICE_ONLINE, {
      device_id: 'desktop-1',
    });

    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
