import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface GitFileStatus {
  path: string;
  index_status: string;
  worktree_status: string;
  original_path: string | null;
}

export interface GitStatus {
  branch: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
}

export interface UseGitStatusReturn {
  status: GitStatus | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Returns the git status for a given workspace directory.
 * Uses the Tauri `git_status` command which wraps `git status --porcelain -b`.
 */
export function useGitStatus(workDir: string | null | undefined): UseGitStatusReturn {
  const [status, setStatus] = useState<GitStatus | null>(null);
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
      setStatus(null);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    invoke<GitStatus>('git_status', { dir: workDir })
      .then((result) => {
        if (cancelled || !mountedRef.current) return;
        setStatus(result);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus(null);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [workDir]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { status, loading, error, refresh };
}

/**
 * Derives a composite git status character for a given file path.
 * Returns the most significant status: U(conflict) > M/D/A/R > ?
 */
export function gitStatusChar(git: GitStatus | null, filePath: string): string | null {
  if (!git) return null;
  const entry = git.files.find((f) => f.path === filePath);
  if (!entry) return null;

  // Conflict detection
  const both = entry.index_status + entry.worktree_status;
  if (both === 'UU' || both === 'AA' || both === 'DD' || both === 'AU' || both === 'UA' || both === 'DU' || both === 'UD') {
    return 'U';
  }

  // Worktree status takes priority for visual overlay
  if (entry.worktree_status !== ' ' && entry.worktree_status !== '?') {
    return entry.worktree_status.toUpperCase();
  }

  // Index status
  if (entry.index_status !== ' ' && entry.index_status !== '?') {
    return entry.index_status.toUpperCase();
  }

  // Untracked
  if (entry.worktree_status === '?' || entry.index_status === '?') {
    return '?';
  }

  return null;
}
