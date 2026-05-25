import { describe, expect, it } from 'vitest';
import { hubMessageToChatMessage } from './hubAdapters';

describe('hubMessageToChatMessage runtime payloads', () => {
  it('renders bridged tool calls as tool blocks instead of JSON text', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-tool',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({
        callId: 'call-1',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        status: 'running',
      }),
    });

    expect(message.blocks).toEqual([
      {
        kind: 'tool_use',
        callId: 'call-1',
        toolName: 'Bash',
        input: { command: 'pnpm test' },
        status: 'running',
        children: [],
      },
    ]);
  });

  it('renders bridged file changes as file change blocks', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-file',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({
        path: 'src/App.tsx',
        action: 'modified',
        diff: '@@ -1 +1 @@',
      }),
    });

    expect(message.blocks).toEqual([
      {
        kind: 'file_change',
        path: 'src/App.tsx',
        action: 'modified',
        diff: '@@ -1 +1 @@',
      },
    ]);
  });

  it('keeps plain text JSON content readable when it is not a runtime payload', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-text',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({ content: 'plain answer from agent' }),
    });

    expect(message.blocks).toEqual([{ kind: 'text', content: 'plain answer from agent' }]);
  });

  it('does not treat generic JSON id fields as tool call ids', () => {
    const message = hubMessageToChatMessage({
      id: 'msg-json',
      session_id: 'sess-1',
      sender_type: 'agent',
      content_type: 'text',
      content: JSON.stringify({ id: 'ordinary-record', content: 'not a tool result' }),
    });

    expect(message.blocks).toEqual([{ kind: 'text', content: 'not a tool result' }]);
  });
});
