import { describe, expect, it } from 'vitest';
import {
  appendHubRuntimeEvent,
  resolveWebWorkbenchTranscript,
} from './useWebWorkbenchModel';
import { webTranscript } from './webPlatform';

describe('useWebWorkbenchModel helpers', () => {
  it('combines Hub messages with live runtime transcript blocks', () => {
    const transcript = resolveWebWorkbenchTranscript(
      true,
      'hub-session-1',
      [
        {
          id: 'message-1',
          session_id: 'hub-session-1',
          sender_type: 'user',
          sender_id: 'user-1',
          content_type: 'text',
          content: '开始执行',
          created_at: '2026-06-07T05:00:00Z',
        },
      ],
      [
        {
          id: 'evt-runtime-1',
          task_id: 'task-1',
          edge_run_id: 'run-1',
          session_id: 'hub-session-1',
          event_seq: 1,
          event_type: 'run.agent.text_block',
          payload: { content: '运行中输出' },
          created_at: '2026-06-07T05:00:01Z',
        },
      ],
    );

    expect(transcript).toEqual([
      expect.objectContaining({
        id: 'hub-message-message-1',
        kind: 'text',
        text: '开始执行',
      }),
      expect.objectContaining({
        id: 'edge-event-hub-runtime-evt-runtime-1',
        kind: 'text',
        text: '运行中输出',
        evidenceRefs: [
          { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'running' },
        ],
      }),
    ]);
  });

  it('uses preview and Hub empty transcripts for unauthenticated and empty Hub states', () => {
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [])).toBe(webTranscript);
    expect(resolveWebWorkbenchTranscript(true, null, undefined, [])[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
    expect(resolveWebWorkbenchTranscript(false, null, undefined, [], 'real')[0]).toEqual(expect.objectContaining({
      id: 'web-hub-empty',
      text: 'Hub session 已连接，暂无可显示会话。',
    }));
  });

  it('deduplicates live Hub runtime events by id and limits retained events', () => {
    const first = appendHubRuntimeEvent([], {
      id: 'evt-1',
      event_type: 'run.agent.text_delta',
      payload: { content: 'a' },
    });
    const replaced = appendHubRuntimeEvent(first, {
      id: 'evt-1',
      event_type: 'run.agent.text_delta',
      payload: { content: 'b' },
    });
    const limited = appendHubRuntimeEvent([
      { id: 'evt-1', event_type: 'run.agent.text_delta' },
      { id: 'evt-2', event_type: 'run.agent.text_delta' },
    ], { id: 'evt-3', event_type: 'run.agent.text_delta' }, 2);

    expect(replaced).toEqual([
      { id: 'evt-1', event_type: 'run.agent.text_delta', payload: { content: 'b' } },
    ]);
    expect(limited.map((event) => event.id)).toEqual(['evt-2', 'evt-3']);
  });
});
