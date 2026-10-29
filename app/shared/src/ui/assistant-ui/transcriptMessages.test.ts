import { describe, expect, it } from 'vitest';
import { transcriptMessages } from './transcriptMessages';
import type { TranscriptBlock } from '../../transcript';

const author = { id: 'agent', name: 'Builder', role: 'agent' as const };
describe('assistant-ui transcript projection', () => {
  it('pairs each tool result with its call and preserves chronological order', () => {
    const blocks: TranscriptBlock[] = [
      { id: 'result-b', kind: 'tool_result', callId: 'b', toolName: 'Read', status: 'completed', summary: 'B result', author, createdAt: '2026-01-01T00:00:04Z' },
      { id: 'call-a', kind: 'tool_call', callId: 'a', toolName: 'Read', status: 'running', author, createdAt: '2026-01-01T00:00:01Z' },
      { id: 'result-a', kind: 'tool_result', callId: 'a', toolName: 'Read', status: 'failed', summary: 'A failed', author, createdAt: '2026-01-01T00:00:03Z' },
      { id: 'call-b', kind: 'tool_call', callId: 'b', toolName: 'Read', status: 'running', author, createdAt: '2026-01-01T00:00:02Z' },
    ];
    const messages = transcriptMessages(blocks);
    expect(messages.map((message) => message.id)).toEqual(['call-a', 'call-b']);
    expect(messages[0]?.content).toEqual([expect.objectContaining({ toolCallId: 'a', result: 'A failed', isError: true })]);
    expect(messages[1]?.content).toEqual([expect.objectContaining({ toolCallId: 'b', result: 'B result', isError: false })]);
  });

  it('keeps distinct human messages with identical text and omits orchestration diagnostics', () => {
    const human = { id: 'person', name: 'Mira', role: 'human' as const };
    const messages = transcriptMessages([
      { id: 'first', kind: 'text', author: human, text: 'repeat' },
      { id: 'second', kind: 'text', author: human, text: 'repeat' },
      { id: 'route', kind: 'route_decision', author, action: 'internal route' },
    ]);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(['user', 'user']);
    expect(messages[0]?.metadata?.custom?.author).toEqual(human);
  });
});
