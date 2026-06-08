import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { EventEnvelope } from '@shared/events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { createEventStream } from '@/api/eventClient';
import { useAgentList } from '@/api/agentQueries';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { useRunEvidence } from '@/api/runEvidenceQueries';
import { useCreateRun } from '@/api/runQueries';
import { useThreadMessages, useThreadPins, useThreads } from '@/api/threadQueries';
import type { EventHandler, StatusHandler, StreamHandle } from '@/api/eventClient';

vi.mock('@/api/eventClient', () => ({
  createEventStream: vi.fn(),
}));

vi.mock('@/api/threadQueries', () => ({
  useThreadPins: vi.fn(),
  useThreadMessages: vi.fn(),
  useThreads: vi.fn(),
}));

vi.mock('@/api/agentQueries', () => ({
  useAgentList: vi.fn(),
}));

vi.mock('@/api/modelCatalogQueries', () => ({
  useModelCatalog: vi.fn(),
}));

vi.mock('@/api/runEvidenceQueries', () => ({
  useRunEvidence: vi.fn(),
}));

vi.mock('@/api/runQueries', () => ({
  useCreateRun: vi.fn(),
}));

const eventHandlers: EventHandler[] = [];
const createRunMutateAsync = vi.fn();
const mockedUseThreads = vi.mocked(useThreads);
const mockedUseThreadMessages = vi.mocked(useThreadMessages);
const mockedUseThreadPins = vi.mocked(useThreadPins);
const mockedUseAgentList = vi.mocked(useAgentList);
const mockedUseModelCatalog = vi.mocked(useModelCatalog);
const mockedUseRunEvidence = vi.mocked(useRunEvidence);
const mockedCreateEventStream = vi.mocked(createEventStream);
const mockedUseCreateRun = vi.mocked(useCreateRun);

