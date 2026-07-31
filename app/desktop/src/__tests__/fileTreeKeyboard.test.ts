import { describe, it, expect } from 'vitest';
import {
  buildVisibleRows,
  resolveTreeKeyboardAction,
  type TreeEntryLike,
} from '@/components/fileTreeKeyboard';

// Fixture tree (paths are plain strings — separator-agnostic in the pure module)
function makeTree(): TreeEntryLike[] {
  return [
    {
      name: 'src',
      path: '/repo/src',
      is_dir: true,
      children: [
        { name: 'index.ts', path: '/repo/src/index.ts', is_dir: false, children: null },
        {
          name: 'components',
          path: '/repo/src/components',
          is_dir: true,
          children: [
            { name: 'App.tsx', path: '/repo/src/components/App.tsx', is_dir: false, children: null },
          ],
        },
        { name: 'main.tsx', path: '/repo/src/main.tsx', is_dir: false, children: null },
      ],
    },
    { name: 'README.md', path: '/repo/README.md', is_dir: false, children: null },
    { name: 'pkg', path: '/repo/pkg', is_dir: true, children: null },
  ];
}

function paths(rows: ReturnType<typeof buildVisibleRows>): string[] {
  return rows.map((r) => r.path);
}

describe('buildVisibleRows', () => {
  it('flattens top-level entries in order when nothing is expanded', () => {
    const rows = buildVisibleRows(makeTree(), new Set());
    expect(paths(rows)).toEqual(['/repo/src', '/repo/README.md', '/repo/pkg']);
    expect(rows[0]).toMatchObject({ isDir: true, isExpanded: false, parentPath: null });
    expect(rows[1]).toMatchObject({ isDir: false, isExpanded: false, parentPath: null });
  });

  it('descends into expanded directories depth-first, matching render order', () => {
    const rows = buildVisibleRows(makeTree(), new Set(['/repo/src', '/repo/src/components']));
    expect(paths(rows)).toEqual([
      '/repo/src',
      '/repo/src/index.ts',
      '/repo/src/components',
      '/repo/src/components/App.tsx',
      '/repo/src/main.tsx',
      '/repo/README.md',
      '/repo/pkg',
    ]);
  });

  it('marks expanded rows and wires parentPath for children', () => {
    const rows = buildVisibleRows(makeTree(), new Set(['/repo/src']));
    const src = rows[0];
    const index = rows[1];
    const components = rows[2];
    expect(src).toMatchObject({ isDir: true, isExpanded: true, parentPath: null });
    expect(index).toMatchObject({ isDir: false, isExpanded: false, parentPath: '/repo/src' });
    // Collapsed nested dir is rendered as a row but not descended into
    expect(components).toMatchObject({ isDir: true, isExpanded: false, parentPath: '/repo/src' });
  });

  it('returns an empty list for an empty tree', () => {
    expect(buildVisibleRows([], new Set())).toEqual([]);
  });
});

