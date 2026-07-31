import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import FileExplorer, { type FileEntry } from '@/components/FileExplorer';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  ask: vi.fn().mockResolvedValue(true),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { invoke } from '@tauri-apps/api/core';

// /repo/src and /repo/pkg are auto-expanded on load (first-level dirs).
const FIXTURE_TREE: FileEntry[] = [
  {
    name: 'src',
    path: '/repo/src',
    is_dir: true,
    children: [
      { name: 'index.ts', path: '/repo/src/index.ts', is_dir: false, children: null },
      { name: 'main.tsx', path: '/repo/src/main.tsx', is_dir: false, children: null },
    ],
  },
  { name: 'README.md', path: '/repo/README.md', is_dir: false, children: null },
  {
    name: 'pkg',
    path: '/repo/pkg',
    is_dir: true,
    children: [{ name: 'dist', path: '/repo/pkg/dist', is_dir: false, children: null }],
  },
];

const ROW_SELECTOR = '[data-tree-row-path]';

function rowByPath(path: string): HTMLElement {
  const row = document.querySelector(`[data-tree-row-path="${path}"]`);
  if (!row) throw new Error(`row not found: ${path}`);
  return row as HTMLElement;
}

function getTree(): HTMLElement {
  const tree = screen.getByRole('tree');
  return tree;
}

function keyDownOnTree(tree: HTMLElement, key: string): void {
  fireEvent.keyDown(tree, { key });
}

async function renderTree(onFileSelect = vi.fn()) {
  (invoke as ReturnType<typeof vi.fn>).mockImplementation((cmd: string) =>
    cmd === 'read_dir_tree' ? Promise.resolve(FIXTURE_TREE) : Promise.reject(new Error(`unexpected ${cmd}`)),
  );
  const utils = render(<FileExplorer rootDir="/repo" onFileSelect={onFileSelect} />);
  // Wait for the tree to load and auto-expand first level
  await screen.findAllByRole('treeitem');
  return utils;
}

beforeEach(() => {
  // jsdom does not implement scrollIntoView
  Element.prototype.scrollIntoView = vi.fn();
});

