import { describe, expect, it } from 'vitest';
import type { FileDiff, MessageBlock, ReplyTarget } from './chat';

describe('legacy chat compatibility types', () => {
  it('accepts old ChatView block kinds during v4 migration', () => {
    const blocks: MessageBlock[] = [
      { kind: 'thinking', content: 'Checking workspace', durationMs: 120 },
      {
        kind: 'tool_use',
        callId: 'tool-1',
        toolName: 'read_file',
        input: { path: 'README.md' },
        status: 'draining',
        children: [{ kind: 'read_result', filePath: 'README.md', lineCount: 12 }],
      },
      { kind: 'agent_task', taskId: 'task-1', title: 'Review diff', status: 'running' },
      { kind: 'child_agent', childId: 'child-1', title: 'Reviewer', status: 'completed' },
      { kind: 'route_decision', action: 'delegate', nextWorker: 'reviewer' },
      { kind: 'context_usage', input: 10, output: 20, total: 30 },
      { kind: 'approval', approvalId: 'approval-1', status: 'pending' },
      { kind: 'artifact', artifactId: 'artifact-1', artifactType: 'file', title: 'Patch' },
      { kind: 'deploy_card', status: 'deployed', url: 'https://example.test' },
      { kind: 'link_card', url: 'https://example.test', title: 'Example' },
      { kind: 'error', message: 'Model quota exceeded', retryable: false },
      { kind: 'citation', title: 'Docs', url: 'https://example.test/docs' },
      { kind: 'compact', summary: 'Compacted context' },
      { kind: 'status', content: 'Queued' },
    ];

    expect(blocks.map((block) => block.kind)).toContain('tool_use');
    expect(blocks.map((block) => block.kind)).toContain('context_usage');
  });

  it('keeps reply and untracked diff shapes available to old components', () => {
    const reply: ReplyTarget = {
      messageId: 'msg-1',
      author: 'Reviewer',
      preview: 'Looks good',
    };
    const diff: FileDiff = {
      filePath: 'new-file.ts',
      status: 'untracked',
      additions: 3,
      deletions: 0,
      hunks: [{ header: '@@ -0,0 +1,3 @@', lines: [] }],
    };

    expect(reply.author).toBe('Reviewer');
    expect(diff.status).toBe('untracked');
  });
});
