import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { useThreadMessages, useThreads } from '@/api/threadQueries';

vi.mock('@/api/threadQueries', () => ({
  useThreadMessages: vi.fn(),
  useThreads: vi.fn(),
}));

const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);

describe('Desktop App v4 root', () => {
  beforeEach(() => {
    mockedUseThreads.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadMessages>);
  });

  it('renders the shared v4 workbench as the active desktop route', () => {
    render(<App />);

    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Inspector tabs' })).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Composer modes' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '浏览器预览' })).not.toBeDisabled();
    expect(screen.getByText('Desktop 已切入 shared v4 workbench。旧 Desktop 主 UI 不再控制 active route。')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '本地 Agent 协作群' })).toBeInTheDocument();
  });

  it('uses Edge thread data when Desktop queries return conversations and items', () => {
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T01:00:00Z',
            updatedAt: '2026-06-07T01:00:03Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [
          {
            itemId: 'item-user',
            projectId: 'project-1',
            threadId: 'thread-real',
            type: 'user_message',
            role: 'user',
            status: 'completed',
            content: '把 Desktop 接到真实 thread',
            createdAt: '2026-06-07T01:00:01Z',
            updatedAt: '2026-06-07T01:00:01Z',
          },
          {
            itemId: 'item-agent',
            projectId: 'project-1',
            threadId: 'thread-real',
            runId: 'run-real',
            type: 'agent_message',
            role: 'agent',
            status: 'completed',
            content: '已读取 Edge thread item。',
            createdAt: '2026-06-07T01:00:02Z',
            updatedAt: '2026-06-07T01:00:02Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    render(<App />);

    expect(screen.getByRole('heading', { name: '真实 Edge 会话' })).toBeInTheDocument();
    expect(screen.getByText('把 Desktop 接到真实 thread')).toBeInTheDocument();
    expect(screen.getByText('已读取 Edge thread item。')).toBeInTheDocument();
    expect(screen.getByText('Run run-real')).toBeInTheDocument();
    expect(mockedUseThreadMessages).toHaveBeenCalledWith('thread-real');
  });
});
