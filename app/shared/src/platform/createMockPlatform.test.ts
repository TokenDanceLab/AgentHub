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
      mentions: [{ id: 'builder', label: 'Builder' }],
      attachments: [],
      approvalMode: 'workspace-write',
    });

    expect(result.intentId).toMatch(/^mock-intent-/);
    expect(platform.submittedIntents).toEqual([
      expect.objectContaining({
        conversationId: 'team',
        mode: 'code',
        mentions: [{ id: 'builder', label: 'Builder' }],
      }),
    ]);
  });

  it('can expose a mock attachment picker port', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      pickFiles: async () => [{
        id: 'desktop-1',
        name: 'notes.md',
        source: 'desktop',
        path: 'D:\\Code\\TokenDance\\AgentHub\\notes.md',
      }],
    });

    await expect(platform.attachments?.pickFiles()).resolves.toEqual([
      expect.objectContaining({
        name: 'notes.md',
        source: 'desktop',
      }),
    ]);
  });

  it('accepts mobile as a first-class platform surface', () => {
    const platform = createMockPlatform({
      surface: 'mobile',
      capabilities: { localEdge: false, localFiles: true, browserPreview: false },
    });

    expect(platform.surface).toBe('mobile');
    expect(platform.capabilities.localEdge).toBe(false);
  });

  it('defaults localTerminal to false and omits the terminal port on web mocks', () => {
    const platform = createMockPlatform({ surface: 'web' });

    expect(platform.capabilities.localTerminal).toBe(false);
    expect(platform.terminal).toBeUndefined();
  });

  it('attaches a mock terminal port when localTerminal is explicitly enabled', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: {
        localEdge: true,
        localFiles: true,
        browserPreview: true,
        localTerminal: true,
      },
    });

    expect(platform.capabilities.localTerminal).toBe(true);
    expect(platform.terminal).toBeDefined();

    const session = await platform.terminal!.spawn({ title: 'Desktop shell', cols: 120, rows: 40 });
    expect(session.title).toBe('Desktop shell');
    await expect(platform.terminal!.list()).resolves.toEqual([
      expect.objectContaining({ id: session.id, status: 'running' }),
    ]);

    await platform.terminal!.write({ sessionId: session.id, data: 'echo hi\n' });
    await platform.terminal!.resize({ sessionId: session.id, cols: 100, rows: 30 });
    await platform.terminal!.close(session.id);
    await expect(platform.terminal!.list()).resolves.toEqual([
      expect.objectContaining({ id: session.id, status: 'exited', cols: 100, rows: 30 }),
    ]);
  });
});
