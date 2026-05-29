vi.mock('lucide-react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('lucide-react')>();
  return { ...actual };
});

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

vi.mock('@lobehub/icons', () => ({
  ClaudeCode: ({ size }: { size?: number }) => (
    <svg data-testid="claude-icon" width={size} height={size}><title>Claude Code</title></svg>
  ),
  Codex: ({ size }: { size?: number }) => (
    <svg data-testid="codex-icon" width={size} height={size}><title>Codex</title></svg>
  ),
  OpenCode: ({ size }: { size?: number }) => (
    <svg data-testid="opencode-icon" width={size} height={size}><title>OpenCode</title></svg>
  ),
}));

vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: { toasts: unknown[]; addToast: ReturnType<typeof vi.fn>; removeToast: ReturnType<typeof vi.fn> }) => unknown) => {
    const store = {
      toasts: [],
      addToast: vi.fn(),
      removeToast: vi.fn(),
    };
    return selector(store);
  },
}));

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ChatView from '@/components/ChatView';
import type { ChatMessage } from '@/components/ChatView.types';

function makeUserMessage(content: string): ChatMessage {
  return {
    id: 'msg-user-1',
    role: 'user',
    timestamp: new Date().toISOString(),
    blocks: [{ kind: 'text', content }],
  };
}

function makeAgentTextMessage(content: string, id = 'msg-agent-1'): ChatMessage {
  return {
    id,
    role: 'agent',
    timestamp: new Date().toISOString(),
    blocks: [{ kind: 'text', content }],
  };
}

