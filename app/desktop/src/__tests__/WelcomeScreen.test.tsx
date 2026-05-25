vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import WelcomeScreen from '@/components/WelcomeScreen';
import type { AgentInfo } from '@shared/types';

const mockAgents: AgentInfo[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic Claude Code CLI',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: false,
    },
  },
  {
    id: 'codex',
    name: 'Codex',
    description: 'OpenAI Codex CLI',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: true,
      fileChanges: true,
      thinkingVisible: true,
      multiTurn: true,
      mcpIntegration: true,
      permissionHooks: true,
      subAgentSpawn: true,
    },
  },
];

describe('WelcomeScreen', () => {
  it('renders when online with prompt suggestions', () => {
    render(
      <WelcomeScreen
        online={true}
        agents={mockAgents}
        selectedAgentId="claude-code"
        onCreateThread={vi.fn()}
        onSendMessage={vi.fn()}
      />,
    );

    expect(screen.getByText('welcome.eyebrow')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'welcome.headline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'welcome.runtime' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'welcome.profile' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'welcome.target' })).toBeInTheDocument();
    expect(screen.getByText('welcome.commandPlaceholderForAgent(runtime=Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('welcome.profileName(runtime=Claude Code)')).toBeInTheDocument();
    expect(screen.getByText('claude-opus-4-7')).toBeInTheDocument();
    expect(screen.getByText('anthropic')).toBeInTheDocument();
    expect(screen.getByText('welcome.localEdge')).toBeInTheDocument();
    expect(screen.getByText('welcome.approval')).toBeInTheDocument();
    expect(screen.getByText('welcome.tokendance')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestionsLabel')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestion1')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestion2')).toBeInTheDocument();
    expect(screen.getByText('welcome.suggestion3')).toBeInTheDocument();
  });

  it('calls onCreateThread when the command launcher is clicked', () => {
    const onCreateThread = vi.fn();
    render(
      <WelcomeScreen
        online={true}
        agents={mockAgents}
        selectedAgentId="claude-code"
        onCreateThread={onCreateThread}
        onSendMessage={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText('welcome.commandPlaceholderForAgent(runtime=Claude Code)'));
    expect(onCreateThread).toHaveBeenCalledTimes(1);
  });

  it('selects a Runtime and sends suggestions through the active Agent', () => {
    const onCreateThread = vi.fn();
    const onSendMessage = vi.fn();
    const onSelectAgent = vi.fn();
    render(
      <WelcomeScreen
        online={true}
        agents={mockAgents}
        selectedAgentId="claude-code"
        onSelectAgent={onSelectAgent}
        onCreateThread={onCreateThread}
        onSendMessage={onSendMessage}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'welcome.runtime' }));
    fireEvent.click(screen.getByText('Codex'));
    expect(onSelectAgent).toHaveBeenCalledWith('codex');

    fireEvent.click(screen.getByText('welcome.suggestion1'));

    expect(onCreateThread).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith('welcome.suggestion1', 'codex', { model: 'sonnet' });
    // onCreateThread must be called before onSendMessage
    expect(onCreateThread.mock.invocationCallOrder[0]).toBeLessThan(
      onSendMessage.mock.invocationCallOrder[0],
    );
  });
});
