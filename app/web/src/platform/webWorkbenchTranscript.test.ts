import { describe, expect, it } from 'vitest';
import {
  resolveWebTaskContractStatusBlocks,
  resolveWebWorkbenchTranscript,
} from './webWorkbenchTranscript';

describe('webWorkbenchTranscript', () => {
  it('shows live text exactly once and replaces it only with the confirmed final of that task', () => {
    const chunks = ['  first\n', '\n', 'tail  '];
    const events = chunks.map((content, index) => ({
      id: `event-${index}`, task_id: 'task-1', edge_run_id: 'run-1', agent_instance_id: 'agent-1',
      session_id: 'session-1', event_seq: index + 1, event_type: 'run.agent.text_delta', payload: { content },
    }));
    const text = chunks.join('');
    const live = resolveWebWorkbenchTranscript(true, 'session-1', [], events, 'approved-real');
    expect(live.filter((block) => block.kind === 'text')).toEqual([
      expect.objectContaining({ text }),
    ]);
    const final = {
      id: 'final-1', session_id: 'session-1', sender_type: 'agent', sender_id: 'agent-1',
      content_type: 'text', content: { content: text, agent_task: { task_id: 'task-1', status: 'done' } },
    };
    const settled = resolveWebWorkbenchTranscript(true, 'session-1', [final], events, 'approved-real');
    expect(settled.filter((block) => block.kind === 'text')).toEqual([
      expect.objectContaining({ text, agentTaskId: 'task-1' }),
    ]);
    const nextEvents = [...events, { ...events[0]!, id: 'next', task_id: 'task-2', edge_run_id: 'run-2', payload: { content: 'next turn' } }];
    const next = resolveWebWorkbenchTranscript(true, 'session-1', [final], nextEvents, 'approved-real');
    expect(next.filter((block) => block.kind === 'text').map((block) => block.text)).toEqual(expect.arrayContaining([text, 'next turn']));
  });
  it('returns empty status blocks without a task id', () => {
    expect(resolveWebTaskContractStatusBlocks(undefined, new Error('x'), new Error('y'))).toEqual([]);
  });

  it('surfaces approval and artifact contract errors for an active task', () => {
    const blocks = resolveWebTaskContractStatusBlocks(
      'task-1',
      new Error('approvals down'),
      new Error('artifacts down'),
    );
    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'web-hub-taskctr-approvals-task-1',
        text: expect.stringContaining('approvals down'),
        badgeVariant: 'danger',
      }),
      expect.objectContaining({
        id: 'web-hub-taskctr-artifacts-task-1',
        text: expect.stringContaining('artifacts down'),
        badgeVariant: 'danger',
      }),
    ]);
  });

  it('returns demo transcript when hub is not ready and mode is fixture', () => {
    const blocks = resolveWebWorkbenchTranscript(false, null, undefined, [], 'fixture');
    expect(blocks.length).toBeGreaterThan(0);
  });

  it('passes the injected translator through to hub message normalization', () => {
    const blocks = resolveWebWorkbenchTranscript(
      true,
      'hub-session-1',
      [
        {
          session_id: 'hub-session-1',
          seq_id: 1,
          sender_type: 'system',
          recalled: true,
          content: 'hidden',
        },
      ],
      [],
      'approved-real',
      undefined,
      (key: string) => (key === 'message.recalled' ? 'Message recalled' : key),
    );

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'hub-message-hub-session-1-1',
        kind: 'text',
        text: 'Message recalled',
      }),
    ]);
  });
});
