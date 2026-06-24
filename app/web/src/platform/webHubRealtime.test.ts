import { QueryClient } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { describe, expect, it, vi } from 'vitest';
import { dispatchHubRuntimeEvent, invalidateWebWorkbenchHubQueries } from './webHubRealtime';

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

  it('updates the Hub task index when agent lifecycle events arrive', () => {
    const queryClient = new QueryClient();

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-1',
      session_id: 'hub-session-1',
      edge_run_id: 'edge-run-1',
      result_summary: 'done',
    });

    expect(queryClient.getQueryData(['web-v4', 'agent-task-index', 'task-1'])).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      edgeRunId: 'edge-run-1',
      status: 'completed',
    });
    expect(queryClient.getQueryData(['web-v4', 'active-agent-task', 'hub-session-1'])).toEqual({
      taskId: 'task-1',
      sessionId: 'hub-session-1',
      edgeRunId: 'edge-run-1',
      status: 'completed',
    });
  });

  it('invalidates execution targets on device online events', () => {
    const queryClient = new QueryClient();
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries');

    invalidateWebWorkbenchHubQueries(queryClient, HUB_EVENTS.DEVICE_ONLINE, {
      device_id: 'desktop-1',
    });

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['web-v4', 'execution-targets'] });
  });

  it('dispatches matching Hub agent.stream runtime events to the live transcript handler', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_STREAM, {
      id: 'evt-live',
      task_id: 'task-live',
      edge_run_id: 'run-live',
      session_id: 'hub-session-1',
      agent_instance_id: 'agent-live',
      event_seq: 1,
      event_type: 'run.agent.text_block',
      payload: { content: 'live block' },
      created_at: '2026-06-07T05:00:00Z',
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      id: 'evt-live',
      task_id: 'task-live',
      edge_run_id: 'run-live',
      session_id: 'hub-session-1',
      agent_instance_id: 'agent-live',
      event_seq: 1,
      event_type: 'run.agent.text_block',
      payload: { content: 'live block' },
      created_at: '2026-06-07T05:00:00Z',
    });
  });

  it('does not dispatch runtime events for another Hub session', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_STREAM, {
      id: 'evt-other',
      session_id: 'hub-session-2',
      event_type: 'run.agent.text_block',
      payload: { content: 'other session' },
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).not.toHaveBeenCalled();
  });

  it('dispatches terminal Hub agent events into the runtime transcript', () => {
    const onRuntimeEvent = vi.fn();

    dispatchHubRuntimeEvent(HUB_EVENTS.AGENT_DONE, {
      task_id: 'task-terminal',
      edge_run_id: 'run-terminal',
      session_id: 'hub-session-1',
      result_summary: 'Tests passed',
      usage: { input_tokens: 10, output_tokens: 5 },
      created_at: '2026-06-07T05:00:02Z',
    }, 'hub-session-1', onRuntimeEvent);

    expect(onRuntimeEvent).toHaveBeenCalledWith({
      task_id: 'task-terminal',
      edge_run_id: 'run-terminal',
      session_id: 'hub-session-1',
      event_type: 'run.agent.result',
      payload: {
        content: 'Tests passed',
        success: true,
        usage: { input_tokens: 10, output_tokens: 5 },
      },
      created_at: '2026-06-07T05:00:02Z',
    });
  });
});
