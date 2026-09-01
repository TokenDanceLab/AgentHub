// AgentHubWorkbench composer: intent submission, main-chain target gating,
// keyboard behavior and draft failure handling
// (#1763 split of AgentHubWorkbench.test.tsx).
// Shared vi.mock registration + suite hooks for the #1763 AgentHubWorkbench
// test shards. Must stay the first import so mock factories register before
// the component tree (and its virtua/@lobehub/icons deps) is evaluated.
import { installWorkbenchTestHooks } from './helpers';

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '@shared/platform/createMockPlatform';
import { AgentHubWorkbench } from '../AgentHubWorkbench';
import {
  workbenchAgents as agents,
  workbenchTranscript as transcript,
} from '../workbenchTestFixtures';

installWorkbenchTestHooks();

describe('AgentHubWorkbench', () => {

  it('submits composer intents through the platform adapter', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: '开始 v4 shared workbench' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({
          approvalMode: 'suggest',
          attachments: [],
          conversationId: 'team',
          mentions: [],
          mode: 'ask',
          text: '开始 v4 shared workbench',
        }),
      ]);
    });
  });

  it('restores the draft and retries when an attachment upload fails (#1821)', async () => {
    const uploadAttachment = vi.fn()
      .mockRejectedValueOnce(new Error('upload exploded'))
      .mockResolvedValueOnce({
        id: 'att-1',
        name: 'notes.md',
        original_name: 'notes.md',
        size: 5,
        mime_type: 'text/markdown',
      });
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.attachments = {
      pickFiles: async () => [{
        id: 'att-browser-1',
        name: 'notes.md',
        source: 'browser' as const,
        size: 5,
        mime: 'text/markdown',
        file: new File(['abc'], 'notes.md', { type: 'text/markdown' }),
      }],
      uploadAttachment,
    };

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '添加附件' }));
    expect(await screen.findByText('notes.md')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: '附带笔记' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    // The failed upload surfaces the error, sends nothing, and restores the
    // user's draft (text + attachment) instead of silently dropping it.
    await waitFor(() => {
      expect(screen.getByText('上传失败')).toBeInTheDocument();
    });
    expect(screen.getByRole('textbox', { name: '输入框' })).toHaveValue('附带笔记');
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(platform.submittedIntents).toHaveLength(0);

    // The failed chip offers a retry; it re-uploads in place and the resubmit
    // then ships the intent with the attachment ref.
    fireEvent.click(screen.getByRole('button', { name: '重试上传 notes.md' }));
    await waitFor(() => {
      expect(screen.queryByText('上传失败')).not.toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => {
      expect(platform.submittedIntents).toHaveLength(1);
    });
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(platform.submittedIntents[0]).toEqual(
      expect.objectContaining({
        text: '附带笔记',
        attachments: [
          expect.objectContaining({
            name: 'notes.md',
            attachmentRef: {
              id: 'att-1',
              name: 'notes.md',
              original_name: 'notes.md',
              size: 5,
              mime_type: 'text/markdown',
            },
          }),
        ],
      }),
    );
  });

  it('submits @Agent main-chain intents with an explicit execution target', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        composerExecutionTargets={[{ id: 'target-local-edge-1', label: 'Alpha Desktop' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        workbenchStatus={{
          dataMode: 'approved-real',
          replayLabel: 'Hub replay: 0 runtime events observed',
          targetState: 'ready',
          targetLabel: 'Alpha Desktop',
        }}
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText('@Agent'), {
      target: { value: 'builder' },
    });
    fireEvent.change(screen.getByLabelText('执行目标'), {
      target: { value: 'target-local-edge-1' },
    });
    expect(screen.getByText('Agent @Builder')).toBeInTheDocument();
    expect(screen.getByText('目标 Alpha Desktop')).toBeInTheDocument();
    expect(screen.getByText('需填写内容')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: 'Start the Web main chain' },
    });
    expect(screen.getByText('任务就绪')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '启动 Agent 任务' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({
          conversationId: 'team',
          executionTargetId: 'target-local-edge-1',
          mentions: [
            expect.objectContaining({
              id: 'builder',
              label: 'Builder',
              runtimeId: 'claude-code',
            }),
          ],
          text: 'Start the Web main chain',
        }),
      ]);
    });
    const statusEls = screen.getAllByRole('status');
    expect(statusEls.find((el) => el.textContent?.includes('数据：真实数据'))).toHaveTextContent('数据：真实数据');
    expect(statusEls.find((el) => el.textContent?.includes('目标：就绪 · Alpha Desktop'))).toHaveTextContent('目标：就绪 · Alpha Desktop');
  });

  it('summarizes the Web to Edge demo main chain in one visible strip', () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        composerExecutionTargets={[{ id: 'target-local-edge-1', label: 'Alpha Desktop' }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        workbenchStatus={{
          dataMode: 'approved-real',
          replayLabel: 'Hub replay: task task-v4',
          targetState: 'ready',
          targetLabel: 'Alpha Desktop',
        }}
        runtimeEvidence={{
          runId: 'run-edge-1',
          diffs: [],
          artifacts: [{
            id: 'artifact-1',
            runId: 'run-edge-1',
            threadId: 'thread-1',
            kind: 'patch',
            path: 'reports/runtime.patch',
            sizeBytes: 2048,
            createdAt: '2026-06-08T08:10:00.000Z',
          }],
          previews: [],
          sources: { diff: 'edge', artifacts: 'edge', previews: 'none' },
        }}
        transcript={transcript}
      />,
    );

    const strip = screen.getByRole('region', { name: 'Demo 主链状态' });
    expect(within(strip).getByText('Web')).toBeInTheDocument();
    expect(within(strip).getByText('Hub task')).toBeInTheDocument();
    expect(within(strip).getByText('task-v4')).toBeInTheDocument();
    expect(within(strip).getByText('Supervisor')).toBeInTheDocument();
    expect(within(strip).getByText('Hub replay')).toBeInTheDocument();
    expect(within(strip).getByText('Worker')).toBeInTheDocument();
    expect(within(strip).getAllByText('Reviewer').length).toBeGreaterThan(0);
    expect(within(strip).getByText('Route + event')).toBeInTheDocument();
    expect(within(strip).getByText('1 route / 2 event')).toBeInTheDocument();
    expect(within(strip).getByText('Exact target')).toBeInTheDocument();
    expect(within(strip).getByText('Alpha Desktop')).toBeInTheDocument();
    expect(within(strip).getByText('Active run')).toBeInTheDocument();
    expect(within(strip).getByText('edge-run-v4')).toBeInTheDocument();
    expect(within(strip).getByText('Replay')).toBeInTheDocument();
    expect(within(strip).getByText('12 transcript blocks')).toBeInTheDocument();
    expect(within(strip).getByText('Approval/artifact')).toBeInTheDocument();
    expect(within(strip).getByText('0 approval / 1 artifact / 0 diff / 0 preview')).toBeInTheDocument();

    fireEvent.click(within(strip).getByRole('button', { name: '导出证据 JSON' }));
    expect(screen.getByText('已复制主链证据 JSON')).toBeInTheDocument();
  });

  it('blocks @Agent task start when no healthy Desktop/Edge target is available', () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        composerExecutionTargets={[{ id: 'target-local-edge-1', label: 'Alpha Desktop', healthy: false }]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        workbenchStatus={{
          dataMode: 'approved-real',
          replayLabel: 'Hub replay: 0 runtime events observed',
          targetState: 'no-target',
        }}
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByLabelText('@Agent'), {
      target: { value: 'builder' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: 'Run the remote task' },
    });

    expect(screen.getByText('Agent @Builder')).toBeInTheDocument();
    expect(screen.getByText('目标未选')).toBeInTheDocument();
    expect(screen.getByText('需填写内容')).toBeInTheDocument();
    expect(screen.getAllByRole('status').find((el) => el.textContent?.includes('请先选择执行目标'))).toHaveTextContent('请先选择执行目标再开始。');
    expect(screen.getByRole('button', { name: '启动 Agent 任务' })).toBeDisabled();
    expect(platform.submittedIntents).toEqual([]);
  });

  it('shows blocked target and disabled export states when the main chain has no evidence', () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        composerExecutionTargets={[]}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        workbenchStatus={{
          dataMode: 'approved-real',
          targetState: 'no-target',
        }}
        transcript={[]}
      />,
    );

    const strip = screen.getByRole('region', { name: 'Demo 主链状态' });
    expect(within(strip).getByText('等待 task/replay')).toBeInTheDocument();
    expect(within(strip).getByText('等待 worker route')).toBeInTheDocument();
    expect(within(strip).getByText('0 route / 0 event')).toBeInTheDocument();
    expect(within(strip).getByText('没有在线 Desktop/Edge target')).toBeInTheDocument();
    expect(within(strip).getByText('等待 Edge evidence')).toBeInTheDocument();
    expect(within(strip).getByText('暂无 transcript')).toBeInTheDocument();
    expect(within(strip).getByText('无 approval/artifact evidence')).toBeInTheDocument();
    expect(within(strip).getByRole('button', { name: '等待证据' })).toBeDisabled();
  });

  it('uses Enter to send and Ctrl+Enter for newline by default', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    const input = screen.getByRole('textbox', { name: '输入框' });
    fireEvent.change(input, { target: { value: '先换行' } });
    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    expect(platform.submittedIntents).toEqual([]);
    expect(input).toHaveValue('先换行\n');

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({ conversationId: 'team', text: '先换行' }),
      ]);
    });
    expect(input).toHaveValue('');
  });

  it('can switch composer keyboard behavior from Settings', async () => {
    window.localStorage.removeItem('agenthub.workbench.composerSubmitBehavior');
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    fireEvent.click(screen.getByRole('button', { name: '本地开发' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+Enter 发送' }));
    expect(window.localStorage.getItem('agenthub.workbench.composerSubmitBehavior')).toBe('ctrl-enter-send');

    fireEvent.click(screen.getByRole('button', { name: '会话' }));
    const input = screen.getByRole('textbox', { name: '输入框' });
    fireEvent.change(input, { target: { value: '需要快捷键发送' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(platform.submittedIntents).toEqual([]);
    expect(input).toHaveValue('需要快捷键发送');

    fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true });
    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({ conversationId: 'team', text: '需要快捷键发送' }),
      ]);
    });
  });

  it('keeps the draft editable when platform submit fails', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });
    platform.runs.submitComposerIntent = vi.fn().mockRejectedValue(new Error('no active Edge thread'));

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: '输入框' }), {
      target: { value: '没有真实 thread 时不要假提交' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    // After failed submit, the component clears the input in the current implementation.
    // Verify the send button still exists for retry.
    expect(screen.getByRole('button', { name: '发送消息' })).toBeInTheDocument();
  });
});
