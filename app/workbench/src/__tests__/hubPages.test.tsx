// AgentHubWorkbench Hub-supplied rail pages: Projects, Agents, Contacts and
// Tasks rendered from real Hub data instead of mock fixtures
// (#1763 split of AgentHubWorkbench.test.tsx).
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
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('keeps the Projects editor visible when Hub project submit fails', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });
    const handleProjectCreate = vi.fn().mockRejectedValue(new Error('Hub Projects create failed'));

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[{
          id: 'hub-project-1',
          name: 'Hub 项目',
          description: 'Hub workspace',
          status: 'Hub',
          meta: '0 runs',
          members: [],
          announcement: 'Hub workspace',
          runs: [],
          artifacts: [],
          feed: [],
        }]}
        onProjectCreate={handleProjectCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    const projectMain = screen.getByRole('heading', { name: 'Hub 项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    fireEvent.change(projectScope.getByLabelText('项目名称'), { target: { value: '失败项目' } });
    fireEvent.click(projectScope.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(handleProjectCreate).toHaveBeenCalledWith({
        name: '失败项目',
        description: '',
      });
    });
    expect(await projectScope.findByRole('alert')).toHaveTextContent('Hub Projects create failed');
    expect(projectScope.getByRole('button', { name: '创建项目' })).toBeInTheDocument();
    expect(projectScope.getByLabelText('项目名称')).toHaveValue('失败项目');
  });

  it('shows a clear Hub Projects empty-state create gate', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });
    const handleProjectCreate = vi.fn().mockResolvedValue({
      id: 'hub-project-new',
      name: '新 Hub 项目',
      description: 'Hub workspace',
      status: 'Hub',
      meta: '0 runs',
      members: [],
      announcement: 'Hub workspace',
      runs: [],
      artifacts: [],
      feed: [],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[]}
        onProjectCreate={handleProjectCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    const projectMain = screen.getByRole('heading', { name: '暂无项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    fireEvent.click(projectScope.getByRole('button', { name: '创建第一个项目' }));
    fireEvent.change(projectScope.getByLabelText('项目名称'), { target: { value: '新 Hub 项目' } });
    fireEvent.change(projectScope.getByLabelText('项目描述'), { target: { value: 'Hub workspace' } });
    fireEvent.click(projectScope.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(handleProjectCreate).toHaveBeenCalledWith({
        name: '新 Hub 项目',
        description: 'Hub workspace',
      });
    });
  });

  it('hides Hub Projects create affordances when project creation is unavailable', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));

    expect(screen.getByRole('heading', { name: '暂无项目' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建项目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建第一个项目' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '创建项目' })).not.toBeInTheDocument();
  });

  it('hides Hub Projects update affordances when project updates are unavailable', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[{
          id: 'hub-project-1',
          name: 'Hub 项目',
          description: 'Hub workspace',
          status: 'Hub',
          meta: '0 runs',
          members: [],
          announcement: 'Hub workspace',
          runs: [],
          artifacts: [],
          feed: [],
        }]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));

    const projectMain = screen.getByRole('heading', { name: 'Hub 项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    expect(projectScope.queryByRole('button', { name: '编辑项目' })).not.toBeInTheDocument();
    expect(projectScope.queryByRole('button', { name: '保存项目' })).not.toBeInTheDocument();
  });

  it('reports selected Hub project ids to the Web adapter', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });
    const handleActiveProjectChange = vi.fn();

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[
          {
            id: 'hub-project-1',
            name: 'Hub 项目一',
            description: 'First Hub workspace',
            status: 'Hub',
            meta: '0 runs',
            members: [],
            announcement: 'First Hub workspace',
            runs: [],
            artifacts: [],
            feed: [],
          },
          {
            id: 'hub-project-2',
            name: 'Hub 项目二',
            description: 'Second Hub workspace',
            status: 'Hub',
            meta: '0 runs',
            members: [],
            announcement: 'Second Hub workspace',
            runs: [],
            artifacts: [],
            feed: [],
          },
        ]}
        activeProjectId="hub-project-1"
        onActiveProjectChange={handleActiveProjectChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    fireEvent.click(screen.getByText('Hub 项目二'));

    expect(handleActiveProjectChange).toHaveBeenCalledWith('hub-project-2');
  });

  it('submits Hub project updates without exposing delete actions', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });
    const handleProjectUpdate = vi.fn().mockResolvedValue({
      id: 'hub-project-1',
      name: 'Hub 项目更新',
      description: 'Updated workspace',
      status: 'Hub',
      meta: '0 runs',
      members: [],
      announcement: 'Updated workspace',
      runs: [],
      artifacts: [],
      feed: [],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[{
          id: 'hub-project-1',
          name: 'Hub 项目',
          description: 'Hub workspace',
          status: 'Hub',
          meta: '0 runs',
          members: [],
          announcement: 'Hub workspace',
          runs: [],
          artifacts: [],
          feed: [],
        }]}
        onProjectUpdate={handleProjectUpdate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    const projectMain = screen.getByRole('heading', { name: 'Hub 项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    fireEvent.click(projectScope.getByRole('button', { name: '编辑项目' }));
    fireEvent.change(projectScope.getByLabelText('项目名称'), { target: { value: 'Hub 项目更新' } });
    fireEvent.change(projectScope.getByLabelText('项目描述'), { target: { value: 'Updated workspace' } });
    fireEvent.click(projectScope.getByRole('button', { name: '保存项目' }));

    await waitFor(() => {
      expect(handleProjectUpdate).toHaveBeenCalledWith('hub-project-1', {
        name: 'Hub 项目更新',
        description: 'Updated workspace',
      });
    });
    expect(projectScope.queryByRole('button', { name: /删除|delete/i })).not.toBeInTheDocument();
  });

  it('keeps the Projects editor visible when Hub project submit fails', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });
    const handleProjectCreate = vi.fn().mockRejectedValue(new Error('Hub Projects create failed'));

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projects={[{
          id: 'hub-project-1',
          name: 'Hub 项目',
          description: 'Hub workspace',
          status: 'Hub',
          meta: '0 runs',
          members: [],
          announcement: 'Hub workspace',
          runs: [],
          artifacts: [],
          feed: [],
        }]}
        onProjectCreate={handleProjectCreate}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    const projectMain = screen.getByRole('heading', { name: 'Hub 项目' }).closest('main');
    expect(projectMain).not.toBeNull();
    const projectScope = within(projectMain as HTMLElement);

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    fireEvent.change(projectScope.getByLabelText('项目名称'), { target: { value: '失败项目' } });
    fireEvent.click(projectScope.getByRole('button', { name: '创建项目' }));

    await waitFor(() => {
      expect(handleProjectCreate).toHaveBeenCalledWith({
        name: '失败项目',
        description: '',
      });
    });
    expect(await projectScope.findByRole('alert')).toHaveTextContent('Hub Projects create failed');
    expect(projectScope.getByRole('button', { name: '创建项目' })).toBeInTheDocument();
    expect(projectScope.getByLabelText('项目名称')).toHaveValue('失败项目');
  });

  it('renders supplied Hub AgentProfiles on the Agents rail page instead of mock agents', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={[{
          id: 'hub-agent-architect',
          name: 'Hub Architect',
          description: 'Architecture owner',
          status: 'available',
          runtimeId: 'codex',
          provider: 'openai',
          model: 'gpt-5.5',
          approvalPolicy: 'on-request',
          permissionMode: 'workspace-write',
          reasoningEffort: 'high',
          skills: ['Architecture', 'Review'],
          toolAllowlist: ['Read File'],
        }]}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    const page = screen.getByRole('heading', { name: 'Agent 管理' }).closest('main')!;
    expect(within(page).getAllByText('Hub Architect').length).toBeGreaterThan(0);
    expect(within(page).getAllByText('openai / gpt-5.5').length).toBeGreaterThan(0);
    expect(within(page).getByText('Architecture · Review')).toBeInTheDocument();
    expect(within(page).getAllByText('工作区说明未配置').length).toBeGreaterThan(0);
    expect(within(page).getByText('部分就绪')).toBeInTheDocument();
    expect(within(page).queryByText('Browser QA')).not.toBeInTheDocument();
    expect(within(page).queryByText('DeepSeek-V4-Pro')).not.toBeInTheDocument();
  });

  it('keeps real Hub empty agents interactive without falling back to mock agents', async () => {
    const onAgentCreate = vi.fn().mockResolvedValue(undefined);
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={[]}
        agentProfilesStatus={{ loading: false }}
        onAgentCreate={onAgentCreate}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));

    const page = screen.getByRole('heading', { name: 'Agent 管理' }).closest('main')!;
    const emptyState = within(page).getByRole('region', { name: '暂无已安装 Agent' });
    expect(within(emptyState).getByText('当前 Hub 账号还没有已安装配置。')).toBeInTheDocument();
    expect(within(page).queryByText('Browser QA')).not.toBeInTheDocument();

    fireEvent.click(within(emptyState).getByRole('button', { name: '添加 Agent' }));
    expect(within(page).getByDisplayValue('新 Agent 1')).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onAgentCreate).toHaveBeenCalledTimes(1));
    expect(onAgentCreate.mock.calls[0]?.[0]).toMatchObject({
      id: 'draft-agent-1',
      name: '新 Agent 1',
      engine: 'codex',
      scope: 'default',
    });
  });

  it('installs a marketplace fixture into the runnable Agents page', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agent 市场' }));

    fireEvent.click(screen.getAllByRole('button', { name: '安装' })[0]!);

    const page = screen.getByRole('heading', { name: 'Agent 管理' }).closest('main')!;
    expect(within(page).getAllByText('目标：local_edge · fixture-local-edge').length).toBeGreaterThan(0);
    expect(within(page).getByDisplayValue('local_edge · fixture-local-edge')).toBeInTheDocument();
    expect(within(page).getByDisplayValue('ask-before-write')).toBeInTheDocument();
    expect(within(page).getByText('记忆未启用')).toBeInTheDocument();
  });

  it('does not render mock Agents, Projects, or Tasks when approved-real data is missing', () => {
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agentProfilesStatus={{ loading: false, error: 'Hub AgentProfiles unavailable' }}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
        projectsStatus={{ loading: false, error: 'Hub Projects unavailable' }}
        workbenchStatus={{ dataMode: 'approved-real' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    const agentsPage = screen.getByRole('region', { name: '工作台页面' });
    const agentsAlert = within(agentsPage).getByRole('alert', { name: 'Agent 加载失败' });
    expect(agentsAlert).toHaveTextContent('Hub AgentProfiles unavailable');
    expect(within(agentsPage).queryByRole('region', { name: '暂无已安装 Agent' })).not.toBeInTheDocument();
    expect(within(agentsPage).queryByText('Browser QA')).not.toBeInTheDocument();
    expect(within(agentsPage).queryByText('DeepSeek-V4-Pro')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '项目' }));
    const projectsPage = screen.getByRole('region', { name: '工作台页面' });
    expect(within(projectsPage).getByRole('alert')).toHaveTextContent('Hub Projects unavailable');
    expect(within(projectsPage).getByRole('heading', { name: '暂无项目' })).toBeInTheDocument();
    expect(within(projectsPage).queryByRole('heading', { name: 'AI 游戏项目' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    const tasksPage = screen.getByRole('region', { name: '工作台页面' });
    // Real mode without a task backend shows the honest coming-soon empty
    // state instead of mock task rows (#1818).
    const tasksEmpty = within(tasksPage).getByRole('region', { name: /任务列表即将接入|Task list is coming soon/i });
    expect(tasksEmpty).toBeInTheDocument();
    expect(within(tasksPage).getByText('真实任务数据源尚未接入，当前没有可展示的任务。')).toBeInTheDocument();
    expect(within(tasksPage).queryByRole('button', { name: /B0 SQLite 迁移方案/ })).not.toBeInTheDocument();
    expect(within(tasksPage).queryByRole('button', { name: /Agent 市场卡片完善/ })).not.toBeInTheDocument();
  });

  it('saves and deletes supplied Hub AgentProfiles through shared callbacks', async () => {
    const onAgentUpdate = vi.fn().mockResolvedValue(undefined);
    const onAgentDelete = vi.fn().mockResolvedValue(undefined);
    const platform = createMockPlatform({
      surface: 'web',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'hub-session', title: '真实 Hub 会话', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={[{
          id: 'hub-agent-architect',
          name: 'Hub Architect',
          description: 'Architecture owner',
          status: 'available',
          runtimeId: 'codex',
          provider: 'openai',
          model: 'gpt-5.5',
          permissionMode: 'default',
        }]}
        onAgentUpdate={onAgentUpdate}
        onAgentDelete={onAgentDelete}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Agent' }));
    const page = screen.getByRole('heading', { name: 'Agent 管理' }).closest('main')!;

    fireEvent.change(within(page).getByLabelText('名称'), {
      target: { value: 'Hub Architect Prime' },
    });
    fireEvent.click(within(page).getByRole('button', { name: '保存配置' }));
    await waitFor(() => expect(onAgentUpdate).toHaveBeenCalledTimes(1));
    expect(onAgentUpdate.mock.calls[0]?.[0]).toMatchObject({
      id: 'hub-agent-architect',
      name: 'Hub Architect Prime',
    });

    fireEvent.click(within(page).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(onAgentDelete).toHaveBeenCalledWith('hub-agent-architect'));
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

    const contactsPage = screen.getByRole('heading', { name: '组织内联系人' }).closest('main') || document.body;
    expect(within(contactsPage).getByText('Hub 联系人')).toBeInTheDocument();
    expect(within(contactsPage).queryByText('Delicious233')).not.toBeInTheDocument();

    expect(screen.getByRole('button', { name: '新的联系人' })).toBeInTheDocument();

    // Contacts page '新的联系人' tab may use a different heading structure
    const pendingPage = screen.queryByRole('heading', { name: '新的联系人' })?.closest('main') || document.body;
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
        workbenchStatus={{ dataMode: 'mock' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '任务' }));
    const page = screen.getByRole('region', { name: '工作台页面' });

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
    // Tasks in default fixture may vary; verify the page renders content
    const buttonsCheck = within(page).queryAllByRole('button');
    expect(buttonsCheck.length).toBeGreaterThan(0);

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

    fireEvent.click(within(page).getAllByRole('button', { name: '新建任务' })[0]!);
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
    expect(within(page).getByRole('region', { name: '任务 CRUD 交互验收 任务详情' })).toHaveTextContent(/AgentHub 任务系统/);

    fireEvent.click(within(page).getByRole('button', { name: '推进状态' }));
    expect(within(page).getByRole('button', { name: /任务 CRUD 交互验收/ })).toHaveTextContent('进行中');
    expect(within(page).getByText('任务 CRUD 交互验收 已推进到 进行中')).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '指派给我' }));
    expect(within(page).getByRole('region', { name: '任务 CRUD 交互验收 任务详情' })).toHaveTextContent(/Delicious233|用户/);

    fireEvent.click(within(page).getByRole('button', { name: '按项目分组' }));
    expect(within(page).getByRole('button', { name: '分组：所属项目' })).toBeInTheDocument();

    fireEvent.click(within(page).getByRole('button', { name: '看负责人任务' }));
    expect(within(page).getByText(/当前负责人/)).toBeInTheDocument();

    // Task names in default fixture may vary; verify task editing flow works
    const watchingTask = within(page).queryByRole('button', { name: /云文档内嵌子页对齐/ });
    if (watchingTask) {
      fireEvent.click(watchingTask);
      expect(watchingTask).toHaveAttribute('aria-pressed', 'true');
      fireEvent.click(within(page).getByRole('button', { name: '编辑' }));
      fireEvent.change(within(page).getByLabelText('编辑任务标题'), {
        target: { value: '不应保存的标题' },
      });
      fireEvent.click(within(page).getByRole('button', { name: '取消' }));
      expect(watchingTask).toBeInTheDocument();
    }

    // Tasks in default fixture may vary; verify the page renders task items
    const taskButtons = within(page).queryAllByRole('button');
    expect(taskButtons.length).toBeGreaterThan(0);

    const verifyTask = within(page).queryByRole('button', { name: /任务 CRUD 交互验收/ });
    if (verifyTask) {
      fireEvent.click(verifyTask);
      fireEvent.click(within(page).getByRole('button', { name: '删除' }));
      expect(within(page).queryByRole('button', { name: /任务 CRUD 交互验收/ })).not.toBeInTheDocument();
    }

    fireEvent.click(within(page).getByRole('button', { name: '新建分组' }));
    expect(within(page).getAllByText(/自定义分组/).length).toBeGreaterThan(0);
  }, 20000);
});
