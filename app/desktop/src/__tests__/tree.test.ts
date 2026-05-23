import { describe, it, expect } from 'vitest';
import { buildTree, flattenTree } from '@shared/tree';

// Helper: creates a minimal item with id and optional parentId
const mk = (id: string, parentId?: string) => ({ id, parentId });

describe('buildTree', () => {
  it('returns empty array for empty input', () => {
    expect(buildTree([])).toEqual([]);
  });

  it('returns all items as roots when no parentIds exist', () => {
    const items = [mk('1'), mk('2'), mk('3')];
    const tree = buildTree(items);
    expect(tree).toHaveLength(3);
    tree.forEach((n) => {
      expect(n.children).toHaveLength(0);
      expect(n.depth).toBe(0);
    });
  });

  it('builds simple parent-child relationship', () => {
    const items = [mk('1'), mk('2', '1'), mk('3', '1')];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].item.id).toBe('1');
    expect(tree[0].children).toHaveLength(2);
    expect(tree[0].children[0].item.id).toBe('2');
    expect(tree[0].children[0].depth).toBe(1);
    expect(tree[0].children[1].item.id).toBe('3');
    expect(tree[0].children[1].depth).toBe(1);
  });

  it('builds multi-level nesting', () => {
    const items = [mk('1'), mk('2', '1'), mk('3', '2'), mk('4', '3')];
    const tree = buildTree(items);
    let node = tree[0];
    expect(node.depth).toBe(0);
    expect(node.item.id).toBe('1');
    node = node.children[0];
    expect(node.depth).toBe(1);
    expect(node.item.id).toBe('2');
    node = node.children[0];
    expect(node.depth).toBe(2);
    expect(node.item.id).toBe('3');
    node = node.children[0];
    expect(node.depth).toBe(3);
    expect(node.item.id).toBe('4');
  });

  it('handles orphan items (parent not found) as roots', () => {
    const items = [mk('2', '99'), mk('1')];
    const tree = buildTree(items);
    expect(tree).toHaveLength(2);
    expect(tree.map((n) => n.item.id).sort()).toEqual(['1', '2']);
  });

  it('handles forward references (child before parent) as roots', () => {
    const items = [mk('2', '1'), mk('1')];
    const tree = buildTree(items);
    // '2' references '1' before '1' is seen -> '2' becomes root
    // '1' has no parentId -> root
    expect(tree).toHaveLength(2);
  });

  it('handles circular-like references gracefully in single pass', () => {
    // A references B (not yet seen) -> A is root
    // B references A (already seen) -> B is child of A
    const items = [mk('a', 'b'), mk('b', 'a')];
    const tree = buildTree(items);
    expect(tree).toHaveLength(1);
    expect(tree[0].item.id).toBe('a');
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].item.id).toBe('b');
    expect(tree[0].children[0].depth).toBe(1);
  });

  it('preserves original order for roots', () => {
    const items = [mk('3'), mk('1'), mk('2')];
    const tree = buildTree(items);
    expect(tree.map((n) => n.item.id)).toEqual(['3', '1', '2']);
  });
});

describe('flattenTree', () => {
  it('returns empty array for empty roots', () => {
    expect(flattenTree([])).toEqual([]);
  });

  it('returns flat list for single root', () => {
    const items = [mk('1')];
    const tree = buildTree(items);
    const flat = flattenTree(tree);
    expect(flat).toHaveLength(1);
    expect(flat[0].item.id).toBe('1');
    expect(flat[0].depth).toBe(0);
  });

  it('returns BFS depth-ordered list for multi-level tree', () => {
    const items = [mk('1'), mk('2', '1'), mk('3', '1'), mk('4', '2')];
    const tree = buildTree(items);
    const flat = flattenTree(tree);
    expect(flat.map((f) => f.item.id)).toEqual(['1', '2', '3', '4']);
    expect(flat.map((f) => f.depth)).toEqual([0, 1, 1, 2]);
  });

  it('returns correct depths for multi-root tree', () => {
    const items = [mk('1'), mk('2'), mk('3', '1')];
    const tree = buildTree(items);
    const flat = flattenTree(tree);
    // BFS: roots first (1, 2), then children of root 1 (3)
    expect(flat.map((f) => f.item.id)).toEqual(['1', '2', '3']);
    expect(flat.map((f) => f.depth)).toEqual([0, 0, 1]);
  });
});
