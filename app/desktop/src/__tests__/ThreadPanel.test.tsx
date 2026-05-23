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

  it('shows truncated threadId as title when title is empty', () => {
    const threads = [
      makeThread({ threadId: 'thread-with-very-long-id-12345', title: '' }),
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
    // Should show first 12 chars of threadId ("thread-with-" = 12 characters)
    expect(screen.getByText('thread-with-')).toBeInTheDocument();
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
    const threads = [
      makeThread({ threadId: 't1', title: 'Alpha' }),
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
});
