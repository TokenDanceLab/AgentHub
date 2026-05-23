import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThreadPanel from '@/components/ThreadPanel';
import type { ThreadInfo } from '@shared/types';

// ── Hoisted mocks (available before vi.mock factory runs) ──
const { mockThreads, mockRenameMutateAsync, mockDeleteMutateAsync } = vi.hoisted(() => ({
  mockThreads: [] as ThreadInfo[],
  mockRenameMutateAsync: vi.fn().mockResolvedValue({}),
  mockDeleteMutateAsync: vi.fn().mockResolvedValue(undefined),
}));

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

vi.mock('@/contexts/ToastContext', () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock('@/api/threadQueries', () => ({
  useThreads: () => ({ data: { items: mockThreads } }),
  useRenameThread: () => ({ mutateAsync: mockRenameMutateAsync }),
  useDeleteThread: () => ({ mutateAsync: mockDeleteMutateAsync }),
}));

// ── Helpers ──

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

let queryClient: QueryClient;

function renderPanel(overrides: Record<string, unknown> = {}) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThreadPanel
        online={true}
        selectedId={undefined}
        onSelect={vi.fn()}
        {...overrides}
      />
    </QueryClientProvider>,
  );
}

describe('ThreadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockThreads.length = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it('renders empty state when threads list is empty', () => {
    renderPanel();
    expect(screen.getByText('thread.emptyTitle')).toBeInTheDocument();
  });

  it('renders thread items', () => {
    mockThreads.push(
      makeThread({ threadId: 't1', title: 'First Thread' }),
      makeThread({ threadId: 't2', title: 'Second Thread' }),
    );
    renderPanel();
    expect(screen.getByText('First Thread')).toBeInTheDocument();
    expect(screen.getByText('Second Thread')).toBeInTheDocument();
  });

  it('shows fallback title when thread title is empty', () => {
    mockThreads.push(
      makeThread({ threadId: 'thread-with-very-long-id-12345', title: '' }),
    );
    renderPanel();
    expect(screen.getByText('thread.untitled')).toBeInTheDocument();
  });

  it('highlights selected thread', () => {
    mockThreads.push(
      makeThread({ threadId: 't1', title: 'Thread A' }),
      makeThread({ threadId: 't2', title: 'Thread B' }),
    );
    renderPanel({ selectedId: 't2' });
    const btnA = screen.getByText('Thread A').closest('button');
    const btnB = screen.getByText('Thread B').closest('button');
    expect(btnA?.className).not.toContain('selected');
    expect(btnB?.className).toContain('selected');
  });

  it('calls onSelect when thread is clicked', () => {
    const onSelect = vi.fn();
    const thread = makeThread({ threadId: 't1', title: 'Click Me' });
    mockThreads.push(thread);
    renderPanel({ onSelect });
    fireEvent.click(screen.getByText('Click Me'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(thread);
  });

  it('invalidates threads query when + button is clicked', () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.create'));
    expect(spy).toHaveBeenCalledWith({ queryKey: ['threads'] });
  });

  it('disables create button when offline', () => {
    renderPanel({ online: false });
    const createBtn = screen.getByTitle('thread.create');
    expect(createBtn).toBeDisabled();
  });

  it('filters threads by search query', () => {
    mockThreads.push(
      makeThread({ threadId: 't1', title: 'Alpha project' }),
      makeThread({ threadId: 't2', title: 'Beta task' }),
      makeThread({ threadId: 't3', title: 'Alpha review' }),
    );
    renderPanel();

    expect(screen.getByText('Alpha project')).toBeInTheDocument();
    expect(screen.getByText('Beta task')).toBeInTheDocument();
    expect(screen.getByText('Alpha review')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('thread.search');
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    expect(screen.getByText('Alpha project')).toBeInTheDocument();
    expect(screen.getByText('Alpha review')).toBeInTheDocument();
    expect(screen.queryByText('Beta task')).not.toBeInTheDocument();
  });

  it('shows empty state when search has no matches', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Alpha' }));
    renderPanel();

    const searchInput = screen.getByPlaceholderText('thread.search');
    fireEvent.change(searchInput, { target: { value: 'nonexistent' } });

    expect(screen.getByText('thread.empty')).toBeInTheDocument();
  });

  it('renders title', () => {
    renderPanel();
    expect(screen.getByText('thread.title')).toBeInTheDocument();
  });

  it('shows message count when thread has itemCount', () => {
    const thread = makeThread({ threadId: 't1', title: 'Chat' }) as ThreadInfo & {
      itemCount: number;
    };
    thread.itemCount = 5;
    mockThreads.push(thread);
    renderPanel();
    expect(screen.getByText(/thread\.messages/)).toBeInTheDocument();
  });

  it('does not show message count when zero', () => {
    const thread = makeThread({ threadId: 't1', title: 'Chat' }) as ThreadInfo & {
      itemCount: number;
    };
    thread.itemCount = 0;
    mockThreads.push(thread);
    renderPanel();
    expect(screen.queryByText(/thread.messages/)).not.toBeInTheDocument();
  });

  it('enters rename mode when pencil button is clicked', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Old Title' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.rename'));
    const input = screen.getByDisplayValue('Old Title') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('saves rename on Enter key', async () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Old Title' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.rename'));
    const input = screen.getByDisplayValue('Old Title');
    fireEvent.change(input, { target: { value: 'New Title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await vi.waitFor(() => {
      expect(mockRenameMutateAsync).toHaveBeenCalledWith({
        threadId: 't1',
        title: 'New Title',
      });
    });
  });

  it('cancels rename on Escape key', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Old Title' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.rename'));
    const input = screen.getByDisplayValue('Old Title');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.getByText('Old Title')).toBeInTheDocument();
  });

  it('shows delete confirmation when trash button is clicked', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'To Delete' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.delete'));
    expect(screen.getByText('thread.confirmDelete')).toBeInTheDocument();
  });

  it('confirms delete and removes thread', async () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'To Delete' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.delete'));
    const confirmBtns = screen.getAllByText('thread.delete');
    fireEvent.click(confirmBtns[confirmBtns.length - 1]);
    await vi.waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('t1');
    });
  });

  it('cancels delete confirmation', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'To Delete' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.delete'));
    fireEvent.click(screen.getByTitle('thread.cancel'));
    expect(screen.getByText('To Delete')).toBeInTheDocument();
    expect(screen.queryByText('thread.confirmDelete')).not.toBeInTheDocument();
  });

  it('disables rename and delete buttons when offline', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Offline Thread' }));
    renderPanel({ online: false });
    const renameBtn = screen.getByTitle('thread.rename');
    const deleteBtn = screen.getByTitle('thread.delete');
    expect(renameBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });
});
