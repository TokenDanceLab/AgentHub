import { describe, expect, it } from 'vitest';
import { createMockPlatform } from './createMockPlatform';

describe('createMockPlatform', () => {
  it('exposes surface capabilities and conversations through ports', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { localEdge: true, localFiles: true, browserPreview: false },
      conversations: [
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' },
        { id: 'team', title: 'Agent 协作群', kind: 'group', unreadCount: 3 },
      ],
    });

    await expect(platform.conversations.list()).resolves.toHaveLength(2);
    expect(platform.surface).toBe('desktop');
    expect(platform.capabilities.localEdge).toBe(true);
    expect(platform.capabilities.browserPreview).toBe(false);
  });

  it('records submitted composer intents for adapter verification', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    const result = await platform.runs.submitComposerIntent({
      conversationId: 'team',
      text: '重构 shared workbench',
      mode: 'code',
      mentions: ['builder'],
      attachments: [],
      approvalMode: 'workspace-write',
    });

    expect(result.intentId).toMatch(/^mock-intent-/);
    expect(platform.submittedIntents).toEqual([
      expect.objectContaining({ conversationId: 'team', mode: 'code', mentions: ['builder'] }),
    ]);
  });
});
