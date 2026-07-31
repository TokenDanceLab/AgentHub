import { describe, expect, it } from 'vitest';
import {
  resolveWebTaskContractStatusBlocks,
  resolveWebWorkbenchTranscript,
} from './webWorkbenchTranscript';

describe('webWorkbenchTranscript', () => {
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
