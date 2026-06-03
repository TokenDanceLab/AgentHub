import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MessageSearchPanel from './MessageSearchPanel';
import type { ChatMessage } from '@/components/ChatView.types';

const baseMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    timestamp: '2025-06-01T10:00:00Z',
    blocks: [{ kind: 'text', content: 'Hello, can you help me fix a bug?' }],
  },
  {
    id: 'm2',
    role: 'agent',
    agentName: 'Claude Code',
    timestamp: '2025-06-01T10:00:05Z',
    blocks: [
      { kind: 'thinking', content: 'Let me analyze the bug' },
      { kind: 'text', content: 'I found the issue in the auth module.' },
    ],
  },
  {
    id: 'm3',
    role: 'agent',
    agentName: 'Codex',
    timestamp: '2025-06-01T10:00:10Z',
    blocks: [
      { kind: 'tool_use', callId: 't1', toolName: 'Read', input: { file_path: 'src/auth.ts' }, status: 'completed' },
      { kind: 'file_change', path: 'src/auth.ts', action: 'modified', diff: '+fix' },
    ],
  },
];

const defaultProps = {
  messages: baseMessages,
  open: true,
  onClose: vi.fn(),
  onJumpToMessage: vi.fn(),
  searchLabel: 'Search messages',
  searchPlaceholder: 'Type to search...',
  noResultsLabel: 'No results found',
};

describe('MessageSearchPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <MessageSearchPanel {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders search input when open', () => {
    render(<MessageSearchPanel {...defaultProps} />);
    expect(screen.getByPlaceholderText('Type to search...')).toBeInTheDocument();
  });

  it('filters messages by query', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'auth module' } });

    expect(await screen.findByText(/auth module/)).toBeInTheDocument();
  });

  it('shows no results for unmatched query', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });

    expect(await screen.findByText('No results found')).toBeInTheDocument();
  });

  it('highlights matching text with mark tag', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'auth' } });

    const mark = await screen.findByText('auth', { selector: 'mark' });
    expect(mark).toBeInTheDocument();
  });

  it('calls onJumpToMessage when clicking a result', async () => {
    const onJump = vi.fn();
    render(<MessageSearchPanel {...defaultProps} onJumpToMessage={onJump} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'auth' } });

    const result = await screen.findByText(/auth module/);
    fireEvent.click(result.closest('button')!);

    expect(onJump).toHaveBeenCalledWith(expect.any(String), expect.any(Number));
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<MessageSearchPanel {...defaultProps} onClose={onClose} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking overlay', () => {
    const onClose = vi.fn();
    render(<MessageSearchPanel {...defaultProps} onClose={onClose} />);
    const overlay = screen.getByPlaceholderText('Type to search...')
      .closest('[class*="panel"]')
      ?.parentElement!;
    fireEvent.click(overlay);

    expect(onClose).toHaveBeenCalled();
  });

  it('clears query and focuses input on open', () => {
    const { rerender } = render(
      <MessageSearchPanel {...defaultProps} open={false} />,
    );
    rerender(<MessageSearchPanel {...defaultProps} open={true} />);

    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');
    expect(input.value).toBe('');
  });

  it('shows agent name in result', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'issue' } });

    expect(await screen.findByText('Claude Code')).toBeInTheDocument();
  });
});
