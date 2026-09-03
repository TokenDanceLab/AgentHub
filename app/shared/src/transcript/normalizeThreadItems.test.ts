import { describe, expect, it } from 'vitest';
import { normalizeThreadItemsToTranscript } from './normalizeThreadItems';

describe('normalizeThreadItemsToTranscript', () => {
  it('drops persisted runtime diagnostics that are not conversational content', () => {
    const blocks = normalizeThreadItemsToTranscript([
      {
        itemId: 'diag-1',
        threadId: 'thread-1',
        type: 'agent_message',
        role: 'assistant',
        content: 'Warning: no stdin data received in 3s, proceeding without it. If piping from a slow command, redirect stdin explicitly: < /dev/null to skip, or wait longer.',
        runId: 'run-1',
        createdAt: '2026-06-07T01:00:02Z',
      },
    ]);

    expect(blocks).toEqual([]);
  });

  it('projects persisted thread messages into transcript blocks', () => {
    const blocks = normalizeThreadItemsToTranscript([
      {
        itemId: 'agent-1',
        threadId: 'thread-1',
        type: 'agent_message',
        role: 'assistant',
        content: '我会读取项目结构。',
        runId: 'run-1',
        createdAt: '2026-06-07T01:00:02Z',
      },
      {
        itemId: 'user-1',
        threadId: 'thread-1',
        type: 'user_message',
        role: 'user',
        content: '接入 v4 UI',
        createdAt: '2026-06-07T01:00:01Z',
      },
    ]);

    expect(blocks).toEqual([
      expect.objectContaining({
        id: 'thread-item-user-1',
        kind: 'text',
        author: { id: 'user', name: '用户', role: 'human' },
        text: '接入 v4 UI',
      }),
      expect.objectContaining({
        id: 'thread-item-agent-1',
        kind: 'text',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        text: '我会读取项目结构。',
        evidenceRefs: [
          { id: 'run-run-1', kind: 'run', label: 'Run run-1', status: 'completed' },
        ],
      }),
    ]);
  });

  it('normalizes diff and approval items without leaking empty content', () => {
    const blocks = normalizeThreadItemsToTranscript([
      { itemId: 'empty', type: 'message', role: 'agent', content: '   ', createdAt: 'bad-date' },
      {
        itemId: 'diff-1',
        type: 'diff',
        role: 'agent',
        content: 'app/desktop/src/App.tsx\napp/workbench/src/AgentHubWorkbench.tsx',
        runId: 'run-2',
        createdAt: '2026-06-07T02:00:00Z',
      },
      {
        itemId: 'approval-1',
        type: 'approval',
        role: 'agent',
        status: 'pending',
        content: '需要审批写入 docs/roadmap.md',
        createdAt: '2026-06-07T02:00:01Z',
      },
    ]);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual(expect.objectContaining({
      kind: 'diff',
      title: 'app/desktop/src/App.tsx',
      files: ['app/desktop/src/App.tsx', 'app/workbench/src/AgentHubWorkbench.tsx'],
    }));
    expect(blocks[1]).toEqual(expect.objectContaining({
      kind: 'approval',
      title: '需要审批写入 docs/roadmap.md',
      status: 'pending',
    }));
  });
});
