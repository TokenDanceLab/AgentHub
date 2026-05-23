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

vi.mock('lucide-react', () => {
  const Stub = () => null;
  return new Proxy({}, { get: () => Stub });
});

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
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
    ];
    render(<AgentList agents={agents} online={true} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('highlights selected agent', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
    ];
    render(<AgentList agents={agents} online={true} selectedId="a1" />);
    const buttons = screen.getAllByRole('button');
    const selectedBtn = buttons.find((btn) => btn.textContent?.includes('Alpha'));
    expect(selectedBtn?.className).toContain('selected');
    expect(selectedBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('does not highlight non-selected agents', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
    ];
    render(<AgentList agents={agents} online={true} selectedId="a1" />);
    const notSelectedBtn = screen.getByText('Beta').closest('button');
    expect(notSelectedBtn?.className).not.toContain('selected');
  });

  it('shows capability tags for agents', () => {
    const agents = [
      makeAgent({
        id: 'a1',
        name: 'CapAgent',
        capabilities: {
          streaming: true,
          toolCalls: true,
          fileChanges: false,
          thinkingVisible: false,
          multiTurn: false,
        },
      }),
    ];
    render(<AgentList agents={agents} online={true} />);
    expect(screen.getByText('agent.capability.streaming')).toBeInTheDocument();
    expect(screen.getByText('agent.capability.toolCalls')).toBeInTheDocument();
  });

  it('calls onSelect when an agent is clicked', () => {
    const onSelect = vi.fn();
    const agent = makeAgent({ id: 'a1', name: 'ClickMe' });
    render(<AgentList agents={[agent]} online={true} onSelect={onSelect} />);
    fireEvent.click(screen.getByText('ClickMe'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(agent);
  });

  it('renders title', () => {
    render(<AgentList agents={[]} online={false} />);
    expect(screen.getByText('agent.title')).toBeInTheDocument();
  });
});