describe('FileExplorer roving tabindex', () => {
  it('makes the tree wrapper the single tab stop and rows non-focusable', async () => {
    await renderTree();
    const tree = getTree();
    expect(tree).toHaveAttribute('tabindex', '0');
    for (const row of document.querySelectorAll(ROW_SELECTOR)) {
      expect(row).toHaveAttribute('tabindex', '-1');
    }
    // All visible rows render (auto-expanded top level: src/*, README, pkg/dist)
    expect(document.querySelectorAll(ROW_SELECTOR)).toHaveLength(6);
  });

  it('has no aria-activedescendant before any row is active', async () => {
    await renderTree();
    expect(getTree()).not.toHaveAttribute('aria-activedescendant');
  });

  it('moves focus with ArrowDown and tracks the active row via aria-activedescendant', async () => {
    await renderTree();
    const tree = getTree();

    keyDownOnTree(tree, 'ArrowDown');
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-selected', 'true');
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      rowByPath('/repo/src').id,
    );

    keyDownOnTree(tree, 'ArrowDown');
    expect(rowByPath('/repo/src/index.ts')).toHaveAttribute('aria-selected', 'true');
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-selected', 'false');
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      rowByPath('/repo/src/index.ts').id,
    );
  });

  it('moves focus with ArrowUp', async () => {
    await renderTree();
    const tree = getTree();

    keyDownOnTree(tree, 'ArrowDown');
    keyDownOnTree(tree, 'ArrowDown');
    keyDownOnTree(tree, 'ArrowUp');
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      rowByPath('/repo/src').id,
    );
  });

  it('clamps ArrowDown at the last row and ArrowUp at the first row', async () => {
    await renderTree();
    const tree = getTree();

    // Last visible row is pkg/dist (pkg is auto-expanded on load)
    keyDownOnTree(tree, 'End');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg/dist').id);
    keyDownOnTree(tree, 'ArrowDown');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg/dist').id);

    keyDownOnTree(tree, 'Home');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/src').id);
    keyDownOnTree(tree, 'ArrowUp');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/src').id);
  });

  it('supports Home and End jumps', async () => {
    await renderTree();
    const tree = getTree();

    keyDownOnTree(tree, 'ArrowDown');
    keyDownOnTree(tree, 'End');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg/dist').id);

    keyDownOnTree(tree, 'Home');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/src').id);
  });

  it('ArrowLeft collapses an expanded directory and ArrowRight re-expands it', async () => {
    await renderTree();
    const tree = getTree();

    // Move to pkg: End focuses dist (a file), ArrowLeft moves focus to pkg
    keyDownOnTree(tree, 'End');
    expect(rowByPath('/repo/pkg')).toHaveAttribute('aria-expanded', 'true');
    expect(rowByPath('/repo/pkg/dist')).toBeInTheDocument();

    keyDownOnTree(tree, 'ArrowLeft'); // dist -> focus pkg
    keyDownOnTree(tree, 'ArrowLeft'); // pkg (expanded) -> collapse
    expect(rowByPath('/repo/pkg')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-tree-row-path="/repo/pkg/dist"]')).toBeNull();

    keyDownOnTree(tree, 'ArrowRight'); // pkg (collapsed) -> expand
    expect(rowByPath('/repo/pkg')).toHaveAttribute('aria-expanded', 'true');
    expect(rowByPath('/repo/pkg/dist')).toBeInTheDocument();

    keyDownOnTree(tree, 'ArrowRight'); // pkg (expanded) -> first child
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg/dist').id);
  });

  it('ArrowRight on an expanded directory steps into the first child', async () => {
    await renderTree();
    const tree = getTree();

    // Focus pkg (expanded on load): End -> dist, ArrowUp -> pkg
    keyDownOnTree(tree, 'End');
    keyDownOnTree(tree, 'ArrowUp');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg').id);

    keyDownOnTree(tree, 'ArrowRight');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg/dist').id);

    // ArrowLeft on the child moves focus back to the parent
    keyDownOnTree(tree, 'ArrowLeft');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/pkg').id);
  });

  it('ArrowLeft on a child row focuses the parent without collapsing it', async () => {
    await renderTree();
    const tree = getTree();

    keyDownOnTree(tree, 'ArrowDown'); // src
    keyDownOnTree(tree, 'ArrowDown'); // src/index.ts
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-expanded', 'true');

    keyDownOnTree(tree, 'ArrowLeft');
    expect(tree).toHaveAttribute('aria-activedescendant', rowByPath('/repo/src').id);
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-expanded', 'true');
  });

  it('Enter opens the focused file via onFileSelect', async () => {
    const onFileSelect = vi.fn();
    await renderTree(onFileSelect);
    const tree = getTree();

    keyDownOnTree(tree, 'ArrowDown'); // src
    keyDownOnTree(tree, 'ArrowDown'); // src/index.ts
    keyDownOnTree(tree, 'Enter');
    expect(onFileSelect).toHaveBeenCalledWith('/repo/src/index.ts');
  });

  it('Space toggles a directory expansion', async () => {
    await renderTree();
    const tree = getTree();

    // Focus src (expanded on load)
    keyDownOnTree(tree, 'ArrowDown');
    keyDownOnTree(tree, ' ');
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('[data-tree-row-path="/repo/src/index.ts"]')).toBeNull();
  });

  it('ignores keys the tree does not own', async () => {
    await renderTree();
    const tree = getTree();

    keyDownOnTree(tree, 'F2');
    keyDownOnTree(tree, 'a');
    expect(tree).not.toHaveAttribute('aria-activedescendant');
    expect(rowByPath('/repo/src')).toHaveAttribute('aria-selected', 'false');
  });

  it('homes keyboard focus back to the container when a row is clicked', async () => {
    await renderTree();
    const tree = getTree();

    fireEvent.click(rowByPath('/repo/src/index.ts'));
    expect(tree).toHaveFocus();
    expect(tree).toHaveAttribute(
      'aria-activedescendant',
      rowByPath('/repo/src/index.ts').id,
    );
  });

  it('row ids are unique and path-encoded (aria-activedescendant targets a real element)', async () => {
    await renderTree();
    const rows = [...document.querySelectorAll(ROW_SELECTOR)];
    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(rowByPath('/repo/src/index.ts').id).toContain(
      encodeURIComponent('/repo/src/index.ts'),
    );
    // aria-activedescendant matches the actual row id, not a stale reference
    keyDownOnTree(getTree(), 'End');
    expect(getTree()).toHaveAttribute(
      'aria-activedescendant',
      rowByPath('/repo/pkg/dist').id,
    );
  });
});
