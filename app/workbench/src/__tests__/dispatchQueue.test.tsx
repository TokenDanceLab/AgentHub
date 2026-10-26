import { installWorkbenchTestHooks } from './helpers';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';

installWorkbenchTestHooks();

describe('dispatch recovery through assistant-ui', () => {
  function setup(hasRetry = true) {
    const platform = createMockPlatform({ surface: 'web', conversations: [
      { id: 'team', title: 'Team', kind: 'group' }, { id: 'other', title: 'Other', kind: 'group' },
    ] });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'stored-message', turnInProgress: true });
    if (hasRetry) platform.runs.redispatchTask = vi.fn().mockResolvedValue({ taskId: 'task-1' });
    else delete platform.runs.redispatchTask;
    const props = { platform, conversations: platform.seed.conversations, activeConversationId: 'team', transcript: [],
      agents: [{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }] };
    const view = render(<AgentHubWorkbench {...props} />);
    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), { target: { value: 'continue' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    return { platform, props, view };
  }

  it('shows a recoverable dispatch failure and retries only the already stored message', async () => {
    const { platform } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '重试 Agent' }));
    await waitFor(() => expect(platform.runs.redispatchTask).toHaveBeenCalledWith(expect.objectContaining({ text: 'continue' }), 'stored-message'));
    expect(platform.runs.submitComposerIntent).toHaveBeenCalledOnce();
    expect(screen.getByRole('textbox', { name: '输入框' })).toHaveValue('');
  });

  it('keeps retry failures visible without silently resending or scheduling retries', async () => {
    const { platform } = setup();
    vi.mocked(platform.runs.redispatchTask!).mockRejectedValue(new Error('Executor offline'));
    fireEvent.click(await screen.findByRole('button', { name: '重试 Agent' }));
    expect(await screen.findByText(/Executor offline/)).toBeInTheDocument();
    expect(platform.runs.redispatchTask).toHaveBeenCalledOnce();
    expect(platform.runs.submitComposerIntent).toHaveBeenCalledOnce();
  });

  it('does not offer an unsupported retry action', async () => {
    setup(false);
    expect(await screen.findByText('消息已发送，Agent 尚未开始。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试 Agent' })).not.toBeInTheDocument();
  });

  it('does not expose a previous conversation recovery action after switching', async () => {
    const { props, view, platform } = setup();
    expect(await screen.findByRole('button', { name: '重试 Agent' })).toBeInTheDocument();
    view.rerender(<AgentHubWorkbench {...props} activeConversationId="other" />);
    expect(screen.queryByRole('button', { name: '重试 Agent' })).not.toBeInTheDocument();
    expect(platform.runs.redispatchTask).not.toHaveBeenCalled();
  });
});
