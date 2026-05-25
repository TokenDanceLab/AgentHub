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

vi.mock('@/components/ModelDropdown', () => ({
  default: ({ placeholder, disabled, ariaLabel }: { placeholder?: string; disabled?: boolean; ariaLabel?: string }) => (
    <button type="button" disabled={disabled} aria-label={ariaLabel}>
      {placeholder}
    </button>
  ),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PromptInput from '@/components/PromptInput';
import type { AgentInfo } from '@shared/types';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function typeInPrompt(input: HTMLElement, value: string) {
  fireEvent.input(input, { target: { value } });
}

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
      mcpIntegration: false,
      permissionHooks: false,
      subAgentSpawn: false,
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
    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
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

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Hello world');

    const sendBtn = screen.getByRole('button', { name: 'action.startRun' });
    fireEvent.click(sendBtn);

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Hello world', undefined, undefined);
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
    typeInPrompt(input, 'Test message');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('Test message', undefined, undefined);
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

    const sendBtn = screen.getByRole('button', { name: 'action.startRun' });
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

  it('clears input after sending', async () => {
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
    typeInPrompt(input, 'Clear me');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalled();
    await waitFor(() => expect(input.value).toBe(''));
  });

  it('keeps input when onSend rejects the send', async () => {
    const onSend = vi.fn().mockResolvedValue(false);
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    typeInPrompt(input, 'Keep me');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(input.value).toBe('Keep me');
  });

  it('disables composing controls while a run is starting', () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
        isStarting
      />,
    );

    expect(screen.getByPlaceholderText('prompt.placeholder')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'prompt.starting' })).toBeDisabled();
  });

  it('opens mention popover when @ is typed in textarea', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    // No popover initially
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    // Type @Alpha in the textarea — must focus first (useMention reads document.activeElement)
    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = ' @Alpha';
    input.selectionStart = 7;
    input.selectionEnd = 7;
    fireEvent.input(input);

    // Popover should appear with agent suggestion
    const listbox = screen.getByRole('listbox', { name: 'Agent suggestions' });
    expect(within(listbox).getByText('Alpha')).toBeInTheDocument();
  });

  it('closes mention popover on Escape key', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = ' @Alpha';
    input.selectionStart = 7;
    input.selectionEnd = 7;
    fireEvent.input(input);
    expect(screen.getByRole('listbox', { name: 'Agent suggestions' })).toBeInTheDocument();

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('shows selected agent badge when agent is selected', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(
      <PromptInput agents={agents} selectedAgentId="a2" onSelectAgent={vi.fn()} onSend={vi.fn()} />,
    );

    // Badge shows selected agent
    expect(screen.getByText('@Beta')).toBeInTheDocument();
  });

  it('calls onSelectAgent when agent is clicked from mention popover', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={onSelectAgent}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = ' @Alpha';
    input.selectionStart = 7;
    input.selectionEnd = 7;
    fireEvent.input(input);

    // Click Alpha in the popover
    const listbox = screen.getByRole('listbox', { name: 'Agent suggestions' });
    fireEvent.click(within(listbox).getByText('Alpha'));

    expect(onSelectAgent).toHaveBeenCalledWith('a1');
  });

  it('calls onSelectAgent when Enter is pressed on highlighted mention', () => {
    const onSelectAgent = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={onSelectAgent}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = ' @Alpha';
    input.selectionStart = 7;
    input.selectionEnd = 7;
    fireEvent.input(input);

    // Press Enter to select highlighted agent
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelectAgent).toHaveBeenCalledWith('a1');
  });

  it('navigates mention popover with ArrowDown and ArrowUp', () => {
    const agents = [
      makeAgent({ id: 'a1', name: 'Alpha' }),
      makeAgent({ id: 'a2', name: 'Beta' }),
      makeAgent({ id: 'a3', name: 'Gamma' }),
    ];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    // @ matches all three agents
    input.focus();
    input.value = ' @';
    input.selectionStart = 2;
    input.selectionEnd = 2;
    fireEvent.input(input);

    const options = screen.getAllByRole('option');
    // First item should be active by default (index 0)
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');

    // ArrowDown moves to second item
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(options[0]).toHaveAttribute('aria-selected', 'false');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    // ArrowUp moves back to first
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(options[1]).toHaveAttribute('aria-selected', 'false');
  });

  it('hides mention popover when query matches no agents', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput
        agents={agents}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    // @Z matches nothing
    input.value = ' @Z';
    input.selectionStart = 3;
    input.selectionEnd = 3;
    fireEvent.input(input);

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('sends with agentId when an agent is selected', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' })];
    render(
      <PromptInput agents={agents} selectedAgentId="a1" onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Do something');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Do something', 'a1', undefined);
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

    const sendBtn = screen.getByRole('button', { name: 'action.startRun' });
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

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Hi');

    const sendBtn = screen.getByRole('button', { name: 'action.startRun' });
    expect(sendBtn).not.toBeDisabled();
  });
});
