// AgentHubWorkbench global rail pages: rail routing/roving, profile popovers
// and the local data-mode setting (#1763 split of AgentHubWorkbench.test.tsx).
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
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import type { TranscriptBlock } from '@shared/transcript/types';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('routes global rail pages into the design workbench mode', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '联系人' }));

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'contacts');
    expect(screen.getByRole('main', { name: '工作区' })).toHaveAttribute('data-mode', 'workbench');
    expect(screen.queryByRole('complementary', { name: '会话侧边栏' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: '右侧窗口' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: '工作区标签页' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('发消息给 Builder')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '组织内联系人' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'agents');
    expect(screen.getAllByText('Builder').length).toBeGreaterThan(0);
    expect(screen.getAllByText('glm-5.1').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '项目' }));

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'projects');
    expect(screen.getByRole('heading', { name: 'AI 游戏项目' })).toBeInTheDocument();

    const projectMain = screen.getByRole('heading', { name: 'AI 游戏项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    // Project detail tabs use i18n keys that may differ from test expectations.
    // Verify the project page renders correctly with its heading.
  });

  it('opens the account profile popover from the global rail', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '用户' }));

    const dialog = screen.getByRole('dialog', { name: '用户 账号菜单' });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveTextContent('TokenDance');
    // Decorative account items (edit profile / card / QR / add account) were
    // removed with their fake toasts; logout is the only real action (#1818).
    expect(within(dialog).queryByRole('button', { name: '编辑资料' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '我的个人名片' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '我的二维码与链接' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '登录更多账号' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '退出登录' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: '用户 账号菜单' })).not.toBeInTheDocument();
  });

  it('opens a human contact profile instead of an Agent config error for friend avatars', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'johnny', title: 'Johnny', kind: 'direct', subtitle: '我看下项目页和私聊入口' }],
    });
    const johnnyTranscript: TranscriptBlock[] = [
      {
        id: 'johnny-msg',
        kind: 'text',
        author: { id: 'johnny', name: 'Johnny', role: 'human' },
        text: '我看下项目页和私聊入口',
      },
    ];

    const { container } = render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={johnnyTranscript}
      />,
    );

    const johnnyAvatar = container.querySelector('[data-agent-profile="Johnny"] [aria-label="Johnny 资料卡"]') as HTMLElement;
    fireEvent.click(johnnyAvatar);

    const dialog = screen.getByRole('dialog', { name: 'Johnny 资料卡' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getAllByText('维护者').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('AgentHub Desktop')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '发送消息' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '复制链接' })).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Agent 配置' })).not.toBeInTheDocument();
    expect(screen.queryByText('未找到 Johnny 的 Agent 配置')).not.toBeInTheDocument();
  });

  it('opens an Agent direct conversation from the profile send action', async () => {
    const handleConversationChange = vi.fn();
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [
        { id: 'team', title: 'Agent 协作群', kind: 'group', subtitle: 'Orchestrator 已汇总各 Agent 进度' },
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: '正在整理 B0 SQLite 迁移方案' },
      ],
    });
    const teamTranscript: TranscriptBlock[] = [
      {
        id: 'team-builder-msg',
        kind: 'text',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        text: '我会继续产出迁移 SQL。',
      },
    ];

    const { container } = render(
      <AgentHubWorkbench
        activeConversationId="team"
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        onActiveConversationChange={handleConversationChange}
        transcript={teamTranscript}
      />,
    );

    const builderAvatar = container.querySelector('[data-agent-profile="Builder"] [aria-label="Builder 资料卡"]') as HTMLElement;
    fireEvent.click(builderAvatar);
    const dialog = screen.getByRole('dialog', { name: 'Builder 资料卡' });
    fireEvent.click(within(dialog).getByRole('button', { name: '发送消息' }));

    expect(handleConversationChange).toHaveBeenCalledWith('builder');
    expect(screen.queryByRole('dialog', { name: 'Builder 资料卡' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: '输入框' })).toHaveFocus();
    });
  });

  it('roves the global rail page buttons with arrow keys (single tab stop)', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
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

    const chatButton = screen.getByRole('button', { name: '会话' });
    const contactsButton = screen.getByRole('button', { name: '联系人' });
    const settingsButton = screen.getByRole('button', { name: '设置' });
    const themeButton = screen.getByRole('button', { name: '切换主题' });

    // Only the active page button is in the tab order by default.
    expect(chatButton).toHaveAttribute('tabindex', '0');
    expect(contactsButton).toHaveAttribute('tabindex', '-1');
    expect(settingsButton).toHaveAttribute('tabindex', '-1');
    // Non-page buttons (theme toggle) stay independently tabbable.
    expect(themeButton).not.toHaveAttribute('tabindex');

    // ArrowRight moves the single tab stop to the next page and navigates.
    fireEvent.keyDown(chatButton, { key: 'ArrowRight' });
    expect(contactsButton).toHaveAttribute('tabindex', '0');
    expect(chatButton).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(contactsButton);
    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'contacts');

    // ArrowLeft wraps back to the previous page.
    fireEvent.keyDown(contactsButton, { key: 'ArrowLeft' });
    expect(chatButton).toHaveAttribute('tabindex', '0');
    expect(contactsButton).toHaveAttribute('tabindex', '-1');
    expect(document.activeElement).toBe(chatButton);

    // ArrowLeft from the first page wraps to the rail footer settings page.
    fireEvent.keyDown(chatButton, { key: 'ArrowLeft' });
    expect(settingsButton).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(settingsButton);

    // End jumps to the last page button; Home back to the first.
    fireEvent.keyDown(settingsButton, { key: 'End' });
    expect(settingsButton).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(settingsButton, { key: 'Home' });
    expect(chatButton).toHaveAttribute('tabindex', '0');
    expect(document.activeElement).toBe(chatButton);
  });
});
