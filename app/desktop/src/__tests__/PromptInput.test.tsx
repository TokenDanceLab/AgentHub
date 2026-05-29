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
  default: ({
    placeholder,
    disabled,
    ariaLabel,
    onChange,
  }: {
    placeholder?: string;
    disabled?: boolean;
    ariaLabel?: string;
    onChange?: (value: string) => void;
  }) => (
    <button
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={() => {
        if (ariaLabel === 'prompt.model') onChange?.('claude-opus-4-7');
        if (ariaLabel === 'prompt.reasoning') onChange?.('max');
      }}
    >
      {placeholder}
    </button>
  ),
}));

vi.mock('@lobehub/icons', () => ({
  Claude: ({ size = 18 }: { size?: number }) => <svg data-testid="claude-icon" width={size} height={size} />,
  ClaudeCode: ({ size = 18 }: { size?: number }) => <svg data-testid="claude-code-icon" width={size} height={size} />,
  Codex: ({ size = 18 }: { size?: number }) => <svg data-testid="codex-icon" width={size} height={size} />,
  DeepSeek: ({ size = 18 }: { size?: number }) => <svg data-testid="deepseek-icon" width={size} height={size} />,
  Doubao: ({ size = 18 }: { size?: number }) => <svg data-testid="doubao-icon" width={size} height={size} />,
  Kimi: ({ size = 18 }: { size?: number }) => <svg data-testid="kimi-icon" width={size} height={size} />,
  Minimax: ({ size = 18 }: { size?: number }) => <svg data-testid="minimax-icon" width={size} height={size} />,
  OpenAI: ({ size = 18 }: { size?: number }) => <svg data-testid="openai-icon" width={size} height={size} />,
  OpenCode: ({ size = 18 }: { size?: number }) => <svg data-testid="opencode-icon" width={size} height={size} />,
  Qwen: ({ size = 18 }: { size?: number }) => <svg data-testid="qwen-icon" width={size} height={size} />,
  XiaomiMiMo: ({ size = 18 }: { size?: number }) => <svg data-testid="xiaomi-mimo-icon" width={size} height={size} />,
  Zhipu: ({ size = 18 }: { size?: number }) => <svg data-testid="zhipu-icon" width={size} height={size} />,
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import PromptInput from '@/components/PromptInput';
import { useModelSettingsStore } from '@/stores/modelSettingsStore';
import type { AgentInfo, ThreadInfo } from '@shared/types';
import type { ModelCatalogResponse } from '@/api/modelCatalogQueries';
import { open as openDialog } from '@tauri-apps/plugin-dialog';

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

function makeThread(overrides: Partial<ThreadInfo> = {}): ThreadInfo {
  return {
    threadId: 'thread-1',
    projectId: 'default',
    title: 'Research Thread',
    status: 'active',
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    ...overrides,
  };
}

function makeModelCatalog(items: ModelCatalogResponse['items']): ModelCatalogResponse {
  return {
    items,
    sources: [{ id: 'test-source', label: 'Test source', status: 'ready' }],
  };
}

describe('PromptInput', () => {
  beforeEach(() => {
    localStorage.clear();
    useModelSettingsStore.getState().reset();
    vi.mocked(openDialog).mockReset();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: undefined,
      configurable: true,
    });
  });

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

  it('does not send on Shift+Enter', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    typeInPrompt(input, 'Line one');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });

    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe('Line one');
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

  it('does not restore a sent prompt from a stale draft timer', async () => {
    vi.useFakeTimers();
    try {
      const onSend = vi.fn().mockResolvedValue(true);
      render(
        <PromptInput
          agents={[]}
          selectedAgentId={undefined}
          onSelectAgent={vi.fn()}
          onSend={onSend}
          threadId="thread-clear"
        />,
      );

      const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
      typeInPrompt(input, 'Do not come back');
      fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

      await act(async () => {
        await Promise.resolve();
      });
      expect(input.value).toBe('');

      await act(async () => {
        vi.advanceTimersByTime(600);
        await Promise.resolve();
      });

<<<<<<< HEAD
      expect(localStorage.getItem('draft_thread-clear')).toBeNull();
=======
      expect(localStorage.getItem('ah:draft:thread-clear')).toBeNull();
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
    } finally {
      vi.useRealTimers();
    }
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

  it('shows selected agent in the composer placeholder when agent is selected', () => {
    const agents = [makeAgent({ id: 'a1', name: 'Alpha' }), makeAgent({ id: 'a2', name: 'Beta' })];
    render(
      <PromptInput agents={agents} selectedAgentId="a2" onSelectAgent={vi.fn()} onSend={vi.fn()} />,
    );

    expect(screen.getByPlaceholderText('prompt.placeholder @Beta...')).toBeInTheDocument();
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

  it('uses @file mention to trigger the real attachment entry', async () => {
    const clickSpy = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = ' @file';
    input.selectionStart = 6;
    input.selectionEnd = 6;
    fireEvent.input(input);

    const listbox = screen.getByRole('listbox', { name: 'Agent suggestions' });
    fireEvent.click(within(listbox).getByRole('button', { name: /prompt\.mention\.attachFile/ }));

    expect(input.value).toBe('');
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    clickSpy.mockRestore();
  });

  it('uses @thread mention to insert a sendable thread reference', () => {
    render(
      <PromptInput
        agents={[]}
        threads={[makeThread({ threadId: 'thread_a', title: 'Planning g thread' })]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText('prompt.placeholder') as HTMLTextAreaElement;
    input.focus();
    input.value = 'Use @thread';
    input.selectionStart = 11;
    input.selectionEnd = 11;
    fireEvent.input(input);

    const listbox = screen.getByRole('listbox', { name: 'Agent suggestions' });
    fireEvent.click(within(listbox).getByRole('button', { name: /Planning g thread/ }));

    expect(input.value).toBe('Use @thread(Planning g thread thread_a) ');
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

  it('shows the selected Codex profile route when no model is manually selected', () => {
    const agents = [makeAgent({ id: 'codex', name: 'Codex Runtime' })];
    render(
      <PromptInput agents={agents} selectedAgentId="codex" onSelectAgent={vi.fn()} onSend={vi.fn()} />,
    );

    const route = screen.getByLabelText('prompt.routePreview');
    expect(route).toHaveAttribute('title', 'TokenDance');
    const picker = screen.getByRole('button', { name: 'prompt.modelReasoning' });
    expect(picker).toHaveTextContent('gpt-5.5');
    expect(picker).toHaveTextContent('prompt.reasoning.high');
  });

  it('sends the selected Codex profile alias when no model is manually selected', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'codex', name: 'Codex Runtime' })];
    render(
      <PromptInput agents={agents} selectedAgentId="codex" onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Route through Codex');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Route through Codex', 'codex', { model: 'gpt-5.5' });
  });

  it('sends a selected local working directory with the run request', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    const workDirInput = screen.getByLabelText('prompt.targetFolder');
    fireEvent.change(workDirInput, { target: { value: 'D:\\Code\\TokenDance\\AgentHub' } });
    fireEvent.click(screen.getByRole('button', { name: 'prompt.applyWorkDir' }));

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Run inside selected folder');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith(
      'Run inside selected folder',
      undefined,
      { workDir: 'D:\\Code\\TokenDance\\AgentHub' },
    );
  });

  it('uses the native Desktop directory picker for workDir when Tauri is available', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    vi.mocked(openDialog).mockResolvedValue('D:\\Code\\TokenDance\\AgentHub');
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    fireEvent.click(screen.getByRole('button', { name: 'prompt.browseWorkDir' }));

    await waitFor(() => expect(openDialog).toHaveBeenCalledWith({ directory: true, multiple: false }));

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Run in picked folder');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith(
      'Run in picked folder',
      undefined,
      { workDir: 'D:\\Code\\TokenDance\\AgentHub' },
    );
  });

  it('keeps the native workDir picker disabled in browser QA', () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));

    expect(screen.getByRole('button', { name: 'prompt.browseWorkDir' })).toBeDisabled();
  });

  it('selects browser fallback file attachments and sends their content context', async () => {
    const onSend = vi.fn();
    const file = new File(['attachment-token: alpha-123'], 'notes.txt', { type: 'text/plain' });
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    const attachInput = screen.getByTestId('prompt-attachment-input');
    fireEvent.change(attachInput, { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('notes.txt')).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Read the attachment');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toContain('Read the attachment');
    expect(onSend.mock.calls[0]?.[0]).toContain('Attached files:');
    expect(onSend.mock.calls[0]?.[0]).toContain('notes.txt');
    expect(onSend.mock.calls[0]?.[0]).toContain('attachment-token: alpha-123');
  });

  it('removes selected browser fallback attachments before sending', async () => {
    const onSend = vi.fn();
    const file = new File(['attachment-token: remove-me'], 'remove-me.txt', { type: 'text/plain' });
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.change(screen.getByTestId('prompt-attachment-input'), { target: { files: [file] } });

    await waitFor(() => expect(screen.getByText('remove-me.txt')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /prompt\.removeAttachment/ }));

    await waitFor(() => expect(screen.queryByText('remove-me.txt')).not.toBeInTheDocument());

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Send without removed attachment');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]?.[0]).toBe('Send without removed attachment');
  });

  it('uses a registered local execution target workspace root', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        executionTargets={[{
          id: 'target-local',
          name: 'Local dev workspace',
          target_type: 'local_edge',
          workspace_root: 'D:\\Code\\TokenDance\\AgentHub',
          workspace_allowlist: ['D:\\Code\\TokenDance'],
          trust_level: 'local',
          health_state: 'healthy',
          is_online: true,
        }]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    fireEvent.click(screen.getByRole('button', { name: /Local dev workspace/ }));

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Run on registered target');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith(
      'Run on registered target',
      undefined,
      { workDir: 'D:\\Code\\TokenDance\\AgentHub' },
    );
<<<<<<< HEAD
  });

  it('persists and reuses recent local workspaces without sending a target id', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    fireEvent.change(screen.getByLabelText('prompt.targetFolder'), {
      target: { value: 'D:\\Code\\TokenDance\\AgentHub' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'prompt.applyWorkDir' }));

    expect(JSON.parse(localStorage.getItem('agenthub.prompt.recentWorkDirs') ?? '[]')).toEqual([
      'D:\\Code\\TokenDance\\AgentHub',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    expect(screen.getByText('prompt.targetRecentWorkspaces')).toBeInTheDocument();
    expect(screen.getByText('prompt.targetRecentRunWorkDir')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Run from recent workspace');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith(
      'Run from recent workspace',
      undefined,
      { workDir: 'D:\\Code\\TokenDance\\AgentHub' },
    );
    expect(onSend.mock.calls[0]?.[2]).not.toHaveProperty('targetId');
  });

  it('shows remote and cloud execution targets as disabled inventory only', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        executionTargets={[{
          id: 'target-ssh',
          name: 'Remote SSH lab',
          target_type: 'remote_ssh',
          workspace_root: '/srv/project',
          workspace_allowlist: ['/srv'],
          trust_level: 'remote',
          health_state: 'healthy',
          is_online: true,
        }, {
          id: 'target-cloud',
          name: 'Cloud runner',
          target_type: 'cloud_edge',
          workspace_allowlist: [],
          trust_level: 'cloud',
          health_state: 'unknown',
          is_online: false,
        }]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));

    expect(screen.getByText('prompt.targetRemoteInventory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remote SSH lab/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cloud runner/ })).toBeDisabled();
    expect(screen.getByText('prompt.targetRemoteDisabled(type=remote_ssh)')).toBeInTheDocument();
    expect(screen.getByText('prompt.targetNoWorkspace')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Remote targets should not be selected');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith('Remote targets should not be selected', undefined, undefined);
=======
>>>>>>> 6aa56f6 (fix(desktop): 收敛聊天和本地编排基础)
  });

  it('persists and reuses recent local workspaces without sending a target id', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    fireEvent.change(screen.getByLabelText('prompt.targetFolder'), {
      target: { value: 'D:\\Code\\TokenDance\\AgentHub' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'prompt.applyWorkDir' }));

    expect(JSON.parse(localStorage.getItem('agenthub.prompt.recentWorkDirs') ?? '[]')).toEqual([
      'D:\\Code\\TokenDance\\AgentHub',
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));
    expect(screen.getByText('prompt.targetRecentWorkspaces')).toBeInTheDocument();
    expect(screen.getByText('prompt.targetRecentRunWorkDir')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Run from recent workspace');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith(
      'Run from recent workspace',
      undefined,
      { workDir: 'D:\\Code\\TokenDance\\AgentHub' },
    );
    expect(onSend.mock.calls[0]?.[2]).not.toHaveProperty('targetId');
  });

  it('shows remote and cloud execution targets as disabled inventory only', () => {
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        executionTargets={[{
          id: 'target-ssh',
          name: 'Remote SSH lab',
          target_type: 'remote_ssh',
          workspace_root: '/srv/project',
          workspace_allowlist: ['/srv'],
          trust_level: 'remote',
          health_state: 'healthy',
          is_online: true,
        }, {
          id: 'target-cloud',
          name: 'Cloud runner',
          target_type: 'cloud_edge',
          workspace_allowlist: [],
          trust_level: 'cloud',
          health_state: 'unknown',
          is_online: false,
        }]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.workTarget' }));

    expect(screen.getByText('prompt.targetRemoteInventory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Remote SSH lab/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Cloud runner/ })).toBeDisabled();
    expect(screen.getByText('prompt.targetRemoteDisabled(type=remote_ssh)')).toBeInTheDocument();
    expect(screen.getByText('prompt.targetNoWorkspace')).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Remote targets should not be selected');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith('Remote targets should not be selected', undefined, undefined);
  });

  it('lets a manually selected model override the selected agent profile alias', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'codex', name: 'Codex Runtime' })];
    const modelCatalog = makeModelCatalog([{
      id: 'codex-config:model',
      value: 'deepseek-v4-pro',
      label: 'deepseek-v4-pro',
      provider: 'TokenDance Gateway',
      runtimeId: 'codex',
      resolvedModel: 'deepseek-v4-pro',
      sourceId: 'codex-config',
      sourceLabel: 'Codex config',
      status: 'configured',
    }]);
    render(
      <PromptInput agents={agents} modelCatalog={modelCatalog} selectedAgentId="codex" onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.modelReasoning' }));
    fireEvent.click(screen.getByText('deepseek-v4-pro'));
    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Use manual model');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Use manual model', 'codex', {
      model: 'deepseek-v4-pro',
      provider: 'tokendance-gateway',
    });
  });

  it('sends a catalog mapping with its resolved model and provider identity', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'claude-code', name: 'Claude Code' })];
    const modelCatalog = makeModelCatalog([{
      id: 'claude-settings:ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: 'opus[1m]',
      label: 'deepseek-v4-pro',
      provider: 'Claude Code',
      runtimeId: 'claude-code',
      resolvedModel: 'claude-opus-4-7[1M]',
      sourceId: 'claude-settings',
      sourceLabel: 'Claude Code settings',
      status: 'configured',
    }]);
    render(
      <PromptInput agents={agents} modelCatalog={modelCatalog} selectedAgentId="claude-code" onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.modelReasoning' }));
    expect(screen.queryByText('deepseek-v4-pro -> claude-opus-4-7[1M]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('deepseek-v4-pro'));
    const input = screen.getByPlaceholderText(/prompt\.placeholder/);
    typeInPrompt(input, 'Use Claude mapping');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('Use Claude mapping', 'claude-code', {
      model: 'claude-opus-4-7[1M]',
      modelAlias: 'opus[1m]',
      provider: 'claude-code',
    });
  });

  it('scopes and deduplicates orchestrator model routes to readable runtime mappings', () => {
    const agents = [makeAgent({ id: 'orchestrator', name: 'Orchestrator' })];
    const modelCatalog = makeModelCatalog([
      {
        id: 'edge-adapter:orchestrator',
        value: 'claude-sonnet-4-6',
        label: 'Orchestrator default',
        provider: 'Claude Code',
        runtimeId: 'orchestrator',
        resolvedModel: 'claude-sonnet-4-6',
        sourceId: 'edge-adapter',
        sourceLabel: 'Edge default mapping',
        status: 'configured',
      },
      {
        id: 'claude-settings:ANTHROPIC_DEFAULT_SONNET_MODEL',
        value: 'sonnet',
        label: 'Claude settings route',
        provider: 'Claude Code',
        runtimeId: 'claude-code',
        resolvedModel: 'claude-sonnet-4-6',
        sourceId: 'claude-settings',
        sourceLabel: 'Claude Code settings',
        status: 'configured',
      },
      {
        id: 'codex-config:model',
        value: 'gpt-5.5',
        label: 'Codex config route',
        provider: 'TokenDance Gateway',
        runtimeId: 'codex',
        resolvedModel: 'gpt-5.5',
        sourceId: 'codex-config',
        sourceLabel: 'Codex config',
        status: 'configured',
      },
      {
        id: 'opencode-default:deepseek',
        value: 'newapi/deepseek-v4-pro',
        label: 'OpenCode direct route',
        provider: 'TokenDance Gateway',
        runtimeId: 'opencode',
        resolvedModel: 'newapi/deepseek-v4-pro',
        sourceId: 'edge-adapter',
        sourceLabel: 'Edge default mapping',
        status: 'configured',
      },
    ]);
    render(
      <PromptInput agents={agents} modelCatalog={modelCatalog} selectedAgentId="orchestrator" onSelectAgent={vi.fn()} onSend={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'prompt.modelReasoning' }));

    expect(screen.getAllByText('Claude Sonnet 4.6')).toHaveLength(2);
    expect(document.querySelectorAll('button[aria-current="true"]')).toHaveLength(1);
    expect(screen.queryByText('Team')).not.toBeInTheDocument();
    expect(screen.queryByText('Settings')).not.toBeInTheDocument();
    expect(screen.queryByText(/Codex config route/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenCode direct route/)).not.toBeInTheDocument();
  });

  it('shows TokenDance routes without leaking the newapi prefix or Gateway wording', () => {
    const agents = [makeAgent({ id: 'opencode', name: 'OpenCode Runtime' })];
    const modelCatalog = makeModelCatalog([{
      id: 'opencode-default:deepseek',
      value: 'newapi/deepseek-v4-pro',
      label: 'newapi/deepseek-v4-pro',
      provider: 'TokenDance Gateway',
      runtimeId: 'opencode',
      resolvedModel: 'newapi/deepseek-v4-pro',
      sourceId: 'edge-adapter',
      sourceLabel: 'Edge default mapping',
      status: 'configured',
      default: true,
    }]);
    render(
      <PromptInput agents={agents} modelCatalog={modelCatalog} selectedAgentId="opencode" onSelectAgent={vi.fn()} onSend={vi.fn()} />,
    );

    const route = screen.getByLabelText('prompt.routePreview');
    expect(route).toHaveAttribute('title', 'TokenDance');
    expect(within(route).queryByText('TokenDance Gateway')).not.toBeInTheDocument();

    const picker = screen.getByRole('button', { name: 'prompt.modelReasoning' });
    expect(picker).toHaveTextContent('deepseek-v4-pro');
    expect(picker).not.toHaveTextContent('newapi/');
    expect(picker).not.toHaveTextContent('Gateway');
  });

  it('uses slash commands to switch the active agent without sending the command text', () => {
    const onSelectAgent = vi.fn();
    const agents = [
      makeAgent({ id: 'orchestrator', name: 'Orchestrator' }),
      makeAgent({ id: 'codex', name: 'Codex' }),
    ];
    render(
      <PromptInput agents={agents} selectedAgentId={undefined} onSelectAgent={onSelectAgent} onSend={vi.fn()} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    input.focus();
    input.value = '/';
    input.selectionStart = 1;
    input.selectionEnd = 1;
    fireEvent.input(input);

    expect(screen.getByRole('listbox', { name: 'prompt.slash.commands' })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('slash-command-agent-orchestrator'));

    expect(onSelectAgent).toHaveBeenCalledWith('orchestrator');
    expect(input.value).toBe('');
  });

  it('uses slash commands to select a catalog model route', () => {
    const onSend = vi.fn();
    const agents = [makeAgent({ id: 'claude-code', name: 'Claude Code' })];
    const modelCatalog = makeModelCatalog([{
      id: 'claude-settings:ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: 'opus[1m]',
      label: 'deepseek-v4-pro',
      provider: 'Claude Code',
      runtimeId: 'claude-code',
      resolvedModel: 'claude-opus-4-7[1M]',
      sourceId: 'claude-settings',
      sourceLabel: 'Claude Code settings',
      status: 'configured',
    }]);
    render(
      <PromptInput agents={agents} modelCatalog={modelCatalog} selectedAgentId="claude-code" onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    input.focus();
    input.value = '/deep';
    input.selectionStart = 5;
    input.selectionEnd = 5;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-model-claude-settings-ANTHROPIC_DEFAULT_OPUS_MODEL'));

    expect(input.value).toBe('');

    typeInPrompt(input, 'Use slash selected model');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith('Use slash selected model', 'claude-code', {
      model: 'claude-opus-4-7[1M]',
      modelAlias: 'opus[1m]',
      provider: 'claude-code',
    });
  });

  it('shows active run settings from slash commands and lets users clear them before sending', () => {
    const onSend = vi.fn();
    const modelCatalog = makeModelCatalog([{
      id: 'claude-settings:ANTHROPIC_DEFAULT_OPUS_MODEL',
      value: 'opus[1m]',
      label: 'deepseek-v4-pro',
      provider: 'Claude Code',
      runtimeId: 'claude-code',
      resolvedModel: 'claude-opus-4-7[1M]',
      sourceId: 'claude-settings',
      sourceLabel: 'Claude Code settings',
      status: 'configured',
    }]);
    render(
      <PromptInput agents={[]} modelCatalog={modelCatalog} selectedAgentId={undefined} onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    input.focus();
    input.value = '/deep';
    input.selectionStart = 5;
    input.selectionEnd = 5;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-model-claude-settings-ANTHROPIC_DEFAULT_OPUS_MODEL'));

    input.value = '/bypass';
    input.selectionStart = 7;
    input.selectionEnd = 7;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-permission-bypassPermissions'));

    const strip = screen.getByTestId('prompt-active-run-settings');
    expect(within(strip).getByText('prompt.activeSetting.model')).toBeInTheDocument();
    expect(within(strip).getByText('deepseek-v4-pro')).toBeInTheDocument();
    expect(within(strip).getByText('prompt.activeSetting.permission')).toBeInTheDocument();
    expect(within(strip).getByText('prompt.permission.bypassPermissions')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'prompt.clearModelRoute' }));
    fireEvent.click(screen.getByRole('button', { name: 'prompt.clearPermissionMode' }));
    expect(screen.queryByTestId('prompt-active-run-settings')).not.toBeInTheDocument();

    typeInPrompt(input, 'Run with defaults');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith('Run with defaults', undefined, undefined);
  });

  it('uses slash commands to set reasoning and open the workspace selector', () => {
    const onSend = vi.fn();
    render(
      <PromptInput agents={[]} selectedAgentId={undefined} onSelectAgent={vi.fn()} onSend={onSend} />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    input.focus();
    input.value = '/low';
    input.selectionStart = 4;
    input.selectionEnd = 4;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-reasoning-low'));

    typeInPrompt(input, 'Use low reasoning');
    fireEvent.click(screen.getByRole('button', { name: 'action.startRun' }));

    expect(onSend).toHaveBeenCalledWith('Use low reasoning', undefined, { reasoningEffort: 'low' });

    input.focus();
    input.value = '/workspace';
    input.selectionStart = 10;
    input.selectionEnd = 10;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-workspace-open'));

    expect(screen.getByRole('dialog', { name: 'prompt.workTarget' })).toBeInTheDocument();
  });

  it('uses slash commands to retry and fork without sending slash text', () => {
    const onRetryLast = vi.fn();
    const onForkThread = vi.fn();
    const onSend = vi.fn();
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={onSend}
        onRetryLast={onRetryLast}
        onForkThread={onForkThread}
      />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    input.focus();
    input.value = '/retry';
    input.selectionStart = 6;
    input.selectionEnd = 6;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-retry'));

    expect(onRetryLast).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe('');

    input.value = '/fork';
    input.selectionStart = 5;
    input.selectionEnd = 5;
    fireEvent.input(input);
    fireEvent.click(screen.getByTestId('slash-command-fork'));

    expect(onForkThread).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe('');
  });

  it('accepts an external composer draft for forked threads', async () => {
    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
        threadId="thread-fork"
      />,
    );

    const input = screen.getByPlaceholderText(/prompt\.placeholder/) as HTMLTextAreaElement;
    window.dispatchEvent(new CustomEvent('agenthub:set-composer-draft', {
      detail: { text: 'Forked from: Local Thread\n\nContinue from this request:\nhello' },
    }));

    await waitFor(() => {
      expect(input.value).toContain('Forked from: Local Thread');
      expect(input.value).toContain('hello');
    });
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

  it('shows the resolved model route from persisted settings', () => {
    useModelSettingsStore.getState().setDefaultModel('gpt-5.5');
    useModelSettingsStore.getState().setDefaultProvider('openai');
    useModelSettingsStore.getState().setReasoningEffort('max');

    render(
      <PromptInput
        agents={[]}
        selectedAgentId={undefined}
        onSelectAgent={vi.fn()}
        onSend={vi.fn()}
      />,
    );

    const route = screen.getByLabelText('prompt.routePreview');
    expect(route).toHaveAttribute('title', 'openai');
    const picker = screen.getByRole('button', { name: 'prompt.modelReasoning' });
    expect(picker).toHaveTextContent('gpt-5.5');
    expect(picker).toHaveTextContent('prompt.reasoning.max');
  });
});
