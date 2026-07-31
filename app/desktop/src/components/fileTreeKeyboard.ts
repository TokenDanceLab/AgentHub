/**
 * Pure keyboard-navigation logic for the roving-tabindex file tree.
 *
 * The tree is a single-tab-stop widget: the container owns focus
 * (aria-activedescendant points at the active row) and arrow keys move a
 * "focus" cursor over the rows that are actually visible on screen (top-level
 * entries plus descendants of expanded directories). Keeping the resolution
 * logic here, free of React, makes it unit-testable without a DOM.
 */

/** Structural mirror of `FileEntry` (the shape `read_dir_tree` returns). */
export interface TreeEntryLike {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeEntryLike[] | null;
}

/**
 * Stable DOM id for a tree row, used both as the row element's `id` and as the
 * tree container's `aria-activedescendant` target. `encodeURIComponent` keeps
 * arbitrary paths id-safe (no spaces/colons) and identical on both sides.
 */
export function fileExplorerRowElementId(treeId: string, path: string): string {
  return `${treeId}-row-${encodeURIComponent(path)}`;
}

export interface VisibleTreeRow {
  path: string;
  isDir: boolean;
  /** Whether this directory's children are currently visible. Files are false. */
  isExpanded: boolean;
  /** Path of the parent row, or null for top-level rows. */
  parentPath: string | null;
}

/**
 * Flatten the visible tree into the ordered list of rows keyboard navigation
 * moves through: top-level entries first, then the children of every expanded
 * directory (depth-first, matching render order).
 */
export function buildVisibleRows(
  entries: readonly TreeEntryLike[],
  expanded: ReadonlySet<string>,
  parentPath: string | null = null,
): VisibleTreeRow[] {
  const rows: VisibleTreeRow[] = [];
  for (const entry of entries) {
    const isExpanded = entry.is_dir && expanded.has(entry.path);
    rows.push({ path: entry.path, isDir: entry.is_dir, isExpanded, parentPath });
    if (isExpanded && entry.children) {
      rows.push(...buildVisibleRows(entry.children, expanded, entry.path));
    }
  }
  return rows;
}

export type TreeKeyboardAction =
  | { kind: 'focus'; path: string }
  | { kind: 'expand'; path: string }
  | { kind: 'collapse'; path: string }
  | { kind: 'toggle'; path: string }
  | { kind: 'open'; path: string }
  /** Key is owned by the tree (prevent default) but changes nothing. */
  | { kind: 'noop' };

/**
 * Resolve a key press against the visible rows and the currently active row.
 * Returns `null` when the key is not owned by the tree (caller should let it
 * propagate). IDEA-style tree semantics:
 *
 * - ArrowDown / ArrowUp  — move focus to the next / previous visible row
 * - ArrowRight           — collapsed dir: expand; expanded dir: first child
 * - ArrowLeft            — expanded dir: collapse; otherwise: parent row
 * - Home / End           — first / last visible row
 * - Enter / Space        — file: open; dir: toggle expansion
 */
export function resolveTreeKeyboardAction(
  key: string,
  rows: readonly VisibleTreeRow[],
  currentPath: string | null | undefined,
): TreeKeyboardAction | null {
  if (rows.length === 0) return null;

  // Clamped index -> row; unreachable null keeps `noUncheckedIndexedAccess`
  // satisfied without assertions.
  const rowAt = (index: number): VisibleTreeRow | null => {
    if (index < 0 || index >= rows.length) return null;
    return rows[index] ?? null;
  };

  const currentIndex =
    currentPath == null ? -1 : rows.findIndex((row) => row.path === currentPath);
  const current = currentIndex >= 0 ? rows[currentIndex] : undefined;

  switch (key) {
    case 'ArrowDown': {
      const next = currentIndex < 0 ? 0 : Math.min(rows.length - 1, currentIndex + 1);
      const row = rowAt(next);
      if (!row) return null;
      return { kind: 'focus', path: row.path };
    }
    case 'ArrowUp': {
      const prev = currentIndex <= 0 ? 0 : currentIndex - 1;
      const row = rowAt(prev);
      if (!row) return null;
      return { kind: 'focus', path: row.path };
    }
    case 'ArrowRight': {
      if (!current) {
        const first = rowAt(0);
        if (!first) return null;
        return { kind: 'focus', path: first.path };
      }
      if (!current.isDir) return { kind: 'noop' };
      if (!current.isExpanded) return { kind: 'expand', path: current.path };
      // Already expanded: step into the first child (it directly follows in
      // render order when one is visible).
      const child = rowAt(currentIndex + 1);
      if (child && child.parentPath === current.path) {
        return { kind: 'focus', path: child.path };
      }
      return { kind: 'noop' };
    }
    case 'ArrowLeft': {
      if (!current) {
        const first = rowAt(0);
        if (!first) return null;
        return { kind: 'focus', path: first.path };
      }
      if (current.isDir && current.isExpanded) {
        return { kind: 'collapse', path: current.path };
      }
      if (current.parentPath != null) {
        return { kind: 'focus', path: current.parentPath };
      }
      return { kind: 'noop' };
    }
    case 'Home': {
      const first = rowAt(0);
      if (!first) return null;
      return { kind: 'focus', path: first.path };
    }
    case 'End': {
      const last = rowAt(rows.length - 1);
      if (!last) return null;
      return { kind: 'focus', path: last.path };
    }
    case 'Enter':
    case ' ': {
      if (!current) return { kind: 'noop' };
      if (!current.isDir) return { kind: 'open', path: current.path };
      return { kind: 'toggle', path: current.path };
    }
    default:
      return null;
  }
}
