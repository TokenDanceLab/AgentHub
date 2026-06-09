import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDiff } from '@shared/types/chat';
import { useRunEvidence } from './runEvidenceQueries';
import { fetchArtifacts, fetchPreviews, fetchRunDiff } from './edgeClient';

vi.mock('./edgeClient', () => ({
  fetchArtifacts: vi.fn(),
  fetchPreviews: vi.fn(),
  fetchRunDiff: vi.fn(),
}));

function createWrapper(): React.FC<React.PropsWithChildren> {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  return function Wrapper({ children }: React.PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function emptyList<T>() {
  return { items: [] as T[], page: { hasMore: false } };
}

describe('useRunEvidence', () => {
  beforeEach(() => {
    vi.mocked(fetchArtifacts).mockResolvedValue(emptyList());
    vi.mocked(fetchPreviews).mockResolvedValue(emptyList());
    vi.mocked(fetchRunDiff).mockResolvedValue({ runId: 'run-1', files: [] });
  });

  it('collects Edge diff, artifact, and preview metadata for the inspector', async () => {
    vi.mocked(fetchRunDiff).mockResolvedValue({
      runId: 'run-1',
      files: [{
        path: 'src/runtime.ts',
        status: 'modified',
        diff: '@@ -1 +1 @@\n-old runtime\n+new runtime',
      }],
    });
    vi.mocked(fetchArtifacts).mockResolvedValue({
      items: [
        {
          id: 'artifact-1',
          runId: 'run-1',
          threadId: 'thread-1',
          kind: 'patch',
          path: 'reports/runtime.patch',
          sizeBytes: 128,
          createdAt: '2026-06-08T08:00:00.000Z',
        },
        {
          id: 'artifact-other',
          runId: 'run-other',
          threadId: 'thread-1',
          kind: 'log',
          path: 'reports/other.log',
          sizeBytes: 64,
          createdAt: '2026-06-08T08:01:00.000Z',
        },
      ],
      page: { hasMore: false },
    });
    vi.mocked(fetchPreviews).mockResolvedValue({
      items: [{
        id: 'preview-1',
        runId: 'run-1',
        threadId: 'thread-1',
        url: 'http://127.0.0.1:4173/preview',
        status: 'ready',
        createdAt: '2026-06-08T08:02:00.000Z',
      }],
      page: { hasMore: false },
    });

    const { result } = renderHook(() => useRunEvidence('run-1'), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.previewLoading).toBe(false));

    expect(fetchRunDiff).toHaveBeenCalledWith('run-1');
    expect(result.current.diffs).toHaveLength(1);
    expect(result.current.diffs[0]).toMatchObject({ filePath: 'src/runtime.ts', status: 'modified' });
    expect(result.current.artifacts.map((artifact) => artifact.id)).toEqual(['artifact-1']);
    expect(result.current.previews.map((preview) => preview.id)).toEqual(['preview-1']);
    expect(result.current.diffSource).toBe('edge');
    expect(result.current.artifactSource).toBe('edge');
    expect(result.current.previewSource).toBe('edge');
  });

  it('keeps event diffs as the read-only fallback when Edge has no diff snapshot', async () => {
    const eventDiffs: FileDiff[] = [{
      filePath: 'src/event.ts',
      status: 'modified',
      additions: 1,
      deletions: 0,
      hunks: [{
        header: '@@ event @@',
        lines: [{ type: 'added', content: 'event diff' }],
      }],
    }];

    const { result } = renderHook(() => useRunEvidence('run-1', eventDiffs), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.diffLoading).toBe(false));

    expect(result.current.diffs).toEqual(eventDiffs);
    expect(result.current.diffSource).toBe('event');
    expect(result.current.artifactSource).toBe('none');
    expect(result.current.previewSource).toBe('none');
  });
});
