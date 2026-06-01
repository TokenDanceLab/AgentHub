/**
 * Parse unified diff output (from `git diff` / `git diff --cached`) into
 * structured FileDiff objects suitable for DiffViewer rendering.
 */
import type { FileDiff, DiffHunk, DiffLine } from '@/components/ChatView.types';

/**
 * Parses raw unified diff output into an array of FileDiff objects.
 * Handles the standard format produced by `git diff` and `git diff --cached`.
 */
export function parseUnifiedDiff(diffText: string): FileDiff[] {
  if (!diffText || !diffText.trim()) return [];

  const files: FileDiff[] = [];
  const lines = diffText.split('\n');

  let currentFile: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldStart = 0;
  let newStart = 0;

  for (const line of lines) {
    // File header: "diff --git a/path b/path"
    if (line.startsWith('diff --git ')) {
      // Commit previous file
      if (currentFile) {
        addHunkIfAny(currentFile, currentHunk);
        files.push(currentFile);
      }
      currentFile = null;
      currentHunk = null;
      continue;
    }

    // New file / deleted file / rename indicators
    if (line.startsWith('new file mode') || line.startsWith('deleted file mode') || line.startsWith('old mode') || line.startsWith('index ')) {
      continue;
    }

    // Extract source/dest paths: "--- a/path" or "--- /dev/null"
    if (line.startsWith('--- ')) {
      if (!currentFile) {
        // Start of a new file diff
        currentFile = {
          filePath: '',
          status: 'modified',
          additions: 0,
          deletions: 0,
          hunks: [],
        };
      }
      const path = line.slice(6);
      if (path === '/dev/null') {
        // File was created
        if (currentFile) currentFile.status = 'added';
      }
      continue;
    }

    if (line.startsWith('+++ ')) {
      if (!currentFile) {
        currentFile = {
          filePath: '',
          status: 'modified',
          additions: 0,
          deletions: 0,
          hunks: [],
        };
      }
      const path = line.slice(6);
      if (path === '/dev/null') {
        currentFile.status = 'deleted';
      } else {
        // Strip the "b/" prefix
        currentFile.filePath = path.startsWith('b/') ? path.slice(2) : path;
      }
      continue;
    }

    // Hunk header: "@@ -oldStart,oldCount +newStart,newCount @@ context"
    if (line.startsWith('@@') && currentFile) {
      addHunkIfAny(currentFile, currentHunk);

      const match = line.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        oldStart = parseInt(match[1]!, 10);
        newStart = parseInt(match[3]!, 10);
      }

      currentHunk = {
        header: line,
        lines: [],
      };
      continue;
    }

    // Content lines
    if (currentFile && currentHunk) {
      if (line.startsWith('+')) {
        currentHunk.lines.push({
          type: 'added',
          oldLineNumber: undefined,
          newLineNumber: newStart,
          content: line.slice(1),
        });
        currentFile.additions += 1;
        newStart += 1;
      } else if (line.startsWith('-')) {
        currentHunk.lines.push({
          type: 'deleted',
          oldLineNumber: oldStart,
          newLineNumber: undefined,
          content: line.slice(1),
        });
        currentFile.deletions += 1;
        oldStart += 1;
      } else if (line.startsWith(' ') || line === '') {
        currentHunk.lines.push({
          type: 'context',
          oldLineNumber: oldStart,
          newLineNumber: newStart,
          content: line.startsWith(' ') ? line.slice(1) : '',
        });
        oldStart += 1;
        newStart += 1;
      }
      // Skip '\ No newline at end of file' markers and other non-standard lines
    }
  }

  // Commit last file
  if (currentFile) {
    addHunkIfAny(currentFile, currentHunk);
    files.push(currentFile);
  }

  return files;
}

function addHunkIfAny(file: FileDiff, hunk: DiffHunk | null): void {
  if (hunk && hunk.lines.length > 0) {
    file.hunks.push(hunk);
  }
}

/**
 * Detect file status from parsed diff data.
 * Overwrites the initial status if a more specific one can be inferred.
 */
export function inferDiffStatus(file: FileDiff): FileDiff['status'] {
  if (file.additions > 0 && file.deletions === 0 && file.status === 'added') {
    return 'added';
  }
  if (file.deletions > 0 && file.additions === 0 && file.status === 'deleted') {
    return 'deleted';
  }
  // Check if all lines in all hunks are 'added' (new file with no deletions)
  const allAdded = file.hunks.every((h) => h.lines.every((l) => l.type === 'added' || l.type === 'context'));
  const allDeleted = file.hunks.every((h) => h.lines.every((l) => l.type === 'deleted' || l.type === 'context'));
  if (allAdded && file.deletions === 0) return 'added';
  if (allDeleted && file.additions === 0) return 'deleted';
  return 'modified';
}