describe('resolveTreeKeyboardAction', () => {
  const rows = buildVisibleRows(makeTree(), new Set(['/repo/src']));

  it('returns null for keys the tree does not own', () => {
    expect(resolveTreeKeyboardAction('a', rows, undefined)).toBeNull();
    expect(resolveTreeKeyboardAction('Escape', rows, '/repo/src')).toBeNull();
    expect(resolveTreeKeyboardAction('F2', rows, '/repo/src')).toBeNull();
  });

  it('returns null when there are no visible rows', () => {
    expect(resolveTreeKeyboardAction('ArrowDown', [], undefined)).toBeNull();
  });

  it('ArrowDown moves to the next visible row, clamped at the end', () => {
    expect(resolveTreeKeyboardAction('ArrowDown', rows, '/repo/src')).toEqual({
      kind: 'focus',
      path: '/repo/src/index.ts',
    });
    const last = rows[rows.length - 1].path;
    expect(resolveTreeKeyboardAction('ArrowDown', rows, last)).toEqual({
      kind: 'focus',
      path: last,
    });
  });

  it('ArrowDown with no current row focuses the first row', () => {
    expect(resolveTreeKeyboardAction('ArrowDown', rows, undefined)).toEqual({
      kind: 'focus',
      path: '/repo/src',
    });
  });

  it('ArrowUp moves to the previous visible row, clamped at the start', () => {
    expect(resolveTreeKeyboardAction('ArrowUp', rows, '/repo/src/index.ts')).toEqual({
      kind: 'focus',
      path: '/repo/src',
    });
    expect(resolveTreeKeyboardAction('ArrowUp', rows, '/repo/src')).toEqual({
      kind: 'focus',
      path: '/repo/src',
    });
  });

  it('Home and End jump to the first and last visible rows', () => {
    expect(resolveTreeKeyboardAction('Home', rows, '/repo/src/main.tsx')).toEqual({
      kind: 'focus',
      path: '/repo/src',
    });
    expect(resolveTreeKeyboardAction('End', rows, '/repo/src')).toEqual({
      kind: 'focus',
      path: '/repo/pkg',
    });
  });

  it('ArrowRight expands a collapsed directory', () => {
    expect(resolveTreeKeyboardAction('ArrowRight', rows, '/repo/pkg')).toEqual({
      kind: 'expand',
      path: '/repo/pkg',
    });
  });

  it('ArrowRight on an expanded directory steps into its first child', () => {
    expect(resolveTreeKeyboardAction('ArrowRight', rows, '/repo/src')).toEqual({
      kind: 'focus',
      path: '/repo/src/index.ts',
    });
  });

  it('ArrowRight on an expanded directory without visible children is a noop', () => {
    const emptyDirRows = buildVisibleRows(
      [{ name: 'empty', path: '/x', is_dir: true, children: [] }],
      new Set(['/x']),
    );
    expect(resolveTreeKeyboardAction('ArrowRight', emptyDirRows, '/x')).toEqual({
      kind: 'noop',
    });
  });

  it('ArrowRight on a file is a noop', () => {
    expect(resolveTreeKeyboardAction('ArrowRight', rows, '/repo/src/index.ts')).toEqual({
      kind: 'noop',
    });
  });

  it('ArrowLeft collapses an expanded directory', () => {
    expect(resolveTreeKeyboardAction('ArrowLeft', rows, '/repo/src')).toEqual({
      kind: 'collapse',
      path: '/repo/src',
    });
  });

  it('ArrowLeft on a child row focuses the parent', () => {
    expect(resolveTreeKeyboardAction('ArrowLeft', rows, '/repo/src/index.ts')).toEqual({
      kind: 'focus',
      path: '/repo/src',
    });
  });

  it('ArrowLeft on a collapsed directory is a noop at the root level', () => {
    expect(resolveTreeKeyboardAction('ArrowLeft', rows, '/repo/pkg')).toEqual({
      kind: 'noop',
    });
  });

  it('ArrowLeft on a top-level file is a noop', () => {
    expect(resolveTreeKeyboardAction('ArrowLeft', rows, '/repo/README.md')).toEqual({
      kind: 'noop',
    });
  });

  it('Enter opens a file and toggles a directory', () => {
    expect(resolveTreeKeyboardAction('Enter', rows, '/repo/src/index.ts')).toEqual({
      kind: 'open',
      path: '/repo/src/index.ts',
    });
    expect(resolveTreeKeyboardAction('Enter', rows, '/repo/src')).toEqual({
      kind: 'toggle',
      path: '/repo/src',
    });
  });

  it('Space behaves like Enter', () => {
    expect(resolveTreeKeyboardAction(' ', rows, '/repo/src/index.ts')).toEqual({
      kind: 'open',
      path: '/repo/src/index.ts',
    });
    expect(resolveTreeKeyboardAction(' ', rows, '/repo/pkg')).toEqual({
      kind: 'toggle',
      path: '/repo/pkg',
    });
  });
});
