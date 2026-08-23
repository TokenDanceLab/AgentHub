import React from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../__tests__/setup';
import {
  WORKBENCH_AGENT_MARKET_FIXTURES,
  WORKBENCH_AGENT_PROFILE_FIXTURES,
  WORKBENCH_AGENT_SKILL_OPTIONS,
  WORKBENCH_AGENT_TOOL_OPTIONS,
} from '../agentProfileCatalog';
import { AgentsPage } from './AgentsPage';

// AgentInstalledViews resolves empty-state copy via i18n (agents.empty.*);
// the registered test instance provides the real sharedWorkbench zh strings
// once this suite opts into zh (Issue #1717). Other AgentsPage text is
// hardcoded in components.
import { useTestI18nLanguage } from '@shared/testing/i18n';

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});
vi.mock('@lobehub/icons', () => {
  const span = (props?: Record<string, unknown>) => React.createElement('span', props ?? {});
  return {
    Alibaba: span,
    AlibabaCloud: span,
    Anthropic: span,
    Azure: span,
    Aws: span,
    Bedrock: span,
    ByteDance: span,
    Claude: span,
    ClaudeCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="claude-code-icon" />,
    Cohere: span,
    Codex: ({ size }: { size?: number }) => <span data-size={size} data-testid="codex-icon" />,
    DeepSeek: span,
    Doubao: span,
    Gemini: span,
    GeminiCLI: ({ size }: { size?: number }) => <span data-size={size} data-testid="gemini-cli-icon" />,
    Google: span,
    Meta: span,
    Mistral: span,
    ModelIcon: ({ model, size }: { model: string; size?: number }) => <span data-model={model} data-size={size} data-testid="model-icon" />,
    Moonshot: span,
    OpenCode: ({ size }: { size?: number }) => <span data-size={size} data-testid="opencode-icon" />,
    OpenAI: span,
    Perplexity: span,
    ProviderIcon: ({ provider, size }: { provider: string; size?: number }) => <span data-provider={provider} data-size={size} data-testid="provider-icon" />,
    Qwen: span,
    Volcengine: span,
    Zhipu: span,
  };
});

vi.mock('@lobehub/icons/es/Alibaba', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/AlibabaCloud', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Anthropic', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Azure', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Aws', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Bedrock', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/ByteDance', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Claude', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/ClaudeCode', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Codex', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Cohere', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/DeepSeek', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Doubao', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Gemini', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/GeminiCLI', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Google', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Meta', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Mistral', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Moonshot', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/OpenAI', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/OpenCode', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Perplexity', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Qwen', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Volcengine', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Zhipu', () => ({ default: () => null }));
vi.mock('@lobehub/icons/es/Antigravity/components/Color.js', () => ({ default: () => null }));

describe('AgentsPage profile catalog rendering', () => {
  it('shows Agent Builder detail as one primary card with capability strip, not a duplicate summary', () => {
    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={WORKBENCH_AGENT_PROFILE_FIXTURES.length}
        runnableCount={2}
        confirmCount={7}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={WORKBENCH_AGENT_PROFILE_FIXTURES}
        selectedAgentId="builder-agent"
        allSkills={WORKBENCH_AGENT_SKILL_OPTIONS}
        allTools={WORKBENCH_AGENT_TOOL_OPTIONS}
      />,
    );

    // #1280: capability strip remains; duplicate 配置摘要 is demoted out of product detail
    expect(screen.getByLabelText('Builder 能力就绪状态')).toBeInTheDocument();
    expect(screen.queryByLabelText('Builder 配置摘要')).not.toBeInTheDocument();

    expect(screen.getAllByTitle('Builder agenthub:avatar/builder').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TokenDance Gateway \/ DeepSeek-V4-Pro/).length).toBeGreaterThan(0);
    expect(screen.getByText('MCP / 记忆')).toBeInTheDocument();
    expect(screen.getByText('agents-md')).toBeInTheDocument();
    expect(screen.getByText('project-memory')).toBeInTheDocument();
    // Policy fields remain on the edit grid (summary removed as redundant)
    expect(screen.getByText('审批策略')).toBeInTheDocument();
    expect(screen.getByDisplayValue('写文件和 Shell 默认进入确认队列')).toBeInTheDocument();
    expect(screen.getByText('目标偏好')).toBeInTheDocument();
    expect(screen.getByText('工作区说明')).toBeInTheDocument();
    expect(screen.getByText('就绪')).toBeInTheDocument();

    // #1277 / #1280: AgentSpec fixture dump is not shown in default product detail
    expect(screen.queryByLabelText('Builder AgentSpec fixture')).not.toBeInTheDocument();
  });

  it('shows 未设置 placeholder on empty optional text fields (#1874)', () => {
    const [baseAgent] = WORKBENCH_AGENT_PROFILE_FIXTURES;
    const emptyTargetAgent = { ...baseAgent, targetPreference: undefined, targetPreferences: undefined };
    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={1}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[emptyTargetAgent]}
        selectedAgentId={emptyTargetAgent.id}
        allSkills={WORKBENCH_AGENT_SKILL_OPTIONS}
        allTools={WORKBENCH_AGENT_TOOL_OPTIONS}
      />,
    );
    expect(screen.getAllByPlaceholderText('未设置').length).toBeGreaterThan(0);
  });

  it('shows market profile configuration summaries before install', () => {
    render(
      <AgentsPage
        activePane="market"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        marketFeatured={WORKBENCH_AGENT_MARKET_FIXTURES.slice(0, 2)}
        marketTemplates={WORKBENCH_AGENT_MARKET_FIXTURES}
      />,
    );

    const builderCards = screen.getAllByText('Builder');
    expect(builderCards.length).toBeGreaterThan(0);
    expect(screen.getAllByText('Runtime').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Claude Code / TokenDance Gateway / DeepSeek-V4-Pro').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Skills').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Read File · Write File · Shell · Git Diff').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MCP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('filesystem · github').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Approval').length).toBeGreaterThan(0);
    expect(screen.getAllByText('写文件和 Shell 默认进入确认队列').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Target').length).toBeGreaterThan(0);
    expect(screen.getAllByText('local-edge · remote-edge').length).toBeGreaterThan(0);
  });
});

