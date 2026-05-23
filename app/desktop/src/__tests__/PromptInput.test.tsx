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
import PromptInput from '@/components/PromptInput';
import type { AgentInfo } from '@shared/types';

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: 'agent-1',
    name: 'TestAgent',
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

describe('PromptInput', () => {
  it('renders input field with placeholder', () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );
    const input = screen.getByPlaceholderText('prompt.placeholder');
    expect(input).toBeInTheDocument();
  });

  it('calls onSend when send button is clicked with non-empty input', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder');
    fireEvent.change(input, { target: { value: 'Hello world' } });

    const sendBtn = screen.getByText('action.startRun');
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined);
  });

  it('calls onSend on Enter key', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder');
    fireEvent.change(input, { target: { value: 'Test message' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Test message', undefined);
  });

  it('does NOT call onSend when input is empty', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const sendBtn = screen.getByText('action.startRun');
    fireEvent.click(sendBtn);

    expect(onSend).not.toHaveBeenCalled();
  });

  it('does NOT call onSend on Enter with empty input', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  it('clears input after sending', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Clear me' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('opens agent selector when @Agent button is clicked', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    // Agent selector should not be visible initially
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Click the @Agent button
    const agentBtn = screen.getByText('@Agent');
    fireEvent.click(agentBtn);

    // Now the selector should appear
    expect(screen.getByRole('listbox')).toBeInTheDocument();
  });

  it('closes agent selector when @Agent button is clicked again', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const agentBtn = screen.getByText('@Agent');
    // Open
    fireEvent.click(agentBtn);
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    // Close
    fireEvent.click(agentBtn);
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('highlights selected agent in selector', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
    ];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId="a2"
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    // Open the selector
    const agentBtn = screen.getByText('@Beta');
    fireEvent.click(agentBtn);

    // Check that Beta is highlighted
    const options = screen.getAllByRole('option');
    const betaOption = options.find((opt) => opt.textContent?.includes('Beta'));
    expect(betaOption?.className).toContain('optionSelected');
    expect(betaOption).toHaveAttribute('aria-selected', 'true');
  });

  it('calls onSelectAgent when an agent is selected from the dropdown', () => {
    const onSelectAgent = vi.fn();
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
    ];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={onSelectAgent}
        onSend={vi.fn()}
      />,
    );

    // Open selector
    const agentBtn = screen.getByText('@Agent');
    fireEvent.click(agentBtn);

    // Click on Alpha
    fireEvent.click(screen.getByText('Alpha'));

    expect(onSelectAgent).toHaveBeenCalledWith('a1');
  });

  it('sends with agentId when an agent is selected', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId="a1"
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder');
    fireEvent.change(input, { target: { value: 'Do something' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Do something', 'a1');
  });

  it('disables send button when input is empty', () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const sendBtn = screen.getByText('action.startRun');
    expect(sendBtn).toBeDisabled();
  });

  it('enables send button when input has content', () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder');
    fireEvent.change(input, { target: { value: 'Hi' } });

    const sendBtn = screen.getByText('action.startRun');
    expect(sendBtn).not.toBeDisabled();
  });
});