describe('ChatView', () => {
  it('renders empty state when messages array is empty', () => {
    render(<ChatView messages={[]} />);
    expect(screen.getByText('chat.emptyTitle')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chat.suggestion.newTask' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chat.suggestion.explainCode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'chat.suggestion.fixBugs' })).not.toBeInTheDocument();
  });

  it('renders user messages on the right side', () => {
    const msg = makeUserMessage('Hello from user');
    render(<ChatView messages={[msg]} />);
    const messageDiv = screen.getByText('Hello from user').closest('div');
    // user messages render in a container with userMsg class
    const parent = messageDiv?.parentElement;
    expect(parent?.className).toContain('userMsg');
  });

  it('renders agent messages on the left side', () => {
    const msg = makeAgentTextMessage('Hello from agent');
    const { container } = render(<ChatView messages={[msg]} />);
    const agentMessage = container.querySelector('[class*="agentMsg"]');
    expect(agentMessage).toBeInTheDocument();
    expect(agentMessage).toHaveTextContent('Hello from agent');
  });

  it('wires retry and fork actions to the agent message id', () => {
    const onRetry = vi.fn();
    const onFork = vi.fn();
    const msg = makeAgentTextMessage('Hello from agent', 'agent-answer-1');

    render(<ChatView messages={[msg]} onRetry={onRetry} onFork={onFork} />);

    fireEvent.click(screen.getByRole('button', { name: 'chat.retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'chat.fork' }));

    expect(onRetry).toHaveBeenCalledWith('agent-answer-1');
    expect(onFork).toHaveBeenCalledWith('agent-answer-1');
  });

  it('renders runtime names instead of long model ids in agent metadata', () => {
    const msg = {
      ...makeAgentTextMessage('Hello from Claude'),
      agentName: 'claude-opus-4-7[1M][1m]',
    };

    const { container } = render(<ChatView messages={[msg]} />);

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.queryByText('claude-opus-4-7[1M][1m]')).not.toBeInTheDocument();
    expect(screen.getByTestId('claude-icon')).toBeInTheDocument();
    const agentHeader = container.querySelector('[class*="agentAvatar"]');
    expect(agentHeader).toHaveTextContent(/^Claude Code$/);
    expect(agentHeader?.querySelector('title')).toBeNull();
  });

  it('collapses very long agent text output by default', () => {
    const longText = Array.from({ length: 60 }, (_, index) => `agent-output-line-${index + 1}`).join('\n');
    const msg = makeAgentTextMessage(longText);

    render(<ChatView messages={[msg]} />);

    expect(screen.getByText(/agent-output-line-1/)).toBeInTheDocument();
    expect(screen.queryByText(/agent-output-line-60/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'chat.showFullOutput' }));
    expect(screen.getByText(/agent-output-line-60/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'chat.collapseOutput' })).toBeInTheDocument();
  });

  it('renders text blocks inside messages', () => {
    const msg = makeAgentTextMessage('Some text content');
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText('Some text content')).toBeInTheDocument();
  });

  it('renders user attachment context as a compact attachment summary', () => {
    const msg = makeUserMessage([
      'Read the attachment',
      '',
      'Attached files:',
      '1. notes.txt',
      '   Source: Browser file picker',
      '   Size: 27 B',
      '   Content preview:',
      '   hidden attachment body should not expand the bubble',
    ].join('\n'));

    render(<ChatView messages={[msg]} />);

    expect(screen.getByText('Read the attachment')).toBeInTheDocument();
    expect(screen.getByText('notes.txt')).toBeInTheDocument();
    expect(screen.getByText(/Browser file picker/)).toBeInTheDocument();
    expect(screen.queryByText(/Attached files:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/hidden attachment body/)).not.toBeInTheDocument();
  });

  it('renders code blocks with language label', () => {
    const msg: ChatMessage = {
      id: 'msg-code-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [{ kind: 'code', content: 'console.log("hi")', language: 'typescript' }],
    };
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText('typescript')).toBeInTheDocument();
    // Code content is rendered inside the SyntaxHighlighter
    expect(screen.getByText('console.log("hi")')).toBeInTheDocument();
  });

  it('renders thinking blocks collapsed by default', () => {
    const msg: ChatMessage = {
      id: 'msg-think-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [{ kind: 'thinking', content: 'Let me think about this...' }],
    };
    render(<ChatView messages={[msg]} isStreaming={true} />);
    expect(screen.getAllByText('chat.thinkingLabel').length).toBeGreaterThan(0);
    // Content is conditionally rendered (NOT in DOM when collapsed)
    expect(screen.queryByText('Let me think about this...')).not.toBeInTheDocument();
  });

  it('renders tool_use blocks with status', () => {
    const msg: ChatMessage = {
      id: 'msg-tool-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        {
          kind: 'tool_use',
          callId: 'call-1',
          toolName: 'read_file',
          input: { path: '/test.txt' },
          status: 'completed',
        },
      ],
    };
    render(<ChatView messages={[msg]} />);
    // The toggle button should show tool name and status
    expect(screen.getByText('read_file')).toBeInTheDocument();
    expect(screen.getByText(/chat\.toolStatus\.completed/)).toBeInTheDocument();
  });

  it('renders file_change blocks with summary metadata', () => {
    const msg: ChatMessage = {
      id: 'msg-file-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        {
          kind: 'file_change',
          path: '/src/test.ts',
          action: 'created',
          diff: '+new content',
        },
      ],
    };
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText(/created/)).toBeInTheDocument();
    expect(screen.getByText('test.ts')).toBeInTheDocument();
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders modified file_change summary', () => {
    const msg: ChatMessage = {
      id: 'msg-file-2',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        {
          kind: 'file_change',
          path: '/src/update.ts',
          action: 'modified',
        },
      ],
    };
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText(/modified/)).toBeInTheDocument();
    expect(screen.getByText('update.ts')).toBeInTheDocument();
  });

  it('renders deleted file_change summary', () => {
    const msg: ChatMessage = {
      id: 'msg-file-3',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        {
          kind: 'file_change',
          path: '/src/remove.ts',
          action: 'deleted',
        },
      ],
    };
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText(/deleted/)).toBeInTheDocument();
    expect(screen.getByText('remove.ts')).toBeInTheDocument();
  });

  it('renders typed multi-agent activity without dropping core task data', () => {
    const msg: ChatMessage = {
      id: 'msg-task-list-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        {
          kind: 'route_decision',
          action: 'delegate',
          nextWorker: 'member_builder',
          instructions: 'Build the TeamRun console.',
          reasoning: 'The builder owns UI implementation.',
        },
        {
          kind: 'agent_task',
          taskId: 'task_builder',
          title: 'Build the orchestration panel',
          status: 'running',
          summary: 'Wiring typed task state',
          worker: 'member_builder',
        },
        {
          kind: 'child_agent',
          childId: 'child_reviewer',
          childRunId: 'run_child_reviewer',
          agentName: 'Reviewer',
          title: 'Review task transitions',
          status: 'completed',
          result: 'Review passed.',
        },
      ],
    };

    render(<ChatView messages={[msg]} />);

    expect(screen.getByTestId('route-decision-card')).toBeInTheDocument();
    expect(screen.getByTestId('subagent-task-card')).toBeInTheDocument();
    expect(screen.getByTestId('child-agent-card')).toBeInTheDocument();
    const taskList = screen.getByTestId('agent-task-list');
    expect(taskList).toBeInTheDocument();
    expect(taskList).toHaveTextContent('Build the orchestration panel');
    expect(taskList).toHaveTextContent('Review task transitions');
  });

  it('does not render successful result token usage as a standalone content block', () => {
    const msg: ChatMessage = {
      id: 'msg-token-usage-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        { kind: 'text', content: 'Done' },
        { kind: 'result', success: true, tokenUsage: { input: 1250, output: 360 } },
      ],
    };

    render(<ChatView messages={[msg]} />);

    expect(screen.queryByTestId('context-usage-strip')).not.toBeInTheDocument();
    expect(screen.queryByText('chat.tokenUsage')).not.toBeInTheDocument();
  });

  it('renders context usage and warning data from typed runtime events', () => {
    const msg: ChatMessage = {
      id: 'msg-context-usage-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [
        { kind: 'text', content: 'Updated context budget.' },
        {
          kind: 'context_usage',
          runId: 'run-usage-1',
          input: 32000,
          output: 1200,
          total: 33200,
          contextLimit: 200000,
          usagePercent: 16.6,
          remaining: 156800,
          threshold: 85,
          totalCost: 0.42,
          provider: 'Claude Code',
          model: 'claude-sonnet',
          variant: 'warning',
        },
      ],
    };

    render(<ChatView messages={[msg]} />);

    const usage = screen.getByTestId('context-usage-strip');
    expect(usage).toBeInTheDocument();
    expect(usage).toHaveTextContent('chat.contextWarning');
    expect(usage).toHaveTextContent('17%');
    expect(usage).toHaveTextContent('chat.contextThreshold(percent=85)');
    expect(usage).toHaveTextContent('chat.contextLimit');
    expect(usage).toHaveTextContent('200.0K');
    expect(usage).toHaveTextContent('Claude Code / claude-sonnet');
  });

  it('does not render hidden session metadata as a blank message row', () => {
    const msg: ChatMessage = {
      id: 'msg-session-1',
      role: 'system',
      timestamp: new Date().toISOString(),
      blocks: [{ kind: 'session_init', model: 'claude-opus-4-7' }],
    };
    const { container } = render(<ChatView messages={[msg]} />);

    expect(container.querySelector('[class*="messageRow"]')).not.toBeInTheDocument();
    expect(screen.getByText('chat.emptyTitle')).toBeInTheDocument();
  });

  it('does not render standalone success result as a blank message row', () => {
    const msg: ChatMessage = {
      id: 'msg-result-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [{ kind: 'result', success: true }],
    };
    const { container } = render(<ChatView messages={[msg]} />);

    expect(container.querySelector('[class*="messageRow"]')).not.toBeInTheDocument();
    expect(screen.getByText('chat.emptyTitle')).toBeInTheDocument();
  });

  it('does not render the old blue stream progress bar while text is streaming', () => {
    const msg = makeAgentTextMessage('typing...');
    const { container } = render(<ChatView messages={[msg]} isStreaming={true} />);
    const bar = container.querySelector('[class*="streamProgress"]');
    expect(bar).not.toBeInTheDocument();
  });

  it('does not show stream progress bar when isStreaming=false', () => {
    const { container } = render(<ChatView messages={[]} />);
    const bar = container.querySelector('[class*="streamProgress"]');
    expect(bar).not.toBeInTheDocument();
  });
});
