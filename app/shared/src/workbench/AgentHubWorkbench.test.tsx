import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WORKBENCH_DATA_MODE_STORAGE_KEY } from '../demo';
import { createMockPlatform } from '../platform/createMockPlatform';
import type { WorkbenchAgent } from '../platform/types';
import type { TranscriptBlock } from '../transcript/types';
import { AgentHubWorkbench } from './AgentHubWorkbench';
import { DESIGN_NAV_GLYPH_SIZE, DESIGN_NAV_GLYPH_STROKE_WIDTH } from './designIcons';

describe('AgentHubWorkbench', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

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
    const overviewTabIcon = screen.getByRole('tab', { name: /概览/ }).querySelector('svg');
    expect(overviewTabIcon).toHaveAttribute('width', String(DESIGN_NAV_GLYPH_SIZE));
    expect(overviewTabIcon).toHaveAttribute('height', String(DESIGN_NAV_GLYPH_SIZE));
    expect(overviewTabIcon).toHaveAttribute('stroke-width', String(DESIGN_NAV_GLYPH_STROKE_WIDTH));
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
    const userAvatarCells = Array.from(container.querySelectorAll('[data-user-bubble]'))
      .map((bubble) => bubble.parentElement?.lastElementChild?.textContent ?? null);
    expect(userAvatarCells).toEqual(['D', '', 'D']);
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
    expect(resizer).toHaveAttribute('aria-valuemin', '48');
    expect(resizer).toHaveAttribute('aria-valuemax', '760');
    expect(resizer).toHaveAttribute('aria-valuenow', '400');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft' });
    expect(shell).toHaveStyle({ '--inspector-w': '416px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '416');

    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveStyle({ '--inspector-w': '376px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '376');

    for (let index = 0; index < 12; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--inspector-w': '48px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    expect(inspector).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(screen.getByRole('button', { name: '展开右侧概览' }));
    expect(shell).toHaveStyle({ '--inspector-w': '400px' });
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');

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

  it('collapses the v4 inspector as soon as pointer resize crosses the snap threshold', async () => {
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

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1440,
    });
    const shell = screen.getByTestId('agenthub-workbench');
    const inspector = screen.getByRole('complementary', { name: 'Right inspector' });
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    fireEvent.pointerDown(resizer, { clientX: 1040, pointerId: 1 });
    expect(shell).toHaveAttribute('data-inspector-resizing', 'true');
    expect(shell).toHaveAttribute('data-inspector-collapsed', 'false');

    fireEvent.pointerMove(window, { clientX: 1360, pointerId: 1 });

    await waitFor(() => {
      expect(shell).toHaveAttribute('data-inspector-resizing', 'false');
      expect(shell).toHaveAttribute('data-inspector-collapsed', 'true');
    });
    expect(shell).toHaveStyle({ '--inspector-w': '48px' });
    expect(inspector).toHaveAttribute('aria-hidden', 'true');
  });

  it('auto-collapses the conversation sidebar when inspector resize squeezes the chat column', () => {
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

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1024,
    });
    const shell = screen.getByTestId('agenthub-workbench');
    const resizer = screen.getByRole('separator', { name: '调整右侧栏宽度' });

    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    fireEvent.pointerDown(resizer, { clientX: 240, pointerId: 1 });

    expect(shell).toHaveStyle({ '--inspector-w': '760px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
  });

  it('supports v4 conversation sidebar collapse and keyboard resize controls', () => {
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

    const shell = screen.getByTestId('agenthub-workbench');
    const sidebar = screen.getByRole('complementary', { name: 'Conversation sidebar' });
    const resizer = screen.getByRole('separator', { name: '调整最近频道宽度' });

    expect(shell).toHaveStyle({ '--sidebar-w': '260px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');
    expect(sidebar).toBeInTheDocument();
    expect(resizer).toHaveAttribute('aria-valuemin', '180');
    expect(resizer).toHaveAttribute('aria-valuemax', '360');
    expect(resizer).toHaveAttribute('aria-valuenow', '260');

    fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    expect(shell).toHaveStyle({ '--sidebar-w': '300px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '300');

    for (let index = 0; index < 4; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowRight', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--sidebar-w': '360px' });
    expect(resizer).toHaveAttribute('aria-valuenow', '360');

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    expect(shell).toHaveStyle({ '--sidebar-w': '260px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    for (let index = 0; index < 2; index += 1) {
      fireEvent.keyDown(resizer, { key: 'ArrowLeft', shiftKey: true });
    }
    expect(shell).toHaveStyle({ '--sidebar-w': '180px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'false');

    fireEvent.keyDown(resizer, { key: 'ArrowLeft', shiftKey: true });
    expect(shell).toHaveStyle({ '--sidebar-w': '180px' });
    expect(shell).toHaveAttribute('data-sidebar-collapsed', 'true');
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
    const filePreview = screen.getByRole('region', {
      name: 'sqlite-migration-plan.md 只读预览',
    });
    expect(filePreview).toBeInTheDocument();
    expect(screen.getAllByText('sqlite-migration-plan.md').length).toBeGreaterThan(0);
    expect(filePreview).toHaveAccessibleName('sqlite-migration-plan.md 只读预览');
    expect(screen.getByRole('article', { name: 'Markdown 预览' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'B0 SQLite 迁移方案' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(screen.getByRole('generic', { name: 'Diff 预览' })).toBeInTheDocument();
    expect(screen.getByText(/diff --git/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /打开方式/ }));
    expect(screen.getByRole('menu', { name: '打开方式菜单' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /VS Code/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Terminal/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /VS Code/ }));
    expect(screen.getByText('已选择 VS Code')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('关闭 文件'));
    expect(screen.queryByRole('tab', { name: /文件/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /恢复 文件/ }));
    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    expect(openEvidence).not.toHaveBeenCalledWith(expect.objectContaining({
      id: 'ev-file',
      kind: 'file',
      label: 'app/shared/src/workbench/RightInspector.tsx',
    }));

    fireEvent.click(screen.getByRole('tab', { name: /浏览器/ }));
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '后退' })).toBeInTheDocument();
    const backIcon = screen.getByRole('button', { name: '后退' }).querySelector('svg');
    expect(backIcon).toHaveAttribute('width', '15');
    expect(backIcon).toHaveAttribute('height', '15');
    expect(backIcon).toHaveAttribute('stroke-width', String(DESIGN_NAV_GLYPH_STROKE_WIDTH));
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
    expect(inspector.getByRole('button', { name: '折叠 B0 SQLite 迁移' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(screen.getByRole('button', { name: '新建右侧窗口' }));
    const browserMenuItem = screen
      .getAllByRole('menuitem', { name: /浏览器/ })
      .find((item) => !item.hasAttribute('disabled'));
    expect(browserMenuItem).toBeDefined();
    fireEvent.click(browserMenuItem!);
    expect(screen.getByRole('region', { name: '内置浏览器预览' })).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:5176/desktop/')).toBeInTheDocument();
  });

  it('opens structured file details in the inspector from Review actions', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });
    const reviewTranscript: TranscriptBlock[] = [
      {
        id: 'group-1',
        kind: 'run_step_group',
        author: { id: 'builder', name: 'Builder', role: 'agent' },
        title: '生成 SQLite 迁移',
        status: 'completed',
        children: [
          {
            id: 'artifact-sql',
            kind: 'artifact',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'migrations/0007_chat_threads.sql',
            action: 'created',
            additions: 12,
            evidenceRefs: [
              {
                id: 'file-sql',
                kind: 'file',
                label: 'migrations/0007_chat_threads.sql',
                path: 'migrations/0007_chat_threads.sql',
              },
            ],
          },
          {
            id: 'diff-sql',
            kind: 'diff',
            author: { id: 'builder', name: 'Builder', role: 'agent' },
            title: 'migrations/0007_chat_threads.sql',
            files: ['migrations/0007_chat_threads.sql'],
            additions: 12,
            deletions: 0,
            lines: [
              { type: 'add', content: '+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);' },
            ],
          },
        ],
      },
    ];

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={reviewTranscript}
      />,
    );

    expect(screen.queryByText('+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开' }));
    expect(screen.getByText('+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    expect(screen.queryByText('+ CREATE TABLE IF NOT EXISTS chat_threads (id TEXT PRIMARY KEY);')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review' }));

    expect(screen.getByRole('tab', { name: /文件/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('region', {
      name: 'migrations/0007_chat_threads.sql 只读预览',
    })).toBeInTheDocument();
    const preview = screen.getByRole('region', {
      name: 'migrations/0007_chat_threads.sql 只读预览',
    });
    expect(preview).toHaveTextContent('CREATE TABLE IF NOT EXISTS chat_threads');

    fireEvent.click(screen.getByRole('tab', { name: 'Diff' }));
    expect(screen.getByText(/diff --git a\/migrations\/0007_chat_threads.sql/)).toBeInTheDocument();
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
    expect(screen.getAllByText('Builder').length).toBeGreaterThan(0);
    expect(screen.getAllByText('DeepSeek-V4-Pro').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '项目' }));

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'projects');
    expect(screen.getByRole('heading', { name: 'AI 游戏项目' })).toBeInTheDocument();

    const projectMain = screen.getByRole('heading', { name: 'AI 游戏项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    fireEvent.click(projectScope.getByRole('button', { name: '运行' }));
    expect(screen.getByRole('heading', { name: '运行摘要' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '运行记录' })).toBeInTheDocument();

    fireEvent.click(projectScope.getByRole('button', { name: '产物' }));
    expect(screen.getByRole('heading', { name: '产物索引' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '交付动态' })).toBeInTheDocument();

    fireEvent.click(projectScope.getByRole('button', { name: '归档' }));
    expect(screen.getByRole('heading', { name: '归档检查' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '归档包' })).toBeInTheDocument();

    fireEvent.click(projectScope.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('heading', { name: '项目设置' })).toBeInTheDocument();
    expect(screen.getAllByText('成员策略').length).toBeGreaterThan(0);
  });

  it('renders supplied Hub contacts on the Contacts rail page', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        contacts={{
          members: [{
            id: 'hub-user-1',
            name: 'Hub 联系人',
            initials: 'HU',
            org: 'TokenDance',
            status: '在线',
            tag: 'Hub',
          }],
          recentShortcuts: ['Hub 联系人'],
          orgName: 'TokenDance',
          orgInitials: 'TD',
        }}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '联系人' }));

    const contactsPage = screen.getByRole('heading', { name: '组织内联系人' }).closest('main')!;
    expect(within(contactsPage).getByText('Hub 联系人')).toBeInTheDocument();
    expect(within(contactsPage).queryByText('Delicious233')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: '新的联系人' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '新的联系人' }));
    const pendingPage = screen.getByRole('heading', { name: '新的联系人' }).closest('main')!;
    expect(within(pendingPage).queryByText('Nora Wang')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '服务台' }));
    const servicePage = screen.getByRole('heading', { name: '服务台' }).closest('main')!;
    expect(within(servicePage).queryByText('账号与权限')).not.toBeInTheDocument();
  });

  it('keeps the Tasks rail page interactive without leaving the v4 table shell', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    const page = screen.getByRole('region', { name: 'Workbench page' });

    expect(screen.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'runs');
    expect(within(page).getByRole('heading', { name: '我负责的' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: /B0 SQLite 迁移方案/ })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: /Agent 市场卡片完善/ })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: /筛选 1/ })).toBeInTheDocument();
    expect(within(page).queryAllByText('选择一条任务后可快速调整状态、负责人和分组。')).toHaveLength(0);

    fireEvent.click(within(page).getByRole('button', { name: '任务更多操作' }));
    const taskMenu = within(page).getByRole('menu', { name: '任务更多操作菜单' });
    expect(within(taskMenu).getByRole('menuitem', { name: '导入任务' })).toBeInTheDocument();
    expect(within(taskMenu).getByRole('menuitem', { name: '导出当前视图' })).toBeInTheDocument();
    expect(within(taskMenu).getByRole('menuitem', { name: '管理任务字段' })).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '我关注的' }));
    expect(within(page).getByRole('heading', { name: '我关注的' })).toBeInTheDocument();
    expect(within(page).getByRole('button', { name: /云文档内嵌子页对齐/ })).toBeInTheDocument();
    expect(within(page).queryByRole('button', { name: /Agent 市场卡片完善/ })).not.toBeInTheDocument();

    fireEvent.click(within(page).getByRole('tab', { name: '看板' }));
    expect(within(page).getByRole('tab', { name: '看板' })).toHaveAttribute('aria-selected', 'true');
    expect(within(page).getByRole('button', { name: '分组：状态看板' })).toBeInTheDocument();
    expect(within(page).getAllByText('待评审').length).toBeGreaterThan(0);

    fireEvent.click(within(page).getByRole('tab', { name: '列表' }));
    fireEvent.click(within(page).getByRole('button', { name: '排序：拖拽自定义' }));
    expect(within(page).getByRole('button', { name: '排序：截止时间' })).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '分组：自定义分组' }));
    expect(within(page).getByRole('button', { name: '分组：所属项目' })).toBeInTheDocument();
    expect(within(page).getAllByText('AgentHub 设计评审').length).toBeGreaterThan(0);

    fireEvent.click(within(page).getByRole('button', { name: '字段配置' }));
    expect(within(page).getByRole('button', { name: '字段配置 5/6' })).toBeInTheDocument();
    expect(within(page).queryByText('创建人')).not.toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: /筛选 1/ }));
    expect(within(page).getByRole('button', { name: '筛选' })).toBeInTheDocument();

    fireEvent.click(within(page).getAllByRole('button', { name: '新建任务' })[0]);
    expect(within(page).getByLabelText('编辑任务标题')).toHaveValue('未命名任务 1');
    fireEvent.change(within(page).getByLabelText('编辑任务标题'), {
      target: { value: '任务 CRUD 交互验收' },
    });
    fireEvent.change(within(page).getByLabelText('编辑所属项目'), {
      target: { value: 'AgentHub 任务系统' },
    });
    fireEvent.change(within(page).getByLabelText('编辑负责人'), {
      target: { value: 'Reviewer' },
    });
    fireEvent.click(within(page).getByRole('button', { name: '保存' }));
    expect(within(page).getByText('任务 CRUD 交互验收 已保存')).toBeInTheDocument();

    const newTask = within(page).getByRole('button', { name: /任务 CRUD 交互验收/ });
    expect(newTask).toHaveAttribute('aria-pressed', 'true');
    expect(within(page).getByRole('heading', { name: '我负责的' })).toBeInTheDocument();
    expect(within(page).getByRole('region', { name: '任务 CRUD 交互验收 任务详情' })).toHaveTextContent('AgentHub 任务系统 · Reviewer · 截止 今天 22:00');

    fireEvent.click(within(page).getByRole('button', { name: '推进状态' }));
    expect(within(page).getByRole('button', { name: /任务 CRUD 交互验收/ })).toHaveTextContent('进行中');
    expect(within(page).getByText('任务 CRUD 交互验收 已推进到 进行中')).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '指派给我' }));
    expect(within(page).getByRole('region', { name: '任务 CRUD 交互验收 任务详情' })).toHaveTextContent('Delicious233');

    fireEvent.click(within(page).getByRole('button', { name: '按项目分组' }));
    expect(within(page).getByRole('button', { name: '分组：所属项目' })).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '看负责人任务' }));
    expect(within(page).getByText('当前负责人：Delicious233')).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: /云文档内嵌子页对齐/ }));
    expect(within(page).getByRole('button', { name: /云文档内嵌子页对齐/ })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(page).getByRole('button', { name: '编辑' }));
    fireEvent.change(within(page).getByLabelText('编辑任务标题'), {
      target: { value: '不应保存的标题' },
    });
    fireEvent.click(within(page).getByRole('button', { name: '取消' }));
    expect(within(page).getByRole('button', { name: /云文档内嵌子页对齐/ })).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: /任务 CRUD 交互验收/ }));
    fireEvent.click(within(page).getByRole('button', { name: '删除' }));
    expect(within(page).queryByRole('button', { name: /任务 CRUD 交互验收/ })).not.toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '新建分组' }));
    expect(within(page).getByText('自定义分组 2')).toBeInTheDocument();
  });

  it('renders the local data mode setting with mock and real-mode choices', () => {
    window.localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);
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

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '本地开发' }));

    expect(screen.getByText('数据模式')).toBeInTheDocument();
    expect(screen.getByText('自动优先真实数据；Mock 固定设计 fixture；正常只走真实数据。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '自动' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Mock' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '正常' }).length).toBeGreaterThan(0);
    expect(screen.getByRole('region', { name: '数据模式状态' })).toBeInTheDocument();
    expect(screen.getByText('Auto fallback')).toBeInTheDocument();
    expect(screen.getByText('优先真实数据，开发预览自动回退 Mock')).toBeInTheDocument();
    expect(screen.queryByText('Normal 只走真实数据')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Mock' })[0]);
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('demo');
    expect(screen.getByText('Mock fixture')).toBeInTheDocument();
    expect(screen.getByText('固定使用 agenthub-design 的演示数据')).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: '正常' })[0]);
    expect(window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('real');
    expect(screen.getByText('Normal data')).toBeInTheDocument();
    expect(screen.getByText('只使用真实 Hub / Edge 数据')).toBeInTheDocument();
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
    expect(dialog).toHaveTextContent('TokenDance');
    expect(within(dialog).getByRole('button', { name: '编辑资料' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '复制链接' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '我的个人名片' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '我的二维码与链接' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '登录更多账号' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '复制链接' }));
    expect(screen.getByText('已复制链接')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Delicious233 账号菜单' })).not.toBeInTheDocument();
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

    const johnnyAvatar = container.querySelector('[data-agent-profile="Johnny"]') as HTMLElement;
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

    const builderAvatar = container.querySelector('[data-agent-profile="Builder"]') as HTMLElement;
    fireEvent.click(builderAvatar);
    const dialog = screen.getByRole('dialog', { name: 'Builder 资料卡' });
    fireEvent.click(within(dialog).getByRole('button', { name: '发送消息' }));

    expect(handleConversationChange).toHaveBeenCalledWith('builder');
    expect(screen.queryByRole('dialog', { name: 'Builder 资料卡' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Composer input' })).toHaveFocus();
    });
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
    expect(screen.getByText('Subagent')).toBeInTheDocument();
    expect(screen.getByText('复核 blocks 对齐')).toBeInTheDocument();
    expect(screen.getByText('子Agent: Reviewer')).toBeInTheDocument();
    expect(screen.getByText('运行时间线')).toBeInTheDocument();
    expect(screen.getByText('进入代码定位阶段')).toBeInTheDocument();
    expect(screen.getByText('子Agent')).toBeInTheDocument();
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

      const firstCard = container.querySelector('[data-selectable-card="msg-1"]') as HTMLElement;
      fireEvent.pointerDown(firstCard, { button: 0, clientX: 120, clientY: 180 });
      act(() => {
        vi.advanceTimersByTime(520);
      });
      fireEvent.pointerUp(firstCard, { button: 0, clientX: 120, clientY: 180 });

      const toolbar = screen.getByRole('toolbar', { name: '多选操作' });
      expect(toolbar).toHaveTextContent('1 已选择 / 11');
      expect(firstCard).toHaveAttribute('aria-selected', 'true');
      expect(screen.queryByPlaceholderText('发消息给 Builder')).not.toBeInTheDocument();

      const secondCard = container.querySelector('[data-selectable-card="tool-1"]') as HTMLElement;
      expect(secondCard).toBeInTheDocument();
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('toolbar', { name: '多选操作' })).not.toBeInTheDocument();

      fireEvent.pointerDown(firstCard, { button: 0, clientX: 120, clientY: 180 });
      fireEvent.pointerMove(firstCard, { button: 0, clientX: 180, clientY: 180 });
      act(() => {
        vi.advanceTimersByTime(520);
      });
      expect(screen.queryByRole('toolbar', { name: '多选操作' })).not.toBeInTheDocument();
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

    const firstCard = container.querySelector('[data-selectable-card="msg-1"]') as HTMLElement;
    expect(firstCard).toBeInTheDocument();
    firstCard.focus();
    expect(firstCard).toHaveFocus();
    fireEvent.keyDown(firstCard, { key: 'F10', shiftKey: true });

    const menu = screen.getByRole('menu', { name: '卡片操作菜单' });
    expect(menu).toHaveTextContent('全面参考 agenthub-design/desktop');
    fireEvent.click(within(menu).getByRole('menuitem', { name: /多选/ }));

    const secondCard = container.querySelector('[data-selectable-card="tool-1"]') as HTMLElement;
    secondCard.focus();
    fireEvent.keyDown(secondCard, { key: ' ' });

    const toolbar = screen.getByRole('toolbar', { name: '多选操作' });
    expect(toolbar).toHaveTextContent('2 已选择 / 11');
    expect(secondCard).toHaveAttribute('aria-selected', 'true');
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

  it('uses Enter to send and Ctrl+Enter for newline by default', async () => {
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
        transcript={[]}
      />,
    );

    const input = screen.getByRole('textbox', { name: 'Composer input' });
    fireEvent.change(input, { target: { value: '先换行' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(platform.submittedIntents).toEqual([]);
    expect(input).toHaveValue('先换行\n');

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({ conversationId: 'team', text: '先换行' }),
      ]);
    });
    expect(input).toHaveValue('');
  });

  it('can switch composer keyboard behavior from Settings', async () => {
    window.localStorage.removeItem('agenthub.workbench.composerSubmitBehavior');
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
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '本地开发' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+Enter 发送' }));
    expect(window.localStorage.getItem('agenthub.workbench.composerSubmitBehavior')).toBe('ctrl-enter-send');

    fireEvent.click(screen.getByRole('button', { name: '对话' }));
    const input = screen.getByRole('textbox', { name: 'Composer input' });
    fireEvent.change(input, { target: { value: '需要快捷键发送' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(platform.submittedIntents).toEqual([]);
    expect(input).toHaveValue('需要快捷键发送');

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({ conversationId: 'team', text: '需要快捷键发送' }),
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
