// AgentHubWorkbench pending dispatch queue (#1965, UX F7; supersedes the
// CF22 badge): 409 turn_in_progress queuing into a VISIBLE queue, undo,
// manual retry after failure, cross-conversation isolation, retry budget
// with a visible failed row, and honest degradation without a dispatch-only
// retry port (#1763 split of AgentHubWorkbench.test.tsx).
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
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';

describe('pending dispatch queue (#1965)', () => {
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
    activeConversationId = 'team',
  ) {
    return render(
      <AgentHubWorkbench
        agents={[{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId={activeConversationId}
        transcript={[]}
        isAgentRunning={isAgentRunning}
      />,
    );
  }

  function workbenchProps(
    platform: ReturnType<typeof createMockPlatform>,
    isAgentRunning: boolean,
    activeConversationId = 'team',
  ) {
    return {
      agents: [{ id: 'builder', name: 'Builder', status: 'available', runtimeId: 'claude-code' }],
      platform,
      conversations: platform.seed.conversations,
      activeConversationId,
      transcript: [],
      isAgentRunning,
    };
  }

  async function submitWhileRunning() {
    fireEvent.click(screen.getByRole('button', { name: '启动 Agent 任务' }));
    // Queue title + the visible row for the persisted message's dispatch.
    await waitFor(() => {
      expect(screen.getByText('待派发队列')).toBeInTheDocument();
    });
    // The text renders at least twice: the surviving transcript message and
    // the queue preview row (undo must never delete the former).
    expect(screen.getAllByText('继续修复聊天流').length).toBeGreaterThanOrEqual(2);
  }

  it('queues the dispatch intent on 409 turn_in_progress into a visible queue and re-dispatches when the run ends', async () => {
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
    await submitWhileRunning();
    // Running summary copy explains the wait (next-turn semantics).
    expect(screen.getByText('1 条排队中，当前任务结束后按序派发')).toBeInTheDocument();

    // The agent run ends → the queue flushes with a dispatch-only retry.
    // The message itself is never re-sent (submitComposerIntent stays at 1).
    rerender(<AgentHubWorkbench {...workbenchProps(platform, false)} />);
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(1);
    });
    expect(redispatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'team', text: '继续修复聊天流' }),
      'hub-msg-1',
    );
    expect(submit).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
    });
  });

  it('keeps the failed row visible after the retry budget is exhausted (no silent drop)', async () => {
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
    await submitWhileRunning();

    // Run ends → retry 1 → still 409 → requeued; the delayed retry loop burns
    // the remaining budget (2 more attempts) and abandons with a toast.
    rerender(<AgentHubWorkbench {...workbenchProps(platform, false)} />);
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(MAX_PENDING_DISPATCH_RETRIES);
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(screen.getByText(
        '派单重试 {max} 次仍被拒绝，已放弃自动重试，请稍后手动重新触发该 Agent',
      )).toBeInTheDocument();
    });
    // Contract: the abandoned row stays visible with a manual retry control
    // instead of disappearing silently.
    expect(screen.getByText('待派发队列')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(`重试 ${MAX_PENDING_DISPATCH_RETRIES} 次仍被拒绝`)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: '重试' })).toBeInTheDocument();
    // Never re-sent the message during the retry loop.
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('undo cancels only the pending dispatch — the persisted message is kept and nothing re-dispatches', async () => {
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
    await submitWhileRunning();

    fireEvent.click(screen.getByRole('button', { name: '撤销派单：继续修复聊天流' }));
    // Undo copy says the transcript message survives the cancel.
    expect(screen.getByText('已撤销派单；消息仍保留在聊天记录中')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
    });

    // Run ends with an empty queue — nothing left to dispatch. Give the
    // idle flush timer a real window to fire so a leaked dispatch fails loud.
    rerender(<AgentHubWorkbench {...workbenchProps(platform, false)} />);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(redispatch).not.toHaveBeenCalled();
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('isolates queues per conversation: another conversation neither sees nor flushes the queue', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify(dispatchDraft));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [
        { id: 'team', title: 'Agent 协作群', kind: 'group' },
        { id: 'side', title: '旁路会话', kind: 'group' },
      ],
    });
    const submit = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });
    const redispatch = vi.fn().mockResolvedValue({ taskId: 'task-1' });
    platform.runs.submitComposerIntent = submit;
    platform.runs.redispatchTask = redispatch;

    const { rerender } = renderQueueHarness(platform, true, 'team');
    await submitWhileRunning();

    // Switch away while both runs are still active: the other conversation
    // must not show the queue and must not trigger a dispatch.
    rerender(<AgentHubWorkbench {...workbenchProps(platform, true, 'side')} />);
    await waitFor(() => {
      expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
    });
    expect(redispatch).not.toHaveBeenCalled();

    // Back to the owning conversation, run ended → only ITS queue flushes.
    rerender(<AgentHubWorkbench {...workbenchProps(platform, false, 'team')} />);
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(1);
    });
    expect(redispatch).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: 'team' }),
      'hub-msg-1',
    );
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('manual retry re-dispatches a failed row and drains the queue on success', async () => {
    window.localStorage.setItem(draftKey, JSON.stringify(dispatchDraft));
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    const submit = vi.fn().mockResolvedValue({ intentId: 'hub-msg-1', turnInProgress: true });
    const redispatch = vi.fn()
      .mockRejectedValueOnce(new Error('hub dispatch exploded'))
      .mockResolvedValue({ taskId: 'task-1' });
    platform.runs.submitComposerIntent = submit;
    platform.runs.redispatchTask = redispatch;

    const { rerender } = renderQueueHarness(platform, true);
    await submitWhileRunning();

    // Run ends → first dispatch attempt throws → visible failed row + toast.
    rerender(<AgentHubWorkbench {...workbenchProps(platform, false)} />);
    await waitFor(() => {
      expect(screen.getByText('派发失败')).toBeInTheDocument();
    });
    expect(screen.getByText('派单重试失败，请手动重新触发该 Agent')).toBeInTheDocument();

    // Manual retry resets the dispatch state and flushes again (message never
    // re-sent: submit stays at 1).
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() => {
      expect(redispatch).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
    });
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
    expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
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
    // Honest degradation: no queue UI, no fake controls — just the 409 toast.
    expect(screen.queryByText('待派发队列')).not.toBeInTheDocument();
  });
});
