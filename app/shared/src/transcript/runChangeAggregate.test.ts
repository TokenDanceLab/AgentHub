import { describe, expect, it } from 'vitest';
import type {
  FileChangeTranscriptBlock,
  RunStepGroupTranscriptBlock,
  TranscriptAuthor,
  TranscriptBlock,
} from './types';
import {
  collectRunReviewFiles,
  countHunkLines,
  fileChangeActionToReviewStatus,
  fileChangeBlockHunks,
  fileChangeBlockToReviewFile,
  summarizeRunReviewFiles,
} from './runChangeAggregate';

const author: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'agent' };

function fileChange(overrides: Partial<FileChangeTranscriptBlock> & { path: string }): FileChangeTranscriptBlock {
  return {
    id: `fc-${overrides.path}`,
    kind: 'file_change',
    author,
    action: 'modified',
    ...overrides,
  };
}

function runStepGroup(children: TranscriptBlock[]): RunStepGroupTranscriptBlock {
  return {
    id: 'group-1',
    kind: 'run_step_group',
    author,
    icon: 'run',
    title: 'Run',
    status: 'running',
    children,
  };
}

const UNIFIED_PATCH = [
  '--- a/src/app.ts',
  '+++ b/src/app.ts',
  '@@ -1,3 +1,4 @@',
  ' import a from "a";',
  '-const old = true;',
  '+const next = false;',
  '+const extra = 1;',
  ' export default a;',
].join('\n');

