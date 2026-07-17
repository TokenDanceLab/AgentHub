import { describe, expect, it } from 'vitest';
import {
  appendHubRuntimeEvent,
  mergeHubRuntimeEvents,
  mergeHubTaskContractEvents,
} from './webWorkbenchRuntimeEvents';

describe('webWorkbenchRuntimeEvents', () => {
  it('deduplicates events without id via content hash', () => {
    const first = appendHubRuntimeEvent([], {
      task_id: 'task-1',
      edge_run_id: 'run-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'same' },
    });
    const merged = appendHubRuntimeEvent(first, {
      task_id: 'task-1',
      edge_run_id: 'run-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'same' },
    });
    expect(merged).toHaveLength(1);

    const different = appendHubRuntimeEvent(merged, {
      task_id: 'task-1',
      edge_run_id: 'run-1',
      event_seq: 1,
      event_type: 'run.agent.text_delta',
      payload: { content: 'different' },
    });
    expect(different).toHaveLength(2);
  });

  it('keeps live events winning over replayed duplicates', () => {
    const merged = mergeHubRuntimeEvents(
      [{ id: 'evt-1', event_type: 'run.agent.text_block', payload: { content: 'old' } }],
      [{ id: 'evt-1', event_type: 'run.agent.text_block', payload: { content: 'new' } }],
    );
    expect(merged).toEqual([
      { id: 'evt-1', event_type: 'run.agent.text_block', payload: { content: 'new' } },
    ]);
  });

  it('maps decided approvals to permission_decided events', () => {
    const events = mergeHubTaskContractEvents([], {
      task_id: 'task-1',
      approvals: [{
        approval_id: 'approval-1',
        task_id: 'task-1',
        status: 'denied',
        tool_name: 'Bash',
        decided_by: 'user-1',
        decided_at: '2026-06-09T05:00:00Z',
      }],
      pending: [],
      decided: [],
      last_event_seq: 1,
    }, undefined);

    expect(events[0]).toMatchObject({
      event_type: 'run.agent.permission_decided',
      payload: {
        decision: 'deny',
        toolName: 'Bash',
        decidedBy: 'user-1',
      },
    });
  });
});
