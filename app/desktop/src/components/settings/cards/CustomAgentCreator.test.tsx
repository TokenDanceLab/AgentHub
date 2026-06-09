import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CustomAgentCreator, { readCustomAgentDrafts } from './CustomAgentCreator';

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: () => <span data-testid="mock-claude-code-icon" />,
  Codex: () => <span data-testid="mock-codex-icon" />,
  GeminiCLI: () => <span data-testid="mock-gemini-cli-icon" />,
  ModelIcon: () => <span data-testid="mock-model-icon" />,
  OpenCode: () => <span data-testid="mock-opencode-icon" />,
  ProviderIcon: () => <span data-testid="mock-provider-icon" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (typeof values?.defaultValue === 'string') return values.defaultValue;
      const text: Record<string, string> = {
        'settings.agentCreator.title': 'Create custom Agent',
        'settings.agentCreator.desc': 'Build a local custom Agent draft.',
        'settings.agentCreator.close': 'Close',
        'settings.wizard.progress': `Step ${values?.current} of ${values?.total}`,
        'settings.wizard.step1': 'Basics',
        'settings.wizard.step1Desc': 'Identity and evidence',
        'settings.wizard.step2': 'Prompt',
        'settings.wizard.step2Desc': 'Prompt template',
        'settings.wizard.step3': 'Model',
        'settings.wizard.step3Desc': 'Model routing',
        'settings.wizard.step4': 'Tools',
        'settings.wizard.step4Desc': 'Tool permissions',
        'settings.wizard.step5': 'Test',
        'settings.wizard.step5Desc': 'Fixture preview',
        'settings.agentCreator.emoji': 'Icon',
        'settings.agentCreator.agentName': 'Agent name',
        'settings.agentCreator.agentNamePlaceholder': 'Name',
        'settings.agentCreator.description': 'Description',
        'settings.agentCreator.descriptionPlaceholder': 'Description',
        'settings.agentCreator.agentType': 'Agent type',
        'settings.agentCreator.typeAssistant': 'Assistant',
        'settings.agentCreator.typeCoder': 'Coder',
        'settings.agentCreator.typeReviewer': 'Reviewer',
        'settings.agentCreator.typeResearcher': 'Researcher',
        'settings.agentCreator.typeCustom': 'Custom',
        'settings.wizard.next': 'Next',
        'settings.wizard.finish': 'Save local draft',
        'settings.agentCreator.publishToHub': 'Publish to Hub',
        'settings.agentCreator.agentSpecPreview': 'AgentHubAgentSpec v1 preview',
        'settings.agentCreator.exportAgentSpec': 'Export AgentSpec fixture',
      };
      return text[key] ?? key;
    },
  }),
}));

vi.mock('./PublishAgentModal', () => ({
  default: () => null,
}));

describe('CustomAgentCreator', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('surfaces fixture-only runtime, profile, target, tool, and spend evidence in the builder draft', () => {
    const { container } = render(
      <CustomAgentCreator
        agents={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText('Fixture-only evidence')).toBeInTheDocument();
    expect(screen.getByText('Runtime profile: Codex local profile')).toBeInTheDocument();
    expect(screen.getByText('Provider/model: TokenDance Gateway / deepseek-v4-flash')).toBeInTheDocument();
    expect(screen.getByText('Tools/MCP: 6 tools, MCP adapter-ready')).toBeInTheDocument();
    expect(screen.getByText('Approval policy: workspace-write')).toBeInTheDocument();
    expect(screen.getByText('Workspace trust: trusted local workspace')).toBeInTheDocument();
    expect(screen.getByText('Target health: Local Edge fixture healthy')).toBeInTheDocument();
    expect(screen.getByText('No live SDK execution')).toBeInTheDocument();
    expect(screen.getByText('No model/API spend')).toBeInTheDocument();

    expect(container.querySelector('[data-runtime-icon-kind="runtime"]')).toHaveAttribute(
      'data-runtime-icon-source',
      'lobehub',
    );
  });

  it('persists no-spend fixture evidence into local draft tags', () => {
    render(
      <CustomAgentCreator
        agents={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Fixture Builder' } });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Save local draft' }));

    expect(readCustomAgentDrafts()).toEqual([
      expect.objectContaining({
        name: 'Fixture Builder',
        capabilities: expect.arrayContaining([
          'fixture-only',
          'adapter-ready',
          'no-spend',
          'runtime:codex-local-profile',
          'target:local-edge-fixture-healthy',
        ]),
      }),
    ]);
  });

  it('shows a fixture export preview for AgentHubAgentSpec v1 on the final step', () => {
    render(
      <CustomAgentCreator
        agents={[]}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'Fixture Builder' } });
    for (let i = 0; i < 4; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    }

    expect(screen.getByText('AgentHubAgentSpec v1 preview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export AgentSpec fixture' })).toBeInTheDocument();
    expect(screen.getByText(/"schema_version": "agenthub\.agent_spec\.v1"/)).toBeInTheDocument();
    expect(screen.getByText(/"tool_allowlist": \[/)).toBeInTheDocument();
    expect(screen.getByText(/"target_preference": \{/)).toBeInTheDocument();
    expect(screen.getByText(/"no_spend": true/)).toBeInTheDocument();
  });
});
