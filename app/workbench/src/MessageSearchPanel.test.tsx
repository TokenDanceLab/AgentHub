import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import MessageSearchPanel from './MessageSearchPanel';
import type { ChatMessage } from '@shared/types/chat';

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
  {
    id: 'm4',
    role: 'system',
    timestamp: '2025-06-01T10:00:15Z',
    blocks: [{ kind: 'status', content: 'Indexing project files' }],
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

/**
 * Flush the 300ms search debounce deterministically.
 *
 * The component debounces `immediateQuery → query` via setTimeout(300ms). Tests
 * that assert on search results must wait past the debounce threshold under
 * `act` so React flushes the state update and re-renders synchronously. Using
 * `findByText`'s internal 1000ms retry instead races against the debounced
 * state update under concurrent test execution and flakes. Awaiting this
 * helper then doing a synchronous `getBy*` assertion removes the race.
 */
async function flushDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

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
    await flushDebounce();
    expect(screen.getByText(/auth module/)).toBeInTheDocument();
  });

  it('shows no results for unmatched query', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'xyznonexistent' } });
    await flushDebounce();
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('highlights matching text with mark tag', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'auth' } });
    await flushDebounce();
    const marks = screen.getAllByText('auth', { selector: 'mark' });
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[0]!.tagName).toBe('MARK');
  }, 15000);

  it('calls onJumpToMessage when clicking a result', async () => {
    const onJump = vi.fn();
    render(<MessageSearchPanel {...defaultProps} onJumpToMessage={onJump} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'auth module' } });
    await flushDebounce();
    const results = screen.getAllByText(/auth module/);
    fireEvent.click(results[0]!.closest('button')!);
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
    const panel = screen.getByPlaceholderText('Type to search...')
      .closest('[class*="panel"]');
    const overlay = panel ? panel.parentElement : null;
    if (!overlay) throw new Error('overlay element not found');
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
    await flushDebounce();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
  });

  it('searches visible status blocks', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText('Type to search...');
    fireEvent.change(input, { target: { value: 'Indexing project' } });
    await flushDebounce();
    expect(screen.getByText(/Indexing project/)).toBeInTheDocument();
  });

  // ── Debounce tests ─────────────────────────────────────

  it('debounces search results by ~300ms', async () => {
    vi.useFakeTimers();
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');

    // Type immediately — no results should appear yet
    fireEvent.change(input, { target: { value: 'auth module' } });

    // Before debounce completes, there should be no results
    expect(screen.queryByText(/auth module/)).not.toBeInTheDocument();

    // Advance past debounce threshold
    act(() => { vi.advanceTimersByTime(350); });

    // Now results should appear
    expect(screen.queryByText(/auth module/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  it('cancels previous debounce on rapid typing', async () => {
    vi.useFakeTimers();
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');

    // Type intermediate query then quickly type matching query
    fireEvent.change(input, { target: { value: 'xyz' } });
    act(() => { vi.advanceTimersByTime(100); });

    fireEvent.change(input, { target: { value: 'auth module' } });

    // Should not have results for the intermediate query
    expect(screen.queryByText(/auth module/)).not.toBeInTheDocument();

    // Advance past debounce
    act(() => { vi.advanceTimersByTime(350); });

    // Now should have results for the final query
    expect(screen.queryByText(/auth module/)).toBeInTheDocument();

    vi.useRealTimers();
  });

  // ── Focus trap ─────────────────────────────────────────

  it('moves focus into the search input when opened', () => {
    const { rerender } = render(
      <MessageSearchPanel {...defaultProps} open={false} />,
    );
    rerender(<MessageSearchPanel {...defaultProps} open={true} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');
    expect(document.activeElement).toBe(input);
  });

  it('traps Tab: wrapping from the last element back to the first', () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');
    const closeBtn = screen.getByLabelText('Close search');
    closeBtn.focus();
    fireEvent.keyDown(closeBtn, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });

  it('traps Shift+Tab: wrapping from the first element to the last', () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');
    const closeBtn = screen.getByLabelText('Close search');
    input.focus();
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(closeBtn);
  });

  it('cycles Tab through result buttons back to the input', async () => {
    render(<MessageSearchPanel {...defaultProps} />);
    const input = screen.getByPlaceholderText<HTMLInputElement>('Type to search...');
    fireEvent.change(input, { target: { value: 'auth module' } });
    await flushDebounce();
    const resultButtons = screen.getAllByRole('button').filter((btn) => btn !== input);
    const lastResult = resultButtons[resultButtons.length - 1]!;
    lastResult.focus();
    fireEvent.keyDown(lastResult, { key: 'Tab' });
    expect(document.activeElement).toBe(input);
  });
});
