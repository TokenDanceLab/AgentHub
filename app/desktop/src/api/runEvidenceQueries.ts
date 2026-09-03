import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { parseUnifiedDiff } from '@shared/diff';
import type { RuntimeEvidenceSource } from '@shared/inspector';
import type { Artifact, Preview, RunDiff } from '@shared/types';
import type { FileDiff } from '@shared/types/chat';
import { fetchArtifacts, fetchPreviews, fetchRunDiff } from './edgeClient';

interface RunEvidenceState {
  diffs: FileDiff[];
  artifacts: Artifact[];
  previews: Preview[];
  diffLoading: boolean;
  artifactLoading: boolean;
  previewLoading: boolean;
  diffError: boolean;
  artifactError: boolean;
  previewError: boolean;
  diffSource: RuntimeEvidenceSource;
  artifactSource: RuntimeEvidenceSource;
  previewSource: RuntimeEvidenceSource;
}

function fallbackDiff(file: RunDiff['files'][number]): FileDiff {
  const lines = file.diff.split(/\r?\n/).filter(Boolean);
  let additions = 0;
  let deletions = 0;
  const diffLines = lines.map((line) => {
    const type: 'added' | 'deleted' | 'context' = line.startsWith('+')
      ? 'added'
      : line.startsWith('-')
        ? 'deleted'
        : 'context';
    if (type === 'added') additions += 1;
    if (type === 'deleted') deletions += 1;
    return {
      type,
      content: line.replace(/^[-+ ]/, ''),
    };
  });
  return {
    filePath: file.path,
    status: file.status,
    additions,
    deletions,
    hunks: [{
      header: '@@ Edge run diff @@',
      lines: diffLines,
    }],
  };
}

function toReviewDiffs(runDiff: RunDiff | undefined): FileDiff[] {
  if (!runDiff) return [];
  return runDiff.files.flatMap((file) => {
    const parsed = parseUnifiedDiff(file.diff, file.path) as FileDiff[];
    if (parsed.length > 0) {
      return parsed.map((diff) => ({ ...diff, filePath: diff.filePath || file.path, status: file.status }));
    }
    return [fallbackDiff(file)];
  });
}

export function useRunEvidence(runId: string | undefined, eventDiffs: FileDiff[] = []): RunEvidenceState {
  const enabled = Boolean(runId);
  const diffQuery = useQuery({
    queryKey: ['runEvidence', runId, 'diff'],
    queryFn: () => fetchRunDiff(runId as string),
    enabled,
    retry: false,
    staleTime: 5_000,
  });
  const artifactQuery = useQuery({
    queryKey: ['runEvidence', runId, 'artifacts'],
    queryFn: fetchArtifacts,
    enabled,
    retry: false,
    staleTime: 5_000,
  });
  const previewQuery = useQuery({
    queryKey: ['runEvidence', runId, 'previews'],
    queryFn: fetchPreviews,
    enabled,
    retry: false,
    staleTime: 5_000,
  });

  const edgeDiffs = useMemo(() => toReviewDiffs(diffQuery.data), [diffQuery.data]);
  const diffs = useMemo(() => (
    edgeDiffs.length > 0 ? edgeDiffs : eventDiffs
  ), [edgeDiffs, eventDiffs]);

  const artifacts = useMemo(
    () => (artifactQuery.data?.items ?? []).filter((artifact) => artifact.runId === runId),
    [artifactQuery.data?.items, runId],
  );
  const previews = useMemo(
    () => (previewQuery.data?.items ?? []).filter((preview) => preview.runId === runId),
    [previewQuery.data?.items, runId],
  );

  return {
    diffs,
    artifacts,
    previews,
    diffLoading: diffQuery.isLoading,
    artifactLoading: artifactQuery.isLoading,
    previewLoading: previewQuery.isLoading,
    diffError: diffQuery.isError,
    artifactError: artifactQuery.isError,
    previewError: previewQuery.isError,
    diffSource: edgeDiffs.length > 0 ? 'edge' : eventDiffs.length > 0 ? 'event' : 'none',
    artifactSource: artifacts.length > 0 ? 'edge' : 'none',
    previewSource: previews.length > 0 ? 'edge' : 'none',
  };
}
