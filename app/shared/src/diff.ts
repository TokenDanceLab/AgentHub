import { parsePatch, structuredPatch, formatPatch, type StructuredPatch } from 'diff';

// ── Diff types ──────────────────────────────────

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'added' | 'deleted' | 'context';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffFile {
  filePath: string;
  status: 'added' | 'deleted' | 'modified';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ParsedPatch {
  before: string;
  after: string;
  hunks: DiffHunk[];
}

export interface ViewDiff {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
  hunks: DiffHunk[];
}

export interface LegacyDiff {
  file: string;
  patch?: string;
  before?: string;
  after?: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
}

export type ReviewDiff = LegacyDiff;

// ── Type guards ─────────────────────────────────

function lineType(raw: string): DiffLine['type'] {
  if (raw.startsWith('+')) return 'added';
  if (raw.startsWith('-')) return 'deleted';
  return 'context';
}

function diffStatus(patch: StructuredPatch): DiffFile['status'] {
  if (patch.oldFileName === '/dev/null') return 'added';
  if (patch.newFileName === '/dev/null') return 'deleted';
  return 'modified';
}

function diffFilePath(patch: StructuredPatch): string {
  const name = [patch.newFileName, patch.oldFileName].find(
    (n) => n && n !== '/dev/null',
  ) ?? 'unknown';
  return name.replace(/^[ab]\//, '');
}

// ── Low-level diff parsing ──────────────────────

/**
 * Parse a unified-diff patch string into before/after text and structured hunks.
 * Handles multi-hunk diffs, missing-final-newline markers, and malformed input.
 */
export function parseUnifiedPatch(patch: string): ParsedPatch {
  const beforeLines: string[] = [];
  const afterLines: string[] = [];
  const hunks: DiffHunk[] = [];

  if (!patch) return { before: '', after: '', hunks: [] };

  try {
    const [parsed] = parsePatch(patch);
    if (!parsed) return { before: '', after: '', hunks: [] };

    for (const h of parsed.hunks) {
      const lines: DiffLine[] = [];
      let oldLineNum = h.oldStart;
      let newLineNum = h.newStart;

      for (const line of h.lines) {
        // Missing-final-newline marker
        if (line.startsWith('\\')) {
          const prevLine = lines[lines.length - 1];
          if (prevLine && (prevLine.type === 'context' || prevLine.type === 'deleted')) {
            const lastIdx = beforeLines.length - 1;
            if (lastIdx >= 0 && beforeLines[lastIdx].endsWith('\n')) {
              beforeLines[lastIdx] = beforeLines[lastIdx].slice(0, -1);
            }
          }
          if (prevLine && (prevLine.type === 'context' || prevLine.type === 'added')) {
            const lastIdx = afterLines.length - 1;
            if (lastIdx >= 0 && afterLines[lastIdx].endsWith('\n')) {
              afterLines[lastIdx] = afterLines[lastIdx].slice(0, -1);
            }
          }
          continue;
        }

        const type = lineType(line);
        const content = line.slice(1);

        if (type === 'added') {
          afterLines.push(content + '\n');
          lines.push({ type, content, newLineNumber: newLineNum++ });
        } else if (type === 'deleted') {
          beforeLines.push(content + '\n');
          lines.push({ type, content, oldLineNumber: oldLineNum++ });
        } else {
          beforeLines.push(content + '\n');
          afterLines.push(content + '\n');
          lines.push({
            type,
            content,
            oldLineNumber: oldLineNum++,
            newLineNumber: newLineNum++,
          });
        }
      }
      const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
      hunks.push({ header, lines });
    }

    return { before: beforeLines.join(''), after: afterLines.join(''), hunks };
  } catch {
    return { before: '', after: '', hunks: [] };
  }
}

/**
 * Normalize a single diff input into a ViewDiff with structured hunks.
 * Handles unified patches, legacy before/after inputs, empty diffs, and malformed patches.
 */
export function normalize(diff: ReviewDiff): ViewDiff {
  if (diff.patch) {
    const parsed = parseUnifiedPatch(diff.patch);
    if (parsed.hunks.length > 0) {
      return {
        file: diff.file,
        patch: diff.patch,
        additions: diff.additions,
        deletions: diff.deletions,
        status: diff.status,
        hunks: parsed.hunks,
      };
    }
    // Malformed patch that produced no hunks — return with empty hunks
    return {
      file: diff.file,
      patch: diff.patch,
      additions: diff.additions,
      deletions: diff.deletions,
      status: diff.status,
      hunks: [],
    };
  }

  // Legacy: before/after text → build unified patch
  const before = diff.before ?? '';
  const after = diff.after ?? '';

  if (!before && !after) {
    return {
      file: diff.file,
      patch: '',
      additions: diff.additions,
      deletions: diff.deletions,
      status: diff.status,
      hunks: [],
    };
  }

  const builtPatch = formatPatch(
    structuredPatch(diff.file, diff.file, before, after, '', '', {
      context: Number.MAX_SAFE_INTEGER,
    }),
  );
  return normalize({
    file: diff.file,
    patch: builtPatch,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
  });
}

/** Extract plain text from one side of a diff for preview. */
export function text(diff: ViewDiff, side: 'deletions' | 'additions'): string {
  let result = '';
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      if (side === 'deletions' && line.type !== 'added') {
        result += line.content + '\n';
      } else if (side === 'additions' && line.type !== 'deleted') {
        result += line.content + '\n';
      }
    }
  }
  return result;
}


// ── High-level helpers ──────────────────────────

function isDiffFile(value: unknown): value is DiffFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  if (typeof d.filePath !== 'string') return false;
  if (
    d.status !== 'added' &&
    d.status !== 'deleted' &&
    d.status !== 'modified'
  )
    return false;
  if (typeof d.additions !== 'number') return false;
  if (typeof d.deletions !== 'number') return false;
  return true;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** Normalize various diff representations into a consistent DiffFile[]. */
export function normalizeDiffs(value: unknown): DiffFile[] {
  if (Array.isArray(value) && value.every(isDiffFile)) return value;
  if (Array.isArray(value)) return value.filter(isDiffFile);
  if (isDiffFile(value)) return [value];
  if (!isObject(value)) return [];
  return Object.values(value).filter(isDiffFile);
}

/** Parse a unified-diff string (with git headers) into structured DiffFile objects. */
export function parseUnifiedDiff(
  text: string,
  filePath?: string,
): DiffFile[] {
  if (!text) return [];
  try {
    return parsePatch(text).map((patch) => {
      const status = filePath ? 'modified' : diffStatus(patch);
      const path = filePath ?? diffFilePath(patch);

      let additions = 0;
      let deletions = 0;
      const hunks: DiffHunk[] = patch.hunks.map((h) => {
        const header = `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`;
        const lines: DiffLine[] = h.lines.map((line, i) => {
          const type = lineType(line);
          if (type === 'added') additions++;
          if (type === 'deleted') deletions++;
          return {
            type,
            content: line.slice(1),
            oldLineNumber: type !== 'added'
              ? (h.oldStart ?? 0) + i
              : undefined,
            newLineNumber: type !== 'deleted'
              ? (h.newStart ?? 0) + i
              : undefined,
          };
        });
        return { header, lines };
      });

      return { filePath: path, status, additions, deletions, hunks };
    });
  } catch {
    return [];
  }
}
