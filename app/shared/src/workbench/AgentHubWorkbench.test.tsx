import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createMockPlatform } from '../platform/createMockPlatform';
import type { TranscriptBlock } from '../transcript/types';
import { AgentHubWorkbench } from './AgentHubWorkbench';

describe('AgentHubWorkbench', () => {
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
      evidenceRefs: [{ id: 'ev-tool', kind: 'tool', label: 'Read desktop/index.html', status: 'completed' }],
    },
  ];

  it('renders the v4 shell regions from one shared workbench', () => {
    const platform = createMockPlatform({
      surface: 'desktop',
      capabilities: { browserPreview: false },
      conversations: [{ id: 'builder', title: 'Builder', kind: 'direct', subtitle: 'Claude Code' }],
    });

    render(<AgentHubWorkbench platform={platform} conversations={platform.seed.conversations} transcript={transcript} />);

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
    expect(screen.getByRole('button', { name: 'Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deploy' })).toBeInTheDocument();
    expect(screen.getByText('全面参考 agenthub-design/desktop')).toBeInTheDocument();
    expect(screen.getByText('Read desktop/index.html')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浏览器预览' })).toBeDisabled();
  });

  it('submits composer intents through the platform adapter', async () => {
    const platform = createMockPlatform({
      surface: 'web',
      conversations: [{ id: 'team', title: 'Agent 协作群', kind: 'group' }],
    });

    render(
      <AgentHubWorkbench
        platform={platform}
        conversations={platform.seed.conversations}
        activeConversationId="team"
        transcript={[]}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Composer input' }), {
      target: { value: '开始 v4 shared workbench' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Code' }));
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(platform.submittedIntents).toEqual([
        expect.objectContaining({ conversationId: 'team', text: '开始 v4 shared workbench', mode: 'code' }),
      ]);
    });
  });
});