describe('AgentsPage empty states', () => {
  it('uses shared EmptyState for the installed empty path and wires the add CTA', () => {
    const onAgentAdd = vi.fn();

    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        agentsLoading={false}
        onAgentAdd={onAgentAdd}
      />,
    );

    const emptyState = screen.getByRole('region', { name: '暂无已安装 Agent' });
    expect(within(emptyState).getByText('当前 Hub 账号还没有已安装配置。')).toBeInTheDocument();
    fireEvent.click(within(emptyState).getByRole('button', { name: '添加 Agent' }));
    expect(onAgentAdd).toHaveBeenCalledTimes(1);
  });

  it('hides the installed empty path while agents are loading', () => {
    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        agentsLoading
      />,
    );

    expect(screen.queryByRole('region', { name: '暂无已安装 Agent' })).not.toBeInTheDocument();
    expect(screen.getByText('同步中')).toBeInTheDocument();
  });

  it('uses shared EmptyState for skill and MCP market empty paths', () => {
    const { rerender } = render(
      <AgentsPage
        activePane="skillMarket"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        skillMarketItems={[]}
        skillMarketLoading={false}
      />,
    );

    expect(screen.getByRole('region', { name: '暂无公共 Skill' })).toBeInTheDocument();

    rerender(
      <AgentsPage
        activePane="mcpMarket"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        mcpMarketItems={[]}
        mcpMarketLoading={false}
      />,
    );

    expect(screen.getByRole('region', { name: '暂无公共 MCP Server' })).toBeInTheDocument();
  });
});

describe('AgentsPage load/action status', () => {
  it('uses RecoveryPanel for hard load failure and wires retry', () => {
    const onAgentsRetry = vi.fn();

    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        agentsError="Hub AgentProfiles unavailable"
        onAgentsRetry={onAgentsRetry}
      />,
    );

    const recovery = screen.getByRole('alert', { name: 'Agent 加载失败' });
    expect(within(recovery).getByText('Hub AgentProfiles unavailable')).toBeInTheDocument();
    expect(within(recovery).getByText(/无法从当前 Hub 读取已安装配置/)).toBeInTheDocument();
    fireEvent.click(within(recovery).getByRole('button', { name: '重试' }));
    expect(onAgentsRetry).toHaveBeenCalledTimes(1);
  });

  it('suppresses installed EmptyState while load error is active', () => {
    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={[]}
        agentsError="Hub AgentProfiles unavailable"
      />,
    );

    expect(screen.queryByRole('region', { name: '暂无已安装 Agent' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'Agent 加载失败' })).toBeInTheDocument();
  });

  it('uses StatusNotice for soft load failure when agents remain visible', () => {
    const onAgentsRetry = vi.fn();

    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={1}
        runnableCount={1}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={WORKBENCH_AGENT_PROFILE_FIXTURES.slice(0, 1)}
        selectedAgentId={WORKBENCH_AGENT_PROFILE_FIXTURES[0]?.id}
        agentsError="Hub AgentProfiles refresh failed"
        onAgentsRetry={onAgentsRetry}
      />,
    );

    const notice = screen.getByRole('alert');
    expect(within(notice).getByText('Hub AgentProfiles refresh failed')).toBeInTheDocument();
    fireEvent.click(within(notice).getByRole('button', { name: '重试' }));
    expect(onAgentsRetry).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText(WORKBENCH_AGENT_PROFILE_FIXTURES[0]!.name).length).toBeGreaterThan(0);
  });

  it('uses StatusNotice for editor action errors', () => {
    render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={1}
        runnableCount={1}
        confirmCount={0}
        defaultModelLabel="DeepSeek-V4-Pro"
        agents={WORKBENCH_AGENT_PROFILE_FIXTURES.slice(0, 1)}
        selectedAgentId={WORKBENCH_AGENT_PROFILE_FIXTURES[0]?.id}
        agentActionError="保存失败"
      />,
    );

    const notice = screen.getByRole('alert');
    expect(within(notice).getByText('保存失败')).toBeInTheDocument();
  });
});

describe('AgentsPage data source badge', () => {
  it('renders a demo provenance badge when dataSource=demo', () => {
    const { container } = render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="—"
        agents={[]}
        dataSource="demo"
      />,
    );
    const badge = container.querySelector('[data-data-source="demo"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('Demo 数据');
  });

  it('renders nothing when dataSource=real', () => {
    const { container } = render(
      <AgentsPage
        activePane="installed"
        onPaneChange={() => undefined}
        installedCount={0}
        runnableCount={0}
        confirmCount={0}
        defaultModelLabel="—"
        agents={[]}
        dataSource="real"
      />,
    );
    expect(container.querySelector('[data-data-source]')).toBeNull();
  });
});
