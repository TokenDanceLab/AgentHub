import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@/components/ChatView.types';
import { buildWorkspaceShareText, type WorkspaceShareLabels } from '@/utils/workspaceShare';

const labels: WorkspaceShareLabels = {
  thread: 'Thread',
  agent: 'Agent',
  run: 'Run',
  status: 'Status',
  messages: 'Recent messages',
  noMessages: 'No messages',
  user: 'User',
  assistant: 'Agent',
  system: 'System',
  tool: 'Tool',
  file: 'File',
  code: 'Code block omitted',
  fileCreated: 'created',
  fileModified: 'modified',
  fileDeleted: 'deleted',
};

function message(id: string, role: ChatMessage['role'], content: string, agentName?: string): ChatMessage {
  return {
    id,
    role,
    timestamp: '2026-05-26T00:00:00.000Z',
    agentName,
    blocks: [{ kind: 'text', content }],
  };
}

describe('buildWorkspaceShareText', () => {
  it('includes thread, agent, run, and recent messages', () => {
    const text = buildWorkspaceShareText({
      title: 'Build room',
      thread: { id: 'thread-1', title: 'API work' },
      agent: { id: 'codex', name: 'Codex' },
      run: { id: 'run-1', status: 'Running' },
      messages: [
        message('m1', 'user', 'Implement the endpoint'),
        message('m2', 'agent', 'I will update the client surface.', 'Codex'),
        {
          id: 'm3',
          role: 'agent',
          timestamp: '2026-05-26T00:01:00.000Z',
          blocks: [{ kind: 'file_change', action: 'modified', path: 'app/desktop/src/App.tsx' }],
        },
      ],
      labels,
    });

    expect(text).toContain('AgentHub: Build room');
    expect(text).toContain('Thread: API work (thread-1)');
    expect(text).toContain('Agent: Codex (codex)');
    expect(text).toContain('Run: run-1');
    expect(text).toContain('Status: Running');
    expect(text).toContain('- User: Implement the endpoint');
    expect(text).toContain('- Codex: I will update the client surface.');
    expect(text).toContain('- Agent: File: modified app/desktop/src/App.tsx');
  });

  it('omits sensitive internal blocks from the shared summary', () => {
    const text = buildWorkspaceShareText({
      title: 'Sensitive room',
      messages: [
        {
          id: 'system-1',
          role: 'system',
          timestamp: '2026-05-26T00:00:00.000Z',
          blocks: [{ kind: 'text', content: 'hidden system instruction' }],
        },
        {
          id: 'agent-1',
          role: 'agent',
          timestamp: '2026-05-26T00:01:00.000Z',
          blocks: [
            { kind: 'thinking', content: 'private chain of thought' },
            { kind: 'code', language: 'bash', content: 'TOKEN=secret-value' },
            { kind: 'result', success: false, error: 'raw secret error' },
          ],
        },
        {
          id: 'agent-2',
          role: 'agent',
          timestamp: '2026-05-26T00:02:00.000Z',
          blocks: [{ kind: 'file_change', action: 'modified', path: 'C:\\Users\\Xavier\\secret\\notes.md' }],
        },
      ],
      labels,
    });

    expect(text).not.toContain('hidden system instruction');
    expect(text).not.toContain('private chain of thought');
    expect(text).not.toContain('TOKEN=secret-value');
    expect(text).not.toContain('raw secret error');
    expect(text).not.toContain('C:\\Users\\Xavier\\secret');
    expect(text).toContain('Code block omitted');
    expect(text).toContain('File: modified notes.md');
  });

  it('limits the shared summary to the most recent messages', () => {
    const text = buildWorkspaceShareText({
      title: 'Long room',
      messages: Array.from({ length: 8 }, (_, index) => message(`m${index}`, 'user', `message ${index}`)),
      labels,
    });

    expect(text).not.toContain('message 0');
    expect(text).not.toContain('message 1');
    expect(text).toContain('message 2');
    expect(text).toContain('message 7');
  });

  it('labels empty workspaces clearly', () => {
    const text = buildWorkspaceShareText({
      title: 'AgentHub',
      messages: [],
      labels,
    });

    expect(text).toContain('Recent messages:');
    expect(text).toContain('- No messages');
  });
});
