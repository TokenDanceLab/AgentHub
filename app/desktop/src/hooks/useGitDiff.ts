import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { parseUnifiedDiff, inferDiffStatus } from '@/utils/parseGitDiff';
import type { FileDiff } from '@/components/ChatView.types';

export interface UseGitDiffReturn {
  /** Parsed unstaged diffs */
  unstagedDiffs: FileDiff[];
  /** Parsed staged diffs */
  stagedDiffs: FileDiff[];
  /** All git diffs (merged), suitable for DiffViewer git tab */
  allDiffs: FileDiff[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches and parses git diffs for a given workspace directory.
 * Calls the Tauri `git_diff_unstaged` and `git_diff_staged` commands,
 * then parses the unified diff output into FileDiff structures with hunks.
 */
export function useGitDiff(workDir: string | null | undefined): UseGitDiffReturn {
  const [unstagedDiffs, setUnstagedDiffs] = useState<FileDiff[]>([]);
  const [stagedDiffs, setStagedDiffs] = useState<FileDiff[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (!workDir) {
      setUnstagedDiffs([]);
      setStagedDiffs([]);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      invoke<string>('git_diff_unstaged', { dir: workDir }).catch(() => ''),
      invoke<string>('git_diff_staged', { dir: workDir }).catch(() => ''),
    ])
      .then(([unstagedRaw, stagedRaw]) => {
        if (cancelled || !mountedRef.current) return;

        const unstaged = parseUnifiedDiff(unstagedRaw).map((f) => ({
          ...f,
          status: inferDiffStatus(f),
        }));
        const staged = parseUnifiedDiff(stagedRaw).map((f) => ({
          ...f,
          status: inferDiffStatus(f),
        }));

        setUnstagedDiffs(unstaged);
        setStagedDiffs(staged);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setUnstagedDiffs([]);
        setStagedDiffs([]);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workDir]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Merge staged and unstaged into all diffs. When the same file appears in both,
  // prefer the staged version (since the unstaged one would be incremental on top).
  const allDiffs = mergeStagedUnstaged(stagedDiffs, unstagedDiffs);

  return { unstagedDiffs, stagedDiffs, allDiffs, loading, error, refresh };
}

/**
 * Merge staged and unstaged diffs. When both exist for the same file,
 * prefer the staged version as the primary and mark the file appropriately.
 * This reflects the reality that staged + unstaged can differ for the same file.
 */
function mergeStagedUnstaged(staged: FileDiff[], unstaged: FileDiff[]): FileDiff[] {
  const merged = new Map<string, FileDiff>();

  // Prefer staging info as the base
  for (const diff of staged) {
    merged.set(diff.filePath, { ...diff });
  }

  // Add unstaged files not in staged; for files in both, the staged version takes priority
  for (const diff of unstaged) {
    if (!merged.has(diff.filePath)) {
      merged.set(diff.filePath, { ...diff });
    }
  }

  return [...merged.values()];
}
