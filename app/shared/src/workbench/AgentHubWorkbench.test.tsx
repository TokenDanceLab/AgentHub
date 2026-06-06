import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createMockPlatform } from '../platform/createMockPlatform';
import type { WorkbenchAgent } from '../platform/types';
import type { TranscriptBlock } from '../transcript/types';
import { AgentHubWorkbench } from './AgentHubWorkbench';

describe('AgentHubWorkbench', () => {
  const agents: WorkbenchAgent[] = [
    {
      id: 'builder',
      name: 'Builder',
      description: '代码实现',
      status: 'available',
      model: 'glm-5.1',
      runtimeId: 'claude-code',
    },
    {
      id: 'reviewer',
      name: 'Reviewer',
      description: '架构复核',
      status: 'available',
      model: 'deepseek-v4-pro',
      runtimeId: 'claude-code',
    },
  ];

  const transcript: TranscriptBlock[] = [
    {
      id: 'msg-1',
      kind: 'text',
      author: { id: 'user', name: 'Delicious233', role: 'human' },
      text: '全面参考 agenthub-design/desktop',
    },
    {
      id: 'tool-1',
      kind: 'tool_call',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      toolName: 'Read',
      status: 'completed',
      evidenceRefs: [
        { id: 'run-v4', kind: 'run', label: 'Run v4', status: 'running' },
        { id: 'ev-tool', kind: 'tool', label: 'Read desktop/index.html', status: 'completed' },
      ],
    },
    {
      id: 'diff-1',
      kind: 'diff',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: 'app/shared/src/workbench/RightInspector.tsx',
      files: ['app/shared/src/workbench/RightInspector.tsx'],
      evidenceRefs: [{ id: 'ev-file', kind: 'file', label: 'app/shared/src/workbench/RightInspector.tsx' }],
    },
    {
      id: 'artifact-1',
      kind: 'artifact',
      author: { id: 'builder', name: 'Builder', role: 'agent' },
      title: 'visual-smoke-desktop.png',
      evidenceRefs: [{ id: 'ev-artifact', kind: 'artifact', label: 'visual-smoke-desktop.png', status: 'completed' }],
    },
  ];

  it('renders the v4 shell regions from one shared workbench', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '消息' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '云文档' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Inspector tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '概览' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '浏览器' })).toBeDisabled();
    expect(screen.getByRole('tab', { name: '文件' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Composer modes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '@Agent' })).toBeInTheDocument();
    expect(screen.getByLabelText('Approval mode')).toHaveValue('suggest');
    expect(screen.getByLabelText('Work directory')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
    expect(screen.getByText('全面参考 agenthub-design/desktop')).toBeInTheDocument();
    expect(screen.getByText('Read desktop/index.html')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浏览器预览' })).toBeDisabled();
  });

  it('renders v4 inspector overview, changed files, and browser capability state', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: true },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct' }],
    });

    render(
      <AgentHubWorkbench
        agents={agents}
        platform={platform}
        conversations={platform.seed.conversations}
        transcript={transcript}
      />,
    );

    expect(screen.getByRole('list', { name: '运行 evidence' })).toHaveTextContent('Run v4');
    expect(screen.getByRole('list', { name: '工具 evidence' })).toHaveTextContent('Read desktop/index.html');
    expect(screen.getByRole('list', { name: '产物 evidence' })).toHaveTextContent('visual-smoke-desktop.png');

    fireEvent.click(screen.getByRole('tab', { name: '文件' }));
    expect(screen.getByRole('list', { name: 'Changed files' })).toHaveTextContent('app/shared/src/workbench/RightInspector.tsx');

    fireEvent.click(screen.getByRole('tab', { name: '浏览器' }));
    expect(screen.getByText('浏览器预览已启用')).toBeInTheDocument();
    expect(screen.getByText('检测到 1 个产物，后续由 platform adapter 打开预览。')).toBeInTheDocument();
  });

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

    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '开始 v4 shared workbench' },
    });
    fireEvent.click(screen.getByRole('button', { name: '@Agent' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /@Builder/ }));
    expect(screen.getByRole('button', { name: '移除提及 Builder' })).toBeInTheDocument();
    const file = new File(['attachment-token: shared'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('composer-attachment-input'), {
      target: { files: [file] },
    });
    expect(await screen.findByText('notes.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    fireEvent.change(screen.getByLabelText('Approval mode'), {
      target: { value: 'workspace-write' },
    });
    fireEvent.change(screen.getByLabelText('Work directory'), {
      target: { value: 'D:\\Code\\TokenDance\\AgentHub' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({
          approvalMode: 'workspace-write',
          conversationId: 'team',
          mentions: [
            expect.objectContaining({
              id: 'builder',
              label: 'Builder',
              model: 'glm-5.1',
            }),
          ],
          attachments: [
            expect.objectContaining({
              contentPreview: 'attachment-token: shared',
              name: 'notes.txt',
              source: 'browser',
            }),
          ],
          mode: 'code',
          text: '开始 v4 shared workbench',
          workDir: 'D:\\Code\\TokenDance\\AgentHub',
        }),
      ]);
    });
  });

  it('removes selected @Agent mentions before submit', () => {
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

    fireEvent.click(screen.getByRole('button', { name: '@Agent' }));
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /@Reviewer/ }));
    expect(screen.getByRole('button', { name: '移除提及 Reviewer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除提及 Reviewer' }));
    expect(screen.queryByRole('button', { name: '移除提及 Reviewer' })).not.toBeInTheDocument();
  });

  it('removes selected attachments before submit', async () => {
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

    const file = new File(['remove-me'], 'remove-me.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByTestId('composer-attachment-input'), {
      target: { files: [file] },
    });
    expect(await screen.findByText('remove-me.txt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '移除附件 remove-me.txt' }));
    expect(screen.queryByText('remove-me.txt')).not.toBeInTheDocument();
  });

  it('adds local file attachments through the platform attachment port', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { localFiles: true },
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
      pickFiles: async () => [{
        id: 'desktop-attachment-1',
        name: 'desktop.md',
        source: 'desktop',
        path: 'D:\\Code\\TokenDance\\AgentHub\\desktop.md',
        contentPreview: 'desktop native token',
      }],
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

    fireEvent.click(screen.getByRole('button', { name: '添加本机附件' }));
    expect(await screen.findByText('desktop.md')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '读取本机附件' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({
          attachments: [
            expect.objectContaining({
              contentPreview: 'desktop native token',
              name: 'desktop.md',
              path: 'D:\\Code\\TokenDance\\AgentHub\\desktop.md',
              source: 'desktop',
            }),
          ],
        }),
      ]);
    });
  });

  it('keeps the composer usable when the platform attachment picker fails', async () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { localFiles: true },
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
      pickFiles: vi.fn().mockRejectedValue(new Error('dialog unavailable')),
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

    fireEvent.click(screen.getByRole('button', { name: '添加本机附件' }));

    await waitFor(() => {
      expect(platform.attachments?.pickFiles).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: '添加本机附件' })).not.toBeDisabled();
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '继续输入' },
    });
    expect(screen.getByRole('textbox', { name: 'Composer input' })).toHaveValue('继续输入');
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

    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '没有真实 thread 时不要假提交' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.runs.submitComposerIntent).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByRole('textbox', { name: 'Composer input' })).toHaveValue('没有真实 thread 时不要假提交');
    expect(screen.getByRole('button', { name: '发送消息' })).not.toBeDisabled();
  });
});
