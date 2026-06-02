import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ThreadPanel from '@/components/ThreadPanel';
import type { RunInfo, ThreadInfo } from '@shared/types';

// ── Hoisted mocks (available before vi.mock factory runs) ──
const { mockThreads, mockRenameMutateAsync, mockDeleteMutateAsync, mockCreateMutateAsync, mockArchiveMutateAsync, mockRestoreMutateAsync } = vi.hoisted(() => ({
  mockThreads: [] as ThreadInfo[],
  mockRenameMutateAsync: vi.fn().mockResolvedValue({}),
  mockDeleteMutateAsync: vi.fn().mockResolvedValue(undefined),
  mockCreateMutateAsync: vi.fn().mockResolvedValue({
    threadId: 'new-thread',
    projectId: 'proj-1',
    title: 'thread.untitled',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  }),
  mockArchiveMutateAsync: vi.fn().mockResolvedValue({}),
  mockRestoreMutateAsync: vi.fn().mockResolvedValue({}),
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

vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: any) => {
    const state = {
      toasts: [],
      addToast: vi.fn(),
      removeToast: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/api/threadQueries', () => ({
  useThreads: () => ({ data: { items: mockThreads } }),
  useRenameThread: () => ({ mutateAsync: mockRenameMutateAsync }),
  useDeleteThread: () => ({ mutateAsync: mockDeleteMutateAsync }),
  useCreateThread: () => ({ mutateAsync: mockCreateMutateAsync, isPending: false }),
  useArchiveThread: () => ({ mutateAsync: mockArchiveMutateAsync, isPending: false }),
  useRestoreThread: () => ({ mutateAsync: mockRestoreMutateAsync, isPending: false }),
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

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    runId: 'run-default-1',
    projectId: 'proj-1',
    threadId: 'thread-default-1',
    status: 'running',
    createdAt: '2025-01-02T00:00:00Z',
    startedAt: '2025-01-02T00:00:01Z',
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
    expect(screen.getByText('thread.emptyAction')).toBeInTheDocument();
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

  it('adds project labels to date groups when multiple projects are visible', () => {
    mockThreads.push(
      makeThread({ threadId: 't1', projectId: 'proj-a', title: 'Project A Thread' }),
      makeThread({ threadId: 't2', projectId: 'proj-b', title: 'Project B Thread' }),
    );
    renderPanel();

    expect(screen.getByText('proj-a · thread.groupEarlier')).toBeInTheDocument();
    expect(screen.getByText('proj-b · thread.groupEarlier')).toBeInTheDocument();
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

  it('creates a thread when + button is clicked', async () => {
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.create'));
    await vi.waitFor(() => {
      expect(mockCreateMutateAsync).toHaveBeenCalledWith({ title: '' });
      expect(spy).toHaveBeenCalledWith({ queryKey: ['threads'] });
    });
  });

  it('separates archived threads behind a real status tab', () => {
    mockThreads.push(
      makeThread({ threadId: 't1', title: 'Active Thread', status: 'active' }),
      makeThread({ threadId: 't2', title: 'Archived Thread', status: 'archived' }),
    );
    renderPanel();

    expect(screen.getByText('Active Thread')).toBeInTheDocument();
    expect(screen.queryByText('Archived Thread')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /thread\.archived/ }));

    expect(screen.queryByText('Active Thread')).not.toBeInTheDocument();
    expect(screen.getByText('Archived Thread')).toBeInTheDocument();
  });

  it('shows running status from real run records', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Running Thread' }));

    renderPanel({
      runs: [makeRun({ runId: 'run-running', threadId: 't1', status: 'running' })],
    });

    expect(screen.getByText('Running Thread')).toBeInTheDocument();
    expect(screen.getByText('thread.status.running')).toBeInTheDocument();
  });

  it('prioritizes waiting approval over running for the same thread', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Approval Thread' }));

    renderPanel({
      runs: [
        makeRun({ runId: 'run-running', threadId: 't1', status: 'running', startedAt: '2025-01-02T00:00:01Z' }),
        makeRun({ runId: 'run-approval', threadId: 't1', status: 'waiting_approval', startedAt: '2025-01-02T00:00:02Z' }),
      ],
    });

    expect(screen.getByText('thread.status.waitingApproval')).toBeInTheDocument();
    expect(screen.queryByText('thread.status.running')).not.toBeInTheDocument();
  });

  it('shows failed only when the latest terminal run failed', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Failed Thread' }));

    renderPanel({
      runs: [
        makeRun({ runId: 'run-old', threadId: 't1', status: 'completed', finishedAt: '2025-01-02T00:00:01Z' }),
        makeRun({ runId: 'run-failed', threadId: 't1', status: 'failed', finishedAt: '2025-01-02T00:00:03Z' }),
      ],
    });

    expect(screen.getByText('thread.status.failed')).toBeInTheDocument();
  });

  it('does not show an activity dot for the selected active run thread', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Selected Running Thread' }));

    const { container } = renderPanel({
      selectedId: 't1',
      runs: [makeRun({ runId: 'run-running', threadId: 't1', status: 'running' })],
    });

    expect(screen.getByText('thread.status.running')).toBeInTheDocument();
    expect(container.querySelector('[class*="unreadDot"]')).toBeNull();
  });

  it('delegates creation to the shell when provided so runtime binding is preserved', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderPanel({ onCreate });

    fireEvent.click(screen.getByTitle('thread.create'));

    await vi.waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect(mockCreateMutateAsync).not.toHaveBeenCalled();
    });
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

  it('hides message count metadata in compact thread rows', () => {
    const thread = makeThread({ threadId: 't1', title: 'Chat' }) as ThreadInfo & {
      itemCount: number;
    };
    thread.itemCount = 5;
    mockThreads.push(thread);
    renderPanel();
    expect(screen.getByText('Chat')).toBeInTheDocument();
    expect(screen.queryByText(/thread\.messages/)).not.toBeInTheDocument();
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
    expect(screen.getByText('thread.confirmDeleteShort')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'thread.confirmDeleteAction' })).toBeInTheDocument();
  });

  it('confirms delete and removes thread', async () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'To Delete' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.delete'));
    fireEvent.click(screen.getByRole('button', { name: 'thread.confirmDeleteAction' }));
    await vi.waitFor(() => {
      expect(mockDeleteMutateAsync).toHaveBeenCalledWith('t1');
    });
  });

  it('archives active threads through the Edge archive mutation', async () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Archive Me' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.archive'));
    await vi.waitFor(() => {
      expect(mockArchiveMutateAsync).toHaveBeenCalledWith('t1');
    });
  });

  it('restores archived threads through the Edge status mutation', async () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Restore Me', status: 'archived' }));
    renderPanel();
    fireEvent.click(screen.getByRole('tab', { name: /thread\.archived/ }));
    fireEvent.click(screen.getByTitle('thread.restore'));
    await vi.waitFor(() => {
      expect(mockRestoreMutateAsync).toHaveBeenCalledWith('t1');
    });
  });

  it('cancels delete confirmation', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'To Delete' }));
    renderPanel();
    fireEvent.click(screen.getByTitle('thread.delete'));
    fireEvent.click(screen.getByTitle('thread.cancel'));
    expect(screen.getByText('To Delete')).toBeInTheDocument();
    expect(screen.queryByText('thread.confirmDeleteShort')).not.toBeInTheDocument();
  });

  it('disables rename and delete buttons when offline', () => {
    mockThreads.push(makeThread({ threadId: 't1', title: 'Offline Thread' }));
    renderPanel({ online: false });
    const renameBtn = screen.getByTitle('thread.rename');
    const archiveBtn = screen.getByTitle('thread.archive');
    const deleteBtn = screen.getByTitle('thread.delete');
    expect(renameBtn).toBeDisabled();
    expect(archiveBtn).toBeDisabled();
    expect(deleteBtn).toBeDisabled();
  });
});