describe('runChangeAggregate (#1967)', () => {
  describe('fileChangeActionToReviewStatus', () => {
    it('maps created/deleted/modified onto the panel statuses', () => {
      expect(fileChangeActionToReviewStatus('created')).toBe('added');
      expect(fileChangeActionToReviewStatus('deleted')).toBe('deleted');
      expect(fileChangeActionToReviewStatus('modified')).toBe('modified');
    });
  });

  describe('fileChangeBlockHunks', () => {
    it('parses a unified patch into real hunks with line numbers', () => {
      const hunks = fileChangeBlockHunks(fileChange({ path: 'src/app.ts', patch: UNIFIED_PATCH }));
      expect(hunks).toHaveLength(1);
      const hunk = hunks[0]!;
      expect(hunk.header).toContain('@@');
      const types = hunk.lines.map((line) => line.type);
      expect(types).toContain('context');
      expect(types).toContain('deleted');
      expect(types).toContain('added');
      const added = hunk.lines.find((line) => line.type === 'added');
      expect(added?.newLineNumber).toBeTypeOf('number');
    });

    it('parses multi-hunk patches into one hunk per section', () => {
      const patch = [
        '--- a/f.ts',
        '+++ b/f.ts',
        '@@ -1,2 +1,2 @@',
        '-a',
        '+b',
        ' ctx',
        '@@ -10,2 +10,2 @@',
        '-c',
        '+d',
        ' ctx2',
      ].join('\n');
      const hunks = fileChangeBlockHunks(fileChange({ path: 'f.ts', patch: patch }));
      expect(hunks).toHaveLength(2);
    });

    it('falls back to a synthetic hunk from pre-tokenized lines when there is no patch', () => {
      const hunks = fileChangeBlockHunks(fileChange({
        path: 'src/b.ts',
        lines: [
          { type: 'ctx', content: 'keep' },
          { type: 'del', content: 'old' },
          { type: 'add', content: 'new' },
        ],
      }));
      expect(hunks).toHaveLength(1);
      expect(hunks[0]!.lines.map((line) => line.type)).toEqual(['context', 'deleted', 'added']);
      expect(hunks[0]!.lines.map((line) => line.content)).toEqual(['keep', 'old', 'new']);
    });

    it('falls back to lines when the patch is malformed', () => {
      const hunks = fileChangeBlockHunks(fileChange({
        path: 'src/c.ts',
        patch: 'this is not a unified diff',
        lines: [{ type: 'add', content: 'x' }],
      }));
      expect(hunks).toHaveLength(1);
      expect(hunks[0]!.lines[0]?.type).toBe('added');
    });

    it('returns no hunks when the block carries neither patch nor lines', () => {
      expect(fileChangeBlockHunks(fileChange({ path: 'src/d.ts' }))).toEqual([]);
    });
  });

  describe('fileChangeBlockToReviewFile', () => {
    it('keeps explicit additions/deletions when provided', () => {
      const file = fileChangeBlockToReviewFile(fileChange({
        path: 'src/app.ts',
        action: 'modified',
        patch: UNIFIED_PATCH,
        additions: 7,
        deletions: 3,
      }));
      expect(file.filePath).toBe('src/app.ts');
      expect(file.status).toBe('modified');
      expect(file.additions).toBe(7);
      expect(file.deletions).toBe(3);
    });

    it('derives additions/deletions from hunks when the block omits them', () => {
      const file = fileChangeBlockToReviewFile(fileChange({ path: 'src/app.ts', patch: UNIFIED_PATCH }));
      expect(file.additions).toBe(countHunkLines(file.hunks, 'added'));
      expect(file.deletions).toBe(countHunkLines(file.hunks, 'deleted'));
      expect(file.additions).toBe(2);
      expect(file.deletions).toBe(1);
    });
  });

  describe('collectRunReviewFiles', () => {
    it('collects top-level file changes in order', () => {
      const files = collectRunReviewFiles([
        fileChange({ path: 'a.ts', action: 'created', lines: [{ type: 'add', content: 'a' }] }),
        fileChange({ path: 'b.ts', action: 'deleted', lines: [{ type: 'del', content: 'b' }] }),
      ]);
      expect(files.map((file) => file.filePath)).toEqual(['a.ts', 'b.ts']);
      expect(files.map((file) => file.status)).toEqual(['added', 'deleted']);
    });

    it('recurses into run_step_group children', () => {
      const files = collectRunReviewFiles([
        runStepGroup([
          fileChange({ path: 'nested.ts', lines: [{ type: 'add', content: 'n' }] }),
        ]),
      ]);
      expect(files.map((file) => file.filePath)).toEqual(['nested.ts']);
    });

    it('ignores unrelated block kinds', () => {
      const files = collectRunReviewFiles([
        {
          id: 'text-1',
          kind: 'text',
          author,
          text: 'hello',
        },
        fileChange({ path: 'a.ts' }),
      ]);
      expect(files).toHaveLength(1);
    });

    it('lets a later change of the same path supersede the earlier one', () => {
      const files = collectRunReviewFiles([
        fileChange({ path: 'a.ts', additions: 1, deletions: 0, lines: [{ type: 'add', content: 'v1' }] }),
        fileChange({ path: 'a.ts', additions: 2, deletions: 1, lines: [
          { type: 'add', content: 'v2-a' },
          { type: 'add', content: 'v2-b' },
          { type: 'del', content: 'v1' },
        ] }),
      ]);
      expect(files).toHaveLength(1);
      expect(files[0]!.additions).toBe(2);
      expect(files[0]!.deletions).toBe(1);
      const contents = files[0]!.hunks[0]!.lines.map((line) => line.content);
      expect(contents).toEqual(['v2-a', 'v2-b', 'v1']);
    });

    it('returns an empty list for an empty transcript', () => {
      expect(collectRunReviewFiles([])).toEqual([]);
    });
  });

  describe('summarizeRunReviewFiles', () => {
    it('aggregates file/addition/deletion/hunk totals', () => {
      const files = collectRunReviewFiles([
        fileChange({ path: 'a.ts', patch: UNIFIED_PATCH }),
        fileChange({ path: 'b.ts', lines: [{ type: 'add', content: 'x' }] }),
      ]);
      const summary = summarizeRunReviewFiles(files);
      expect(summary.fileCount).toBe(2);
      expect(summary.additions).toBe(3);
      expect(summary.deletions).toBe(1);
      expect(summary.hunkCount).toBe(2);
    });

    it('reports zeros for no files', () => {
      expect(summarizeRunReviewFiles([])).toEqual({
        fileCount: 0,
        additions: 0,
        deletions: 0,
        hunkCount: 0,
      });
    });
  });
});
