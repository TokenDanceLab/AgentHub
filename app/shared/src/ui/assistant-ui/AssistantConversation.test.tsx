import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantConversation, type AssistantConversationProps } from './AssistantConversation';
import type { AgentHubPlatform } from '../../platform';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function props(overrides: Partial<AssistantConversationProps> = {}): AssistantConversationProps {
  return {
    conversationId: 'conversation-1', transcript: [],
    platform: { runs: { submitComposerIntent: vi.fn().mockResolvedValue({ intentId: 'message-1' }) } } as unknown as AgentHubPlatform,
    intent: { conversationId: 'conversation-1', mode: 'ask', mentions: [], approvalMode: 'suggest' },
    welcome: 'Start a conversation', ...overrides,
  };
}

describe('AssistantConversation with the real assistant-ui runtime', () => {
  it('submits once through the platform and clears a successful draft', async () => {
    const input = props();
    render(<AssistantConversation {...input} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox', { name: 'Message input' }), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(input.platform.runs.submitComposerIntent).toHaveBeenCalledOnce());
    expect(input.platform.runs.submitComposerIntent).toHaveBeenCalledWith(expect.objectContaining({
      text: 'hello', conversationId: 'conversation-1', attachments: [],
    }));
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('keeps a failed draft available and displays the failure next to the composer', async () => {
    const input = props();
    vi.mocked(input.platform.runs.submitComposerIntent).mockRejectedValue(new Error('Connection lost'));
    render(<AssistantConversation {...input} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'keep this draft');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue('keep this draft'));
  });

  it('keeps human author identity and renders agent Markdown without fake edit/reload actions', async () => {
    render(<AssistantConversation {...props({ transcript: [
      { id: 'human-1', kind: 'text', author: { id: 'user-2', name: 'Mira', role: 'human' }, text: 'A **human** reply\n```python\nprint(42)\n```' },
      { id: 'agent-1', kind: 'text', author: { id: 'agent-2', name: 'Builder', role: 'agent' }, text: '**Finished** the task' },
    ] })} />);
    expect(await screen.findByText('Mira')).toHaveAttribute('data-author-role', 'human');
    expect(await screen.findByText('Finished', { selector: 'strong' })).toBeInTheDocument();
    expect(await screen.findByText('human', { selector: 'strong' })).toBeInTheDocument();
    expect(document.querySelector('pre code')).toHaveTextContent('print(42)');
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Refresh' })).not.toBeInTheDocument();
  });

  it('routes stop to the current run and does not submit another message while running', async () => {
    const onCancel = vi.fn();
    const input = props({ isRunning: true, onCancel });
    render(<AssistantConversation {...input} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Stop generating' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(input.platform.runs.submitComposerIntent).not.toHaveBeenCalled();
  });

  it('restores each conversation draft without sending it to the newly selected conversation', async () => {
    const first = props();
    const second = props({ conversationId: 'conversation-2', intent: { ...first.intent, conversationId: 'conversation-2' } });
    const view = render(<AssistantConversation key="first" {...first} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'first draft');
    view.rerender(<AssistantConversation key="second" {...second} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    await user.type(screen.getByRole('textbox'), 'second draft');
    view.rerender(<AssistantConversation key="first" {...first} />);
    expect(screen.getByRole('textbox')).toHaveValue('first draft');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await waitFor(() => expect(first.platform.runs.submitComposerIntent).toHaveBeenCalledWith(expect.objectContaining({ conversationId: 'conversation-1', text: 'first draft' })));
    expect(second.platform.runs.submitComposerIntent).not.toHaveBeenCalled();
  });

  it('retries only execution when the message was stored but agent dispatch failed', async () => {
    const input = props();
    vi.mocked(input.platform.runs.submitComposerIntent).mockResolvedValue({ intentId: 'stored-message', dispatchError: 'Executor disconnected' });
    input.platform.runs.redispatchTask = vi.fn().mockResolvedValue({ taskId: 'new-task' });
    render(<AssistantConversation {...input} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'run this');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.click(await screen.findByRole('button', { name: 'Retry agent' }));
    await waitFor(() => expect(input.platform.runs.redispatchTask).toHaveBeenCalledWith(expect.objectContaining({ text: 'run this' }), 'stored-message'));
    expect(input.platform.runs.submitComposerIntent).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('does not double-send while the first request is awaiting its response', async () => {
    const input = props();
    let finish!: (value: { intentId: string }) => void;
    vi.mocked(input.platform.runs.submitComposerIntent).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<AssistantConversation {...input} />);
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'first');
    await user.click(screen.getByRole('button', { name: 'Send message' }));
    await user.type(screen.getByRole('textbox'), 'second');
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
    finish({ intentId: 'message-1' });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send message' })).toBeEnabled());
    expect(input.platform.runs.submitComposerIntent).toHaveBeenCalledOnce();
  });
});
