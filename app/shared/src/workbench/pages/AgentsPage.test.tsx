import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '../../__tests__/setup';
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
