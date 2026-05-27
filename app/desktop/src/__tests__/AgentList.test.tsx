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

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => <span data-testid="claude-icon" style={{ width: size, height: size }} />,
  Codex: ({ size }: { size?: number }) => <span data-testid="codex-icon" style={{ width: size, height: size }} />,
  OpenCode: ({ size }: { size?: number }) => <span data-testid="opencode-icon" style={{ width: size, height: size }} />,
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import AgentList from '@/components/AgentList';
import type { AgentInfo } from '@shared/types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'Default Agent',
    status: 'available',
    capabilities: {
      streaming: true,
      toolCalls: false,
      fileChanges: false,
      thinkingVisible: false,
      multiTurn: false,
      mcpIntegration: false,
      permissionHooks: false,
      subAgentSpawn: false,
    },
    ...overrides,
  };
}

describe('AgentList', () => {
  it('renders empty state when agents array is empty and online', () => {
    render(<AgentList agents={[]} online={true} />);
    expect(screen.getByText('agent.emptyOnline')).toBeInTheDocument();
  });

  it('renders empty state when agents array is empty and offline', () => {
    render(<AgentList agents={[]} online={false} />);
    expect(screen.getByText('agent.emptyOffline')).toBeInTheDocument();
  });

  it('renders list of agents with names', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Codex' }), makeAgent({ id: 'a2', name: 'Claude Code' })];
    render(<AgentList agents={agents} online={true} />);
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('orders primary runtimes and hides unknown runtimes behind Other by default', () => {
    const agents = [
      makeAgent({ id: 'open', name: 'OpenCode' }),
      makeAgent({ id: 'custom', name: 'Custom Runtime' }),
      makeAgent({ id: 'claude', name: 'Claude Code' }),
      makeAgent({ id: 'codex', name: 'Codex' }),
    ];
    render(<AgentList agents={agents} online={true} />);

    const runtimeButtons = screen
      .getAllByRole('button')
      .map((button) => button.textContent ?? '')
      .filter((text) => /Codex|Claude Code|OpenCode|Custom Runtime|agent\.runtime\.other/.test(text));

    expect(runtimeButtons[0]).toContain('Codex');
    expect(runtimeButtons[1]).toContain('Claude Code');
    expect(runtimeButtons[2]).toContain('OpenCode');
    expect(screen.queryByText('Custom Runtime')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /agent\.runtime\.other/ }));
    expect(screen.getByText('Custom Runtime')).toBeInTheDocument();
  });

  it('highlights selected agent', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Codex' }), makeAgent({ id: 'a2', name: 'Claude Code' })];
    render(<AgentList agents={agents} online={true} selectedId="a1" />);
    const buttons = screen.getAllByRole('button');
    const selectedBtn = buttons.find((btn) => btn.textContent?.includes('Codex'));
    expect(selectedBtn?.className).toContain('selected');
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not highlight non-selected agents', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Codex' }), makeAgent({ id: 'a2', name: 'Claude Code' })];
    render(<AgentList agents={agents} online={true} selectedId="a1" />);
    const notSelectedBtn = screen.getByText('Claude Code').closest('button');
    expect(notSelectedBtn?.className).not.toContain('selected');
  });

  it('keeps runtime rows compact without capability or adapter tags', () => {
    const agents = [
      makeAgent({
        id: 'a1',
        name: 'Codex',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: false,
          thinkingVisible: false,
          multiTurn: false,
          mcpIntegration: false,
          permissionHooks: false,
          subAgentSpawn: false,
        },
      }),
    ];
    render(<AgentList agents={agents} online={true} />);
    expect(screen.getByText('Codex')).toBeInTheDocument();
    expect(screen.queryByText('agent.runtime.localEdge')).not.toBeInTheDocument();
    expect(screen.queryByText('agent.runtime.cliAdapter')).not.toBeInTheDocument();
    expect(screen.queryByText('agent.capability.streaming')).not.toBeInTheDocument();
    expect(screen.queryByText('agent.capability.toolCalls')).not.toBeInTheDocument();
  });

  it('calls onSelect when an agent is clicked', () => {
    const onSelect = vi.fn();
    const agent = makeAgent({ id: 'a1', name: 'Codex' });
    render(<AgentList agents={[agent]} online={true} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('Codex'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('a1');
  });

  it('renders title', () => {
    render(<AgentList agents={[]} online={false} />);
    expect(screen.getByText('agent.title')).toBeInTheDocument();
  });
});
