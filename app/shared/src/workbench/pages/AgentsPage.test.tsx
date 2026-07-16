import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '../../__tests__/setup';
import {
  WORKBENCH_AGENT_MARKET_FIXTURES,
  WORKBENCH_AGENT_PROFILE_FIXTURES,
  WORKBENCH_AGENT_SKILL_OPTIONS,
  WORKBENCH_AGENT_TOOL_OPTIONS,
} from '../agentProfileCatalog';
import { AgentsPage } from './AgentsPage';

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
  it('shows Agent Builder config summaries for runtime, MCP, memory, approval, and target', () => {
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

    const summary = screen.getByLabelText('Builder 配置摘要');
    expect(within(summary).getByText('MCP')).toBeInTheDocument();
    expect(within(summary).getByText('filesystem · github')).toBeInTheDocument();
    expect(within(summary).getByText('Memory')).toBeInTheDocument();
    expect(within(summary).getAllByText(/AGENTS\.md/).length).toBeGreaterThan(0);
    expect(within(summary).getByText('Approval')).toBeInTheDocument();
    expect(within(summary).getByText(/workspace-write/)).toBeInTheDocument();
    expect(within(summary).getByText('Target')).toBeInTheDocument();
    expect(within(summary).getByText('local-edge · remote-edge')).toBeInTheDocument();

    expect(screen.getAllByTitle('Builder agenthub:avatar/builder').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/TokenDance Gateway \/ DeepSeek-V4-Pro/).length).toBeGreaterThan(0);
    expect(screen.getByText('MCP / Memory')).toBeInTheDocument();
    expect(screen.getByText('agents-md')).toBeInTheDocument();
    expect(screen.getByText('project-memory')).toBeInTheDocument();

    const specPanel = screen.getByLabelText('Builder AgentSpec fixture');
    expect(within(specPanel).getByText('no-spend')).toBeInTheDocument();
    expect(within(specPanel).getByText('claude-code · Claude Code')).toBeInTheDocument();
    expect(within(specPanel).getByText('TokenDance Gateway / DeepSeek-V4-Pro')).toBeInTheDocument();
    expect(within(specPanel).getByText('read_file · write_file · shell · git_diff · browser_screenshot')).toBeInTheDocument();
    expect(within(specPanel).getByText('project · project-policy')).toBeInTheDocument();
    expect(within(specPanel).getByText(/不导入 SDK、不启动 CLI、不调用模型/)).toBeInTheDocument();
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

    const emptyState = screen.getByRole('region', { name: '暂无 Agent Profile' });
    expect(within(emptyState).getByText('当前 Hub 账号还没有已安装 Agent。')).toBeInTheDocument();
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

    expect(screen.queryByRole('region', { name: '暂无 Agent Profile' })).not.toBeInTheDocument();
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
    expect(within(recovery).getByText(/无法从当前 Hub 读取已安装 Agent Profile/)).toBeInTheDocument();
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

    expect(screen.queryByRole('region', { name: '暂无 Agent Profile' })).not.toBeInTheDocument();
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
    expect(screen.getByText(WORKBENCH_AGENT_PROFILE_FIXTURES[0]!.name)).toBeInTheDocument();
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
