import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HubClient } from '@/api/hubClient';
import { useConnectionStore } from '@/stores/connectionStore';

import { replayMissedEvents } from './runEventReplay';

describe('run event replay', () => {
  beforeEach(() => {
    useConnectionStore.setState({
      lastEventSeq: {},
      recoveryState: 'idle',
      recoveryError: null,
    });
  });

  it('fills a reconnect gap through REST without a dead WS sync hint', async () => {
    useConnectionStore.getState().setLastEventSeq('task-1', 2);
    const listTaskRunEventsAfter = vi.fn().mockResolvedValue([
      {
        id: 'event-4',
        task_id: 'task-1',
        edge_run_id: 'run-1',
        session_id: 'session-1',
        agent_instance_id: 'agent-1',
        event_seq: 4,
        event_type: 'run.agent.text_delta',
        payload: { content: 'continued' },
        created_at: '2026-07-27T00:00:00Z',
      },
    ]);
    const onReplayEvents = vi.fn();

    const replayed = await replayMissedEvents({
      hubClient: { listTaskRunEventsAfter } as unknown as HubClient,
      getActiveTaskId: () => 'task-1',
      onReplayEvents,
    });

    expect(listTaskRunEventsAfter).toHaveBeenCalledOnce();
    expect(listTaskRunEventsAfter).toHaveBeenCalledWith('task-1', 2);
    expect(onReplayEvents).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'event-4',
          task_id: 'task-1',
          event_seq: 4,
          event_type: 'run.agent.text_delta',
        }),
      ],
      'task-1',
    );
    expect(replayed).toBe(1);
    expect(useConnectionStore.getState()).toMatchObject({
      lastEventSeq: { 'task-1': 4 },
      recoveryState: 'idle',
      recoveryError: null,
    });
  });
});
