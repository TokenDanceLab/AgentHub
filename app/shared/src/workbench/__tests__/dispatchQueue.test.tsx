// AgentHubWorkbench pending dispatch queue (CF22): 409 turn_in_progress
// queuing, retry budget and degradation (#1763 split of
// AgentHubWorkbench.test.tsx).
//
// Shared vi.mock registration for the #1763 workbench shards. Must stay the
// first import so mock factories register before the component tree (and its
// virtua/@lobehub/icons deps) is evaluated. This shard intentionally does NOT
// call installWorkbenchTestHooks(): the original suite kept the pending
// dispatch describe outside the AgentHubWorkbench describe scope, so its
// afterEach hooks never applied here.
import './helpers';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_PENDING_DISPATCH_RETRIES } from '../composer/pendingIntents';
import { createMockPlatform } from '../../platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';

describe('pending dispatch queue (CF22)', () => {
  const draftKey = 'agenthub.composer.draft.team';
  const dispatchDraft = {
    text: '继续修复聊天流',
    mentions: [
      { id: 'builder', label: 'Builder', runtimeId: 'claude-code', dispatchRole: 'dispatch' },
    ],
  };

  beforeEach(() => {
    window.localStorage.removeItem(draftKey);
  });

  function renderQueueHarness(
    platform: ReturnType<typeof createMockPlatform>,
    isAgentRunning = true,
  ) {
    return render(
      <AgentHubWorkbench
        agents={[{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
        isAgentRunning={isAgentRunning}
      />,
    );
  }

  it('queues the dispatch intent on 409 turn_in_progress and re-dispatches when the run ends', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify(dispatchDraft));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    const submit = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });
    const redispatch = vi.fn().mockResolvedValue({ taskId: 'task-1' });
    platform.runs.submitComposerIntent = submit;
    platform.runs.redispatchTask = redispatch;

    const { rerender } = renderQueueHarness(platform, true);

    // Stream-in-progress submit: message sent, dispatch rejected with 409.
    fireEvent.click(screen.getByRole('button', { name: '启动 Agent 任务' }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('待发送 {count} 条')).toBeInTheDocument();

    // The agent run ends → the queue flushes with a dispatch-only retry.
    // The message itself is never re-sent (submitComposerIntent stays at 1).
    rerender(
      <AgentHubWorkbench
        agents={[{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
        isAgentRunning={false}
      />,
    );
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(1);
    });
    expect(redispatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'team', text: '继续修复聊天流' }),
      'hub-msg-1',
    );
    expect(submit).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('待发送 {count} 条')).not.toBeInTheDocument();
    });
  });

  it('abandons a pending dispatch after 3 failed retries with a toast', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify(dispatchDraft));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    const submit = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });
    const redispatch = vi.fn().mockResolvedValue({ turnInProgress: true });
    platform.runs.submitComposerIntent = submit;
    platform.runs.redispatchTask = redispatch;

    const { rerender } = renderQueueHarness(platform, true);
    fireEvent.click(screen.getByRole('button', { name: '启动 Agent 任务' }));
    await waitFor(() => {
      expect(submit).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('待发送 {count} 条')).toBeInTheDocument();

    // Run ends → retry 1 → still 409 → requeued; the delayed retry loop burns
    // the remaining budget (2 more attempts) and abandons with a toast.
    rerender(
      <AgentHubWorkbench
        agents={[{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
        isAgentRunning={false}
      />,
    );
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(MAX_PENDING_DISPATCH_RETRIES);
    }, { timeout: 8000 });
    expect(screen.queryByText('待发送 {count} 条')).not.toBeInTheDocument();
    expect(screen.getByText('派单重试 {max} 次仍被拒绝，已放弃自动重试，请稍后手动重新触发该 Agent')).toBeInTheDocument();
    // Never re-sent the message during the retry loop.
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('does not queue a 409 when the submit carried no dispatch mention', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify({
      text: '继续修复聊天流',
      mentions: [],
    }));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });

    renderQueueHarness(platform, true);
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/待发送/)).not.toBeInTheDocument();
  });

  it('degrades to toast-only 409 behavior when the platform has no dispatch-only retry port', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify(dispatchDraft));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });
    delete platform.runs.redispatchTask;

    renderQueueHarness(platform, true);
    fireEvent.click(screen.getByRole('button', { name: '启动 Agent 任务' }));
    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(/待发送/)).not.toBeInTheDocument();
  });
});