describe('Desktop App v4 root', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      value: {},
      configurable: true,
    });
    eventHandlers.length = 0;
    mockedCreateEventStream.mockReturnValue(createMockEventStream());
    createRunMutateAsync.mockResolvedValue({
      runId: 'run-created',
      projectId: 'project-1',
      threadId: 'thread-real',
      status: 'queued',
      createdAt: '2026-06-07T04:00:01Z',
    });
    mockedUseCreateRun.mockReturnValue({
      mutateAsync: createRunMutateAsync,
    } as ReturnType<typeof useCreateRun>);
    mockedUseAgentList.mockReturnValue({
      data: { items: [], page: { hasMore: false } },
    } as ReturnType<typeof useAgentList>);
    mockedUseModelCatalog.mockReturnValue({
      data: { items: [], sources: [] },
    } as ReturnType<typeof useModelCatalog>);
    mockedUseRunEvidence.mockReturnValue({
      diffs: [],
      artifacts: [],
      previews: [],
      diffLoading: false,
      artifactLoading: false,
      previewLoading: false,
      diffError: false,
      artifactError: false,
      previewError: false,
      diffSource: 'none',
      artifactSource: 'none',
      previewSource: 'none',
    });
    mockedUseThreads.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadMessages>);
    mockedUseThreadPins.mockReturnValue({
      data: undefined,
    } as ReturnType<typeof useThreadPins>);
  });

  it('renders the shared v4 workbench as the active desktop route', () => {
    render(<App />);

    expect(screen.getByRole('img', { name: 'AgentHub' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Window controls' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Global rail' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Conversation sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Workspace' })).toHaveAttribute('data-surface', 'desktop');
    expect(screen.getByRole('complementary', { name: 'Right inspector' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Workspace tabs' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: '右侧工作区' })).toBeInTheDocument();
    expect(screen.getByLabelText('Composer input')).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Composer modes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '@Agent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '添加本机附件' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Approval mode')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Work directory')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '×浏览器' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'AgentHub' })).toBeInTheDocument();
    expect(screen.getByLabelText('Composer input')).toHaveAttribute('placeholder', '发消息给 AgentHub');
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
    expect(mockedUseThreadMessages).toHaveBeenCalledWith('thread-real');
  });

  it('merges live Edge events into the shared v4 transcript and evidence', () => {
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-live',
            projectId: 'project-1',
            title: 'Live Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T03:00:00Z',
            updatedAt: '2026-06-07T03:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    const { rerender } = render(<App />);

    act(() => {
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-tool',
        seq: 1,
        type: 'run.agent.tool_call',
        scope: { threadId: 'thread-live', runId: 'run-live' },
        sentAt: '2026-06-07T03:00:01Z',
        payload: {
          runId: 'run-live',
          callId: 'call-rg',
          toolName: 'rg',
          status: 'running',
        },
      });
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-text',
        seq: 2,
        type: 'run.agent.text_block',
        scope: { runId: 'run-live' },
        sentAt: '2026-06-07T03:00:02Z',
        payload: {
          runId: 'run-live',
          content: '持久化前的实时回答',
        },
      });
      emitEdgeEvent({
        version: 'v1',
        id: 'evt-text',
        seq: 2,
        type: 'run.agent.text_block',
        scope: { runId: 'run-live' },
        sentAt: '2026-06-07T03:00:02Z',
        payload: {
          runId: 'run-live',
          content: '持久化前的实时回答',
        },
      });
    });

    expect(screen.getByRole('heading', { name: 'Live Edge 会话' })).toBeInTheDocument();
    expect(screen.getAllByText('rg')).toHaveLength(2);
    expect(screen.getAllByText('持久化前的实时回答')).toHaveLength(1);
    expect(mockedUseRunEvidence).toHaveBeenLastCalledWith('run-live');

    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [
          {
            itemId: 'item-agent-live',
            projectId: 'project-1',
            threadId: 'thread-live',
            runId: 'run-live',
            type: 'agent_message',
            role: 'agent',
            status: 'completed',
            content: '持久化前的实时回答',
            createdAt: '2026-06-07T03:00:03Z',
            updatedAt: '2026-06-07T03:00:03Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);
    rerender(<App />);

    expect(screen.getAllByText('持久化前的实时回答')).toHaveLength(1);
    expect(mockedCreateEventStream).toHaveBeenCalledTimes(1);
  });

  it('submits composer text to the active Edge thread through the v4 platform adapter', async () => {
    mockedUseThreads.mockReturnValue({
      data: {
        items: [
          {
            threadId: 'thread-real',
            projectId: 'project-1',
            title: '真实 Edge 会话',
            status: 'active',
            createdAt: '2026-06-07T04:00:00Z',
            updatedAt: '2026-06-07T04:00:00Z',
          },
        ],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreads>);
    mockedUseThreadMessages.mockReturnValue({
      data: {
        items: [],
        page: { hasMore: false },
      },
    } as ReturnType<typeof useThreadMessages>);

    render(<App />);

    fireEvent.change(screen.getByLabelText('Composer input'), {
      target: { value: '跑一下 v4 smoke' },
    });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));

    await waitFor(() => {
      expect(createRunMutateAsync).toHaveBeenCalledTimes(1);
    });

    const submittedRun = createRunMutateAsync.mock.calls[0]?.[0];
    expect(submittedRun).toEqual({
      projectId: 'project-1',
      prompt: '跑一下 v4 smoke',
      threadId: 'thread-real',
    });
    expect(screen.getByLabelText('Composer input')).toHaveValue('');
  });
});

function createMockEventStream(): StreamHandle {
  return {
    subscribe(handler: EventHandler) {
      eventHandlers.push(handler);
      return () => {
        const index = eventHandlers.indexOf(handler);
        if (index >= 0) eventHandlers.splice(index, 1);
      };
    },
    onStatusChange(_handler: StatusHandler) {
      return () => {};
    },
    send: vi.fn(),
    getLatency: () => null,
    close: vi.fn(),
  };
}

function emitEdgeEvent(event: EventEnvelope): void {
  for (const handler of eventHandlers) handler(event);
}
