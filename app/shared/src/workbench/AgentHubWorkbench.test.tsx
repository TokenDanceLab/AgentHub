import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '../platform/createMockPlatform';
import type { WorkbenchAgent } from '../platform/types';
import type { TranscriptBlock } from '../transcript/types';
import { AgentHubWorkbench } from './AgentHubWorkbench';

describe('AgentHubWorkbench', () => {
  const agents: WorkbenchAgent[] = [
    {
      id: 'builder',
      name: 'Builder',
      description: '代码实现',
      status: 'available',
      model: 'glm-5.1',
      runtimeId: 'claude-code',
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: '架构复核',
      status: 'available',
      model: 'deepseek-v4-pro',
      runtimeId: 'claude-code',
    },
  ];

  const transcript: TranscriptBlock[] = [
    {
      id: 'msg-1',
      kind: 'text',
      author: { id: 'user', name: 'Delicious233', role: 'human' },
      text: '全面参考 agenthub-design/desktop',
    },
    {
      id: 'tool-1',
      kind: 'tool_call',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      toolName: 'Read',
      status: 'completed',
      evidenceRefs: [
        { id: 'run-v4', kind: 'run', label: 'Run v4', status: 'running' },
        { id: 'ev-tool', kind: 'tool', label: 'Read desktop/index.html', status: 'completed' },
      ],
    },
    {
      id: 'thinking-1',
      kind: 'thinking',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      content: '正在分析 Desktop/Web shared UI 与 design demo 的消息块差距。',
      isThinking: true,
    },
    {
      id: 'route-1',
      kind: 'route_decision',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      action: 'fanout',
      targetAgent: 'Reviewer',
      summary: '把页面路由、消息块和 floating layer 拆成可验证切片。',
    },
    {
      id: 'subagent-1',
      kind: 'subagent',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: '复核 blocks 对齐',
      worker: 'Reviewer',
      status: 'running',
      summary: '检查 Thinking、Subagent、Result 等设计块是否进入 shared transcript。',
      runId: 'review-v4-blocks',
    },
    {
      id: 'timeline-1',
      kind: 'agent_timeline',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: '运行时间线',
      items: [
        { status: 'completed', label: '初始化会话', detail: '模型、工具权限和当前项目上下文已加载' },
        { status: 'running', label: '进入代码定位阶段', detail: '读取消息模型和 SQLite 索引入口' },
      ],
    },
    {
      id: 'child-1',
      kind: 'child_agent',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: 'Browser QA 截图验证',
      agent: 'Browser QA',
      status: 'completed',
      summary: '确认 Desktop/Web 消息列能显示新增块。',
      runId: 'browser-qa-v4',
      parentRunId: 'run-v4',
    },
    {
      id: 'context-1',
      kind: 'context_usage',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      inputTokens: 38400,
      outputTokens: 6200,
      contextLimit: 200000,
      cost: '$0.44',
      modelLabel: 'GLM-5.1 / 200k',
    },
    {
      id: 'diff-1',
      kind: 'diff',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: 'app/shared/src/workbench/RightInspector.tsx',
      files: ['app/shared/src/workbench/RightInspector.tsx'],
      evidenceRefs: [{ id: 'ev-file', kind: 'file', label: 'app/shared/src/workbench/RightInspector.tsx' }],
    },
    {
      id: 'artifact-1',
      kind: 'artifact',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: 'visual-smoke-desktop.png',
      evidenceRefs: [{ id: 'ev-artifact', kind: 'artifact', label: 'visual-smoke-desktop.png', status: 'completed' }],
    },
    {
      id: 'result-1',
      kind: 'result',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      success: true,
      duration: '8m12s',
      turns: 7,
      summary: '协作进度 78% · Builder 完成 · Reviewer 复核中。',
    },
  ];

  it('renders the v4 shell regions from one shared workbench', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '消息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '云文档' })).toBeInTheDocument();
    const inspectorTabs = screen.getAllByRole('tablist').find((tablist) => (
      within(tablist).queryByRole('tab', { name: /概览/ })
      && within(tablist).queryByRole('tab', { name: /浏览器/ })
      && within(tablist).queryByRole('tab', { name: /文件/ })
    ));
    expect(inspectorTabs).toBeDefined();
    expect(screen.getByRole('tab', { name: /概览/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /浏览器/ })).toBeDisabled();
    expect(screen.getByRole('tab', { name: /文件/ })).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整右侧栏宽度' })).toHaveAttribute('aria-valuenow', '400');
    expect(screen.getByRole('button', { name: '收起右侧概览' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('发消息给 Builder')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deploy' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('composer-attachment-input')).not.toBeInTheDocument();
    expect(screen.getByText('全面参考 agenthub-design/desktop')).toBeInTheDocument();
    expect(screen.getAllByText('Read desktop/index.html').length).toBeGreaterThan(0);
  });

  it('supports v4 inspector collapse and keyboard resize controls', () => {
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

    const shell = screen.getByTestId('agenthub-workbench');
    const inspector = screen.getByRole('complementary', { name: 'Right inspector' });
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    expect(shell).toHaveStyle({ '--inspector-w': '400px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');
    expect(inspector).toHaveAttribute('aria-hidden', 'false');
    expect(resizer).toHaveAttribute('aria-valuemin', '300');
    expect(resizer).toHaveAttribute('aria-valuemax', '760');
    expect(resizer).toHaveAttribute('aria-valuenow', '400');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(shell).toHaveStyle({ '--inspector-w': '416px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '416');

    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveStyle({ '--inspector-w': '376px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '376');

    fireEvent.click(screen.getByRole('button', { name: '收起右侧概览' }));
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开右侧概览' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开右侧概览' }));
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');
    expect(inspector).toHaveAttribute('aria-hidden', 'false');
    expect(screen.getByRole('button', { name: '收起右侧概览' })).toBeInTheDocument();
  });

  it('renders pinned announcements from the active conversation only', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [
        {
          id: 'builder',
          title: 'Builder',
          kind: 'direct',
          pinnedAnnouncement: {
            title: 'Builder',
            content: 'Builder 会话自己的置顶',
            author: 'Delicious233',
            time: '14:49',
          },
        },
        { id: 'reviewer', title: 'Reviewer', kind: 'direct' },
      ],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByText('Builder 会话自己的置顶')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Reviewer/ }));

    expect(screen.queryByText('Builder 会话自己的置顶')).not.toBeInTheDocument();
  });

  it('renders v4 inspector overview, changed files, and browser capability state', () => {
    const openEvidence = vi.fn().mockResolvedValue(undefined);
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
      openEvidence,
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    const inspector = within(screen.getByRole('complementary', { name: 'Right inspector' }));

    expect(screen.getByText('B0 SQLite 迁移')).toBeInTheDocument();
    expect(inspector.getAllByRole('button', { expanded: true }).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('生成迁移顺序与回滚脚本')).toBeInTheDocument();
    expect(screen.getAllByText('sqlite-migration-plan.md').length).toBeGreaterThan(0);
    expect(screen.getByText('产物')).toBeInTheDocument();

    fireEvent.click(inspector.getByRole('button', { name: '打开 sqlite-migration-plan.md 只读预览' }));
    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', {
      name: 'sqlite-migration-plan.md 只读预览',
    })).toBeInTheDocument();
    expect(screen.getAllByText('sqlite-migration-plan.md').length).toBeGreaterThan(0);
    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(openEvidence).not.toHaveBeenCalledWith(expect.objectContaining({
      id: 'ev-file',
      kind: 'file',
      label: 'app/shared/src/workbench/RightInspector.tsx',
    }));

    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '后退' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '前进' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新' })).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:5176/desktop/')).toBeInTheDocument();
    expect(screen.getByText('只读预览')).toBeInTheDocument();
    expect(openEvidence).not.toHaveBeenCalledWith(expect.objectContaining({
      id: 'ev-artifact',
      kind: 'artifact',
      label: 'visual-smoke-desktop.png',
    }));
    expect(platform.openedEvidence).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: '关闭预览' }));
    expect(inspector.getByRole('button', { name: 'B0 SQLite 迁移' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:5176/desktop/')).toBeInTheDocument();
  });

  it('uses the design preview target on the shared web surface', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));

    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'web');
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:5176/desktop/')).toBeInTheDocument();
    expect(screen.queryByText('http://127.0.0.1:5174/')).not.toBeInTheDocument();
  });

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
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-mode', 'workbench');
    expect(screen.queryByRole('complementary', { name: 'Conversation sidebar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('complementary', { name: 'Right inspector' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tablist', { name: 'Workspace tabs' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('发消息给 Builder')).not.toBeInTheDocument();
    expect(screen.getByText('通讯录')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '组织内联系人' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'agents');
    expect(screen.getByText('Agent 配置')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
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

    fireEvent.click(screen.getByRole('button', { name: 'Delicious233' }));

    const dialog = screen.getByRole('dialog', { name: 'Delicious233 账号菜单' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('输入你的个性签名...')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '编辑资料' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '复制链接' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '我的个人名片' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '我的二维码与链接' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '登录更多账号' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '帮助与客服' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '设置' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '退出登录' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '管理后台' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    expect(screen.getByText('已复制链接')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Delicious233 账号菜单' })).not.toBeInTheDocument();
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

    expect(screen.getByText('深度思考')).toBeInTheDocument();
    expect(screen.getByText('当前推理')).toBeInTheDocument();
    expect(screen.getByText('Route Decision')).toBeInTheDocument();
    expect(screen.getByText('fanout')).toBeInTheDocument();
    expect(screen.getByText('Subagent Task')).toBeInTheDocument();
    expect(screen.getByText('复核 blocks 对齐')).toBeInTheDocument();
    expect(screen.getByText('worker: Reviewer')).toBeInTheDocument();
    expect(screen.getByText('运行时间线')).toBeInTheDocument();
    expect(screen.getByText('进入代码定位阶段')).toBeInTheDocument();
    expect(screen.getByText('Child Agent')).toBeInTheDocument();
    expect(screen.getByText('Browser QA 截图验证')).toBeInTheDocument();
    expect(screen.getByText('parent: run-v4')).toBeInTheDocument();
    expect(screen.getByText('上下文使用')).toBeInTheDocument();
    expect(screen.getByText('38,400')).toBeInTheDocument();
    expect(screen.getByText('limit')).toBeInTheDocument();
    expect(screen.getByText('运行结果')).toBeInTheDocument();
    expect(screen.getByText('协作进度 78% · Builder 完成 · Reviewer 复核中。')).toBeInTheDocument();
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

    const firstCard = container.querySelector('[data-selectable-card="msg-1"]');
    expect(firstCard).toBeInTheDocument();
    fireEvent.contextMenu(firstCard!, { clientX: 120, clientY: 180 });

    const menu = screen.getByRole('menu', { name: '卡片操作菜单' });
    expect(menu).toHaveTextContent('全面参考 agenthub-design/desktop');
    expect(within(menu).getAllByRole('menuitem')).toHaveLength(13);
    expect(within(menu).getByText('复制')).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /表情回复/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /创建话题/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /复制消息链接/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /添加任务/ })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: /删除/ })).toBeInTheDocument();

    fireEvent.click(within(menu).getByRole('menuitem', { name: /多选/ }));

    const toolbar = screen.getByRole('toolbar', { name: '多选操作' });
    expect(toolbar).toHaveTextContent('1 已选择 / 11');
    expect(within(toolbar).getByRole('button', { name: '全选' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '清空' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '复制' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '转发' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '添加任务' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '导出文档' })).toBeInTheDocument();
    expect(within(toolbar).getByRole('button', { name: '删除' })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('发消息给 Builder')).not.toBeInTheDocument();

    fireEvent.click(within(toolbar).getByRole('button', { name: '清空' }));
    expect(toolbar).toHaveTextContent('0 框选模式 / 11');

    fireEvent.click(within(toolbar).getByRole('button', { name: '退出' }));
    expect(screen.queryByRole('toolbar', { name: '多选操作' })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('发消息给 Builder')).toBeInTheDocument();
  });

  it('switches conversations from the sidebar and reports the selected id', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [
        { id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'B0 SQLite', updatedLabel: '14:49' },
        { id: 'reviewer', title: 'Reviewer', kind: 'direct', subtitle: '代码审查', updatedLabel: '12:15', unreadCount: 2 },
      ],
    });
    const handleConversationChange = vi.fn();

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        onActiveConversationChange={handleConversationChange}
        transcript={transcript}
      />,
    );

    const reviewer = screen.getByRole('button', { name: /Reviewer/ });
    expect(within(reviewer).getAllByText('12:15').length).toBeGreaterThan(0);
    expect(within(reviewer).getByText('2')).toBeInTheDocument();
    fireEvent.click(reviewer);

    expect(handleConversationChange).toHaveBeenCalledWith('reviewer');
    expect(reviewer).toHaveAttribute('aria-current', 'true');
    expect(screen.getByPlaceholderText('发消息给 Reviewer')).toBeInTheDocument();
  });

  it('submits composer intents through the platform adapter', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '开始 v4 shared workbench' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({
          approvalMode: 'suggest',
          attachments: [],
          conversationId: 'team',
          mentions: [],
          mode: 'ask',
          text: '开始 v4 shared workbench',
        }),
      ]);
    });
  });

  it('keeps the draft editable when platform submit fails', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockRejectedValue(new Error('no active Edge thread'));

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '没有真实 thread 时不要假提交' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('textbox', { name: 'Composer input' })).toHaveValue('没有真实 thread 时不要假提交');
    expect(screen.getByRole('button', { name: '发送消息' })).not.toBeDisabled();
  });
});
