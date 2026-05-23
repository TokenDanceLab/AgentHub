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

const mockRenameThread = vi.fn().mockResolvedValue({});
const mockDeleteThread = vi.fn().mockResolvedValue(undefined);
vi.mock('@/api/edgeClient', () => ({
  renameThread: (...args: unknown[]) => mockRenameThread(...args),
  deleteThread: (...args: unknown[]) => mockDeleteThread(...args),
}));

const mockStoreRename = vi.fn();
const mockStoreRemove = vi.fn();
vi.mock('@/stores/threadStore', () => ({
  useThreadStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      threads: [],
      selectedThreadId: null,
      searchQuery: '',
      setThreads: vi.fn(),
      selectThread: vi.fn(),
      setSearchQuery: vi.fn(),
      removeThread: mockStoreRemove,
      renameThread: mockStoreRename,
    };
    return selector(state);
  },
}));

vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({ showToast: vi.fn() }),
}));

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ThreadPanel from '@/components/ThreadPanel';
import type { ThreadInfo } from '@shared/types';

function makeThread(overrides: Partial<ThreadInfo> = {}): ThreadInfo {
  return {
    threadId: 'thread-default-1',
    projectId: 'proj-1',
    title: 'Default Thread',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    ...overrides,
  };
}

describe('ThreadPanel', () => {
  it('renders empty state when threads list is empty', () => {
    render(
      <ThreadPanel
        threads={[]}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('thread.empty')).toBeInTheDocument();
  });

  it('renders thread items', () => {
    const threads = [
      makeThread({ threadId: 't1', title: 'First Thread' }),
      makeThread({ threadId: 't2', title: 'Second Thread' }),
    ];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('First Thread')).toBeInTheDocument();
    expect(screen.getByText('Second Thread')).toBeInTheDocument();
  });

  it('shows fallback title when thread title is empty', () => {
    const threads = [makeThread({ threadId: 'thread-with-very-long-id-12345', title: '' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    // Should show i18n fallback instead of raw threadId
    expect(screen.getByText('thread.untitled')).toBeInTheDocument();
  });

  it('highlights selected thread', () => {
    const threads = [
      makeThread({ threadId: 't1', title: 'Thread A' }),
      makeThread({ threadId: 't2', title: 'Thread B' }),
    ];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId="t2"
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const btnA = screen.getByText('Thread A').closest('button');
    const btnB = screen.getByText('Thread B').closest('button');
    expect(btnA?.className).not.toContain('selected');
    expect(btnB?.className).toContain('selected');
  });

  it('calls onSelect when thread is clicked', () => {
    const onSelect = vi.fn();
    const thread = makeThread({ threadId: 't1', title: 'Click Me' });
    render(
      <ThreadPanel
        threads={[thread]}
        online={true}
        selectedId={undefined}
        onSelect={onSelect}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('Click Me'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(thread);
  });

  it('calls onCreate when + button is clicked', () => {
    const onCreate = vi.fn();
    render(
      <ThreadPanel
        threads={[]}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={onCreate}
      />,
    );
    const createBtn = screen.getByTitle('thread.create');
    fireEvent.click(createBtn);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it('disables create button when offline', () => {
    render(
      <ThreadPanel
        threads={[]}
        online={false}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const createBtn = screen.getByTitle('thread.create');
    expect(createBtn).toBeDisabled();
  });

  it('filters threads by search query', () => {
    const threads = [
      makeThread({ threadId: 't1', title: 'Alpha project' }),
      makeThread({ threadId: 't2', title: 'Beta task' }),
      makeThread({ threadId: 't3', title: 'Alpha review' }),
    ];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    // Initially all threads visible
    expect(screen.getByText('Alpha project')).toBeInTheDocument();
    expect(screen.getByText('Beta task')).toBeInTheDocument();
    expect(screen.getByText('Alpha review')).toBeInTheDocument();

    // Type in search
    const searchInput = screen.getByPlaceholderText('thread.search');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    // Only alpha threads visible
    expect(screen.getByText('Alpha project')).toBeInTheDocument();
    expect(screen.getByText('Alpha review')).toBeInTheDocument();
    expect(screen.queryByText('Beta task')).not.toBeInTheDocument();
  });

  it('shows empty state when search has no matches', () => {
    const threads = [makeThread({ threadId: 't1', title: 'Alpha' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );

    const searchInput = screen.getByPlaceholderText('thread.search');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('thread.empty')).toBeInTheDocument();
  });

  it('renders title', () => {
    render(
      <ThreadPanel
        threads={[]}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText('thread.title')).toBeInTheDocument();
  });

  it('shows message count when thread has itemCount', () => {
    const threads = [
      makeThread({ threadId: 't1', title: 'Chat' }) as ThreadInfo & { itemCount: number },
    ];
    threads[0].itemCount = 5;
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.getByText(/thread\.messages/)).toBeInTheDocument();
  });

  it('does not show message count when zero', () => {
    const threads = [
      makeThread({ threadId: 't1', title: 'Chat' }) as ThreadInfo & { itemCount: number },
    ];
    threads[0].itemCount = 0;
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    expect(screen.queryByText(/thread.messages/)).not.toBeInTheDocument();
  });

  it('enters rename mode when pencil button is clicked', async () => {
    const threads = [makeThread({ threadId: 't1', title: 'Old Title' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const renameBtn = screen.getByTitle('thread.rename');
    fireEvent.click(renameBtn);
    // Input should appear with current title
    const input = screen.getByDisplayValue('Old Title') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('saves rename on Enter key', async () => {
    const threads = [makeThread({ threadId: 't1', title: 'Old Title' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('thread.rename'));
    const input = screen.getByDisplayValue('Old Title');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Wait for async API call
    await vi.waitFor(() => {
      expect(mockRenameThread).toHaveBeenCalledWith('t1', 'New Title');
      expect(mockStoreRename).toHaveBeenCalledWith('t1', 'New Title');
    });
  });

  it('cancels rename on Escape key', () => {
    const threads = [makeThread({ threadId: 't1', title: 'Old Title' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('thread.rename'));
    const input = screen.getByDisplayValue('Old Title');
    fireEvent.keyDown(input, { key: 'Escape' });
    // Should return to normal display
    expect(screen.getByText('Old Title')).toBeInTheDocument();
  });

  it('shows delete confirmation when trash button is clicked', () => {
    const threads = [makeThread({ threadId: 't1', title: 'To Delete' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('thread.delete'));
    expect(screen.getByText('thread.confirmDelete')).toBeInTheDocument();
  });

  it('confirms delete and removes thread', async () => {
    const threads = [makeThread({ threadId: 't1', title: 'To Delete' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    // Enter delete confirmation
    fireEvent.click(screen.getByTitle('thread.delete'));
    // The confirm button has text "thread.delete"
    const confirmBtns = screen.getAllByText('thread.delete');
    // First one was the trigger, second is the confirm button
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    await vi.waitFor(() => {
      expect(mockDeleteThread).toHaveBeenCalledWith('t1');
      expect(mockStoreRemove).toHaveBeenCalledWith('t1');
    });
  });

  it('cancels delete confirmation', () => {
    const threads = [makeThread({ threadId: 't1', title: 'To Delete' })];
    render(
      <ThreadPanel
        threads={threads}
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTitle('thread.delete'));
    fireEvent.click(screen.getByTitle('thread.cancel'));
    // Should return to normal display
    expect(screen.getByText('To Delete')).toBeInTheDocument();
    expect(screen.queryByText('thread.confirmDelete')).not.toBeInTheDocument();
  });

  it('disables rename and delete buttons when offline', () => {
    const threads = [makeThread({ threadId: 't1', title: 'Offline Thread' })];
    render(
      <ThreadPanel
        threads={threads}
        online={false}
        selectedId={undefined}
        onSelect={vi.fn()}
        onCreate={vi.fn()}
      />,
    );
    const renameBtn = screen.getByTitle('thread.rename');
    const deleteBtn = screen.getByTitle('thread.delete');
    expect(renameBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });
});
