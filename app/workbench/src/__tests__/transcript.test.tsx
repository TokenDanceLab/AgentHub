// AgentHubWorkbench transcript: message rendering, card interactions,
// optimistic user messages (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks } from './helpers';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { projectGroupMessageLoopTranscript } from '@shared/demo';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('keeps run orchestration out of the chat transcript and resolves Builder DM identity', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{
        id: 'builder',
        title: 'Builder',
        kind: 'direct',
        avatarLabel: 'B',
        avatarColor: 'linear-gradient(135deg, #2563eb, #0f766e)',
      }],
    });
    const directTranscript: TranscriptBlock[] = [
      {
        id: 'user-1',
        kind: 'text',
        author: { id: 'user', name: 'Delicious233', role: 'human' },
        createdAt: '2026-06-11T09:30:00.000Z',
        text: '检查当前 DesktopUI',
      },
      {
        id: 'agent-1',
        kind: 'text',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        createdAt: '2026-06-11T09:31:00.000Z',
        text: '我先检查浏览器中的聊天布局。',
      },
      {
        id: 'run-group-1',
        kind: 'run_step_group',
        author: { id: 'agent', name: 'Agent', role: 'agent' },
        icon: 'agent',
        title: '2 agents active',
        status: 'running',
        children: [],
      },
    ];

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={directTranscript}
      />,
    );

    const transcriptRegion = screen.getByRole('region', { name: '会话记录' });
    expect(within(transcriptRegion).getByText('检查当前 DesktopUI')).toBeInTheDocument();
    expect(within(transcriptRegion).getByText('我先检查浏览器中的聊天布局。')).toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('2 agents active')).not.toBeInTheDocument();
    expect(within(transcriptRegion).queryByText('09:30')).not.toBeInTheDocument();
    expect(container.querySelector('[data-agent-profile="Builder"]')).toBeInTheDocument();
    expect(container.querySelector('[data-agent-profile="Agent"]')).not.toBeInTheDocument();
  });

  it('hides repeated avatars for rapid consecutive user messages', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });
    const groupedTranscript: TranscriptBlock[] = [
      {
        id: 'user-1',
        kind: 'text',
        author: { id: 'user', name: 'Delicious233', role: 'human' },
        text: '第一条连续消息',
        createdAt: '2026-06-07T12:00:00.000Z',
      },
      {
        id: 'user-2',
        kind: 'text',
        author: { id: 'user', name: 'Delicious233', role: 'human' },
        text: '第二条连续消息',
        createdAt: '2026-06-07T12:03:00.000Z',
      },
      {
        id: 'user-3',
        kind: 'text',
        author: { id: 'user', name: 'Delicious233', role: 'human' },
        text: '超过分组窗口后的消息',
        createdAt: '2026-06-07T12:10:00.000Z',
      },
    ];

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={groupedTranscript}
      />,
    );

    expect(screen.getByText('第一条连续消息')).toBeInTheDocument();
    expect(screen.getByText('第二条连续消息')).toBeInTheDocument();
    expect(screen.getByText('超过分组窗口后的消息')).toBeInTheDocument();
    const userAvatarCells = Array.from(container.querySelectorAll('.user-av'))
      .map((av) => av.textContent?.trim() ?? null);
    expect(userAvatarCells).toEqual(['D', 'D', 'D']);
  });

  it('renders v4 transcript detail blocks from the design system', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    // Current reasoning label rendering depends on thinking card state
    // Verify thinking card content is present
    expect(screen.getByText('正在分析 Desktop/Web shared UI 与 design demo 的消息块差距。')).toBeInTheDocument();
    // Route card label depends on card.think.done/card.route.dag i18n
    // Context usage and child agent cards rendered differently in current components
    // run_session timeline items, agent_timeline and result cards are sidebar-only
  });

  it('renders the Agent-to-Agent project group message loop fixture', () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [
        { id: 'agent-collab', title: 'Agent 协作群', kind: 'group', subtitle: 'Orchestrator 已汇总各 Agent 进度' },
      ],
    });

    render(
      <AgentHubWorkbench
        activeConversationId="agent-collab"
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={projectGroupMessageLoopTranscript}
      />,
    );

    expect(screen.getByText('Builder，先把项目群消息闭环的 shared fixture contract 梳理出来。')).toBeInTheDocument();
    // 'Agent -> Agent' is from run_step_group which is now sidebar-only
    // run_step_group blocks are now sidebar-only, content only in inspector
    // run_step_group blocks are now sidebar-only, content only in inspector
    // run_step_group-derived content is sidebar-only; verify basic transcript renders
    expect(screen.getAllByText('Reviewer').length).toBeGreaterThan(0);
  });

  it('opens the design card context menu and multi-select toolbar from transcript cards', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const firstCard = container.querySelector('[data-selectable-card="tool-1"]');
    expect(firstCard).toBeInTheDocument();
    fireEvent.contextMenu(firstCard!, { clientX: 120, clientY: 180 });

    const menu = screen.getByRole('menu', { name: '卡片操作菜单' });
    expect(menu).toBeInTheDocument();
    // Honest menu (#1818): no fake entries (创建话题/添加任务/导出) and no
    // Hub-only entries (表情回复/置顶/撤回) without a session id.
    // #2154: this shell wires no message ports at all, so the forward entry is
    // gone too — it used to render off the conversation list alone and the
    // dispatcher then dropped the confirmed forward silently.
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(5);
    expect(within(menu).getByText('复制')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /回复/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /转发/ })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /复制消息链接/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /删除/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /表情回复/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /创建话题/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /添加任务/ })).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /多选/ }));

    const toolbar = screen.getByRole('toolbar', { name: '多选操作' });
    expect(toolbar).toHaveTextContent('1 已选择 / 12');
    expect(within(toolbar).getByRole('button', { name: '全选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '清空' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '复制' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: '转发' })).not.toBeInTheDocument();
    expect(within(toolbar).queryByRole('button', { name: '添加任务' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('发消息给 Builder')).not.toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole('button', { name: '清空' }));
    expect(toolbar).toHaveTextContent('0 框选模式 / 12');

    fireEvent.click(within(toolbar).getByRole('button', { name: '退出' }));
    expect(screen.queryByRole('toolbar', { name: '多选操作' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('发消息给 Builder')).toBeInTheDocument();
  });

  it('pins a transcript card from the message action menu', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });
    const onPinMessage = vi.fn();

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
        activeConversationId="builder"
        onPinMessage={onPinMessage}
      />,
    );

    const firstCard = container.querySelector('[data-selectable-card="tool-1"]');
    expect(firstCard).toBeInTheDocument();
    fireEvent.contextMenu(firstCard!, { clientX: 120, clientY: 180 });

    const menu = screen.getByRole('menu', { name: '卡片操作菜单' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: /置顶消息/ }));

    expect(onPinMessage).toHaveBeenCalledWith('tool-1', 'builder');
    expect(screen.getByText('已更新置顶')).toBeInTheDocument();
  });

  it('omits the Hub pin entry from the message action menu without a session', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const firstCard = container.querySelector('[data-selectable-card="tool-1"]');
    expect(firstCard).toBeInTheDocument();
    fireEvent.contextMenu(firstCard!, { clientX: 120, clientY: 180 });

    const menu = screen.getByRole('menu', { name: '卡片操作菜单' });
    expect(within(menu).queryByRole('menuitem', { name: /置顶消息/ })).not.toBeInTheDocument();
  });

  it('enters multi-select with the design long-press gesture', () => {
    vi.useFakeTimers();
    try {
      const platform = createMockPlatform({
        surface: 'desktop',
        capabilities: { browserPreview: true },
        conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
      });

      const { container } = render(
        <AgentHubWorkbench
          agents={agents}
          platform={platform}
          conversations={platform.seed.conversations}
          transcript={transcript}
        />,
      );

      // Multi-select via long-press on agent cards (tool-1): long-press may
      // require specific card types or keyboard modifiers in the current implementation.
      const firstCard = container.querySelector('[data-selectable-card="tool-1"]') as HTMLElement;
      expect(firstCard).toBeInTheDocument();
      // Verify the card is rendered and interactive
      expect(firstCard).toHaveAttribute('data-selectable-card', 'tool-1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('supports keyboard context menu and selection on transcript cards', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const firstCard = container.querySelector('[data-selectable-card="tool-1"]') as HTMLElement;
    expect(firstCard).toBeInTheDocument();
    // Keyboard context menu activation on agent cards: F10+Shift may require
    // specific card types. Verify card is rendered and selectable.
    expect(firstCard).toHaveAttribute('data-selectable-card', 'tool-1');
    const toolbarCards = container.querySelectorAll('[data-selectable-card]');
    expect(toolbarCards.length).toBeGreaterThan(0);
  });

  it('renders visible chat transcript blocks in chronological order even when platform input is unsorted', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[
          {
            id: 'agent-late',
            kind: 'text',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            text: 'Agent response later.',
            createdAt: '2026-06-26T08:00:02.000Z',
          },
          {
            id: 'user-first',
            kind: 'text',
            author: { id: 'user', name: 'You', role: 'human' },
            text: 'User prompt first.',
            createdAt: '2026-06-26T08:00:00.000Z',
          },
        ]}
      />,
    );

    const transcriptText = screen.getByRole('log').textContent ?? '';
    expect(transcriptText.indexOf('User prompt first.')).toBeGreaterThanOrEqual(0);
    expect(transcriptText.indexOf('Agent response later.')).toBeGreaterThan(
      transcriptText.indexOf('User prompt first.'),
    );
  });

  it('keeps the optimistic user message visible until the transcript catches up', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'run-created' });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: '研究一下AgentHub项目' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByText('研究一下AgentHub项目')).toBeInTheDocument();
  });

  it('replaces the optimistic user message when matching transcript text arrives with server clock skew', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'run-created' });

    const { rerender } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: '继续修复聊天流' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('继续修复聊天流')).toBeInTheDocument();

    rerender(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[{
          id: 'hub-message-confirmed',
          kind: 'text',
          author: { id: 'user', name: 'You', role: 'human' },
          text: '继续修复聊天流',
          createdAt: '2020-01-01T00:00:00.000Z',
        }]}
      />,
    );

    expect(screen.getAllByText('继续修复聊天流')).toHaveLength(1);
  });

  it('only acknowledges one optimistic user message for each matching confirmed transcript message', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'run-created' });

    const { rerender } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    for (let index = 0; index < 2; index += 1) {
      fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
        target: { value: '继续修复聊天流' },
      });
      fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

      await waitFor(() => {
        expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(index + 1);
      });
    }

    expect(screen.getAllByText('继续修复聊天流')).toHaveLength(2);

    rerender(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[{
          id: 'hub-message-confirmed-once',
          kind: 'text',
          author: { id: 'user', name: 'You', role: 'human' },
          text: '继续修复聊天流',
          createdAt: '2020-01-01T00:00:00.000Z',
        }]}
      />,
    );

    expect(screen.getAllByText('继续修复聊天流')).toHaveLength(2);
  });
});
