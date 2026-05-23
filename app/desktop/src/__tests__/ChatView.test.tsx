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

vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => {
    // No-op virtualizer: render all items at their natural positions
    const items = Array.from({ length: count }, (_, i) => ({
      key: `vitem-${i}`,
      index: i,
      start: 0,
      size: 0,
      end: 0,
      measureElement: () => {},
    }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => 0,
      measureElement: () => {},
      scrollToIndex: () => {},
    };
  },
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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
    expect(screen.getByText('chat.empty')).toBeInTheDocument();
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
    render(<ChatView messages={[msg]} />);
    const messageDiv = screen.getByText('Hello from agent').closest('div');
    const parent = messageDiv?.parentElement;
    expect(parent?.className).toContain('agentMsg');
  });

  it('renders text blocks inside messages', () => {
    const msg = makeAgentTextMessage('Some text content');
    render(<ChatView messages={[msg]} />);
    expect(screen.getByText('Some text content')).toBeInTheDocument();
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
    // The code content is rendered inside a <code> element
    const codeEl = screen.getByText('console.log("hi")');
    expect(codeEl.tagName).toBe('CODE');
  });

  it('renders thinking blocks collapsed by default', () => {
    const msg: ChatMessage = {
      id: 'msg-think-1',
      role: 'agent',
      timestamp: new Date().toISOString(),
      blocks: [{ kind: 'thinking', content: 'Let me think about this...' }],
    };
    render(<ChatView messages={[msg]} />);
    // The toggle button should show "Thinking"
    expect(screen.getByText('Thinking')).toBeInTheDocument();
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
    expect(screen.getByText('completed')).toBeInTheDocument();
  });

  it('renders file_change blocks with color coding', () => {
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
    // The action should be in the summary
    expect(screen.getByText(/created/)).toBeInTheDocument();
    // The "added" class on the <details> element for created action
    const details = screen.getByText(/created/).closest('details');
    expect(details?.className).toContain('added');
  });

  it('renders modified file_change with different color', () => {
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
    const details = screen.getByText(/modified/).closest('details');
    expect(details?.className).toContain('modified');
  });

  it('renders deleted file_change with different color', () => {
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
    const details = screen.getByText(/deleted/).closest('details');
    expect(details?.className).toContain('removed');
  });

  it('shows stream progress bar when isStreaming=true', () => {
    const msg = makeAgentTextMessage('typing...');
    const { container } = render(<ChatView messages={[msg]} isStreaming={true} />);
    const bar = container.querySelector('[class*="streamProgress"]');
    expect(bar).toBeInTheDocument();
  });

  it('does not show stream progress bar when isStreaming=false', () => {
    const { container } = render(<ChatView messages={[]} />);
    const bar = container.querySelector('[class*="streamProgress"]');
    expect(bar).not.toBeInTheDocument();
  });
});
