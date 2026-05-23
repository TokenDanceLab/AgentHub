import { describe, it, expect } from 'vitest';
import { buildTree, flattenActivePath, getDirectPath, getIncludeBranches } from '@/lib/message-tree';
import type { FlatItem } from '@/lib/message-tree';

const m = (id: string, parentId: string | null, text = id): FlatItem => ({
  itemId: id, parentId, role: 'user' as const, text, timestamp: new Date().toISOString(),
});

describe('buildTree', () => {
  it('returns empty for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('builds flat root-level list', () => {
    const items = [m('1', null), m('2', null), m('3', null)];
    const tree = buildTree(items);
    expect(tree).toHaveLength(3);
    tree.forEach((n) => expect(n.children).toHaveLength(0));
  });

  it('builds parent-child relationships', () => {
    const items = [m('1', null), m('2', '1'), m('3', '1')];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('assigns siblingIndex correctly', () => {
    const items = [m('1', null), m('2', '1'), m('3', '1'), m('4', '1')];
    const tree = buildTree(items);
    const children = tree[0].children;
    expect(children.map((c) => c.siblingIndex)).toEqual([0, 1, 2]);
  });

  it('handles orphans (parent not yet seen) as roots', () => {
    const items = [m('2', '99'), m('1', null)];
    const tree = buildTree(items);
    expect(tree).toHaveLength(2);
  });

  it('builds deep nesting', () => {
    const items = [m('1', null), m('2', '1'), m('3', '2'), m('4', '3')];
    const tree = buildTree(items);
    let node = tree[0];
    expect(node.depth).toBe(0);
    node = node.children[0];
    expect(node.depth).toBe(1);
    node = node.children[0];
    expect(node.depth).toBe(2);
    node = node.children[0];
    expect(node.depth).toBe(3);
  });
});

describe('flattenActivePath', () => {
  it('returns single node for leaf', () => {
    const items = [m('1', null)];
    const tree = buildTree(items);
    const path = flattenActivePath(tree[0]);
    expect(path).toHaveLength(1);
    expect(path[0].itemId).toBe('1');
  });

  it('follows last child by default', () => {
    const items = [m('1', null), m('2', '1'), m('3', '1')];
    const tree = buildTree(items);
    const path = flattenActivePath(tree[0]);
    expect(path.map((n) => n.itemId)).toEqual(['1', '3']); // last child (newest)
  });

  it('respects siblingIdx', () => {
    const items = [m('1', null), m('2', '1'), m('3', '1'), m('4', '1')];
    const tree = buildTree(items);
    const path = flattenActivePath(tree[0], 0);
    expect(path.map((n) => n.itemId)).toEqual(['1', '4']); // siblingIdx=0 = last (newest)
  });
});

describe('getDirectPath', () => {
  it('returns ancestor chain root→target', () => {
    const items = [m('1', null), m('2', '1'), m('3', '2'), m('4', '3')];
    const path = getDirectPath(items, '3');
    expect(path.map((n) => n.itemId)).toEqual(['1', '2', '3']);
  });

  it('detects and breaks cycles', () => {
    const items = [m('1', '2'), m('2', '1')];
    const path = getDirectPath(items, '1');
    // Cycle 1→2→1: stops at entry point, path contains visited nodes before reversal
    expect(path.length).toBeGreaterThanOrEqual(1);
  });
});

describe('getIncludeBranches', () => {
  it('returns path + siblings', () => {
    const items = [m('1', null), m('2', '1'), m('3', '1'), m('4', '2'), m('5', '3')];
    const result = getIncludeBranches(items, '4');
    const ids = result.map((n) => n.itemId).sort();
    // Should include: 1 (root), 2+3 (children of 1), 4 (target, child of 2)
    expect(ids).toContain('1');
    expect(ids).toContain('2');
    expect(ids).toContain('3');
    expect(ids).toContain('4');
  });
});
