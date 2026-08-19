// real_tested=true
import { describe, expect, it } from 'vitest';
import { buildTree, flattenTree, type TreeNode } from './tree';

interface Message {
  id: string;
  parentId?: string;
  text: string;
}

function msg(id: string, parentId: string | undefined, text = `message ${id}`): Message {
  return { id, ...(parentId !== undefined && { parentId }), text };
}

describe('buildTree', () => {
  it('returns an empty list for empty / nullish input', () => {
    expect(buildTree([])).toEqual([]);
    expect(buildTree(undefined as unknown as Message[])).toEqual([]);
  });

  it('turns a single rootless item into one root at depth 0', () => {
    const roots = buildTree([msg('a', undefined)]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.item.id).toBe('a');
    expect(roots[0]!.depth).toBe(0);
    expect(roots[0]!.children).toEqual([]);
  });

  it('attaches children to a previously seen parent at depth 1', () => {
    const roots = buildTree([msg('a', undefined), msg('b', 'a')]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.children).toHaveLength(1);
    expect(roots[0]!.children[0]!.item.id).toBe('b');
    expect(roots[0]!.children[0]!.depth).toBe(1);
  });

  it('builds nested grandchildren at depth 2', () => {
    const roots = buildTree([msg('a', undefined), msg('b', 'a'), msg('c', 'b')]);
    const grandchild = roots[0]!.children[0]!.children[0]!;
    expect(grandchild.item.id).toBe('c');
    expect(grandchild.depth).toBe(2);
  });

  it('keeps multiple roots in input order', () => {
    const roots = buildTree([msg('a', undefined), msg('b', undefined), msg('c', 'b')]);
    expect(roots.map((r) => r.item.id)).toEqual(['a', 'b']);
    expect(roots[1]!.children.map((c) => c.item.id)).toEqual(['c']);
  });

  it('preserves sibling order under the same parent', () => {
    const roots = buildTree([
      msg('a', undefined),
      msg('b', 'a'),
      msg('c', 'a'),
      msg('d', 'a'),
    ]);
    expect(roots[0]!.children.map((c) => c.item.id)).toEqual(['b', 'c', 'd']);
  });

  it('promotes an orphan (unseen parent) to root', () => {
    const roots = buildTree([msg('b', 'a')]);
    expect(roots.map((r) => r.item.id)).toEqual(['b']);
    expect(roots[0]!.depth).toBe(0);
  });

  it('does not re-parent a child when its parent appears later', () => {
    // Single-pass contract: children are linked only to parents seen BEFORE them.
    const roots = buildTree([msg('b', 'a'), msg('a', undefined)]);
    expect(roots.map((r) => r.item.id)).toEqual(['b', 'a']);
    expect(roots.find((r) => r.item.id === 'a')!.children).toEqual([]);
    expect(roots[0]!.depth).toBe(0);
  });

  it('treats an empty-string parentId as a root (falsy guard)', () => {
    const roots = buildTree([msg('a', '' as unknown as undefined)]);
    expect(roots.map((r) => r.item.id)).toEqual(['a']);
    expect(roots[0]!.children).toEqual([]);
  });

  it('builds an arbitrary-depth chain with increasing depths', () => {
    const roots = buildTree([
      msg('a', undefined),
      msg('b', 'a'),
      msg('c', 'b'),
      msg('d', 'c'),
    ]);
    const chain: TreeNode<Message>[] = [];
    let node: TreeNode<Message> | undefined = roots[0];
    while (node) {
      chain.push(node);
      node = node.children[0];
    }
    expect(chain.map((n) => n.depth)).toEqual([0, 1, 2, 3]);
    expect(chain.map((n) => n.item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('keeps an orphan as root between attached siblings', () => {
    const roots = buildTree([
      msg('a', undefined),
      msg('b', 'a'),
      msg('orphan', 'missing-parent'),
      msg('d', 'a'),
    ]);
    expect(roots.map((r) => r.item.id)).toEqual(['a', 'orphan']);
    expect(roots[0]!.children.map((c) => c.item.id)).toEqual(['b', 'd']);
    expect(roots[1]!.children).toEqual([]);
  });

  it('attaches grandchildren to the last-seen node with a duplicate id', () => {
    const roots = buildTree([
      msg('a', undefined),
      msg('a', undefined),
      msg('b', 'a'),
    ]);
    // nodeMap keeps the LAST 'a'; the root list still holds the first one.
    expect(roots).toHaveLength(2);
    expect(roots[0]!.children).toEqual([]);
    expect(roots[1]!.children.map((c) => c.item.id)).toEqual(['b']);
    expect(roots[1]!.children[0]!.depth).toBe(1);
  });

  it('does not mutate the input array or items', () => {
    const items = [msg('a', undefined), msg('b', 'a')];
    const snapshot = JSON.parse(JSON.stringify(items)) as Message[];
    buildTree(items);
    expect(items).toEqual(snapshot);
  });

  it('supports arbitrary item payloads, not just messages', () => {
    const nodes = buildTree([
      { id: '1', kind: 'root' },
      { id: '2', parentId: '1', kind: 'leaf' },
    ]);
    expect(nodes[0]!.item).toEqual({ id: '1', kind: 'root' });
    expect(nodes[0]!.children[0]!.item).toEqual({ id: '2', parentId: '1', kind: 'leaf' });
  });
});

describe('flattenTree', () => {
  const build = (): TreeNode<Message>[] =>
    buildTree([
      msg('a', undefined),
      msg('b', 'a'),
      msg('c', 'a'),
      msg('d', 'b'),
      msg('e', undefined),
    ]);

  it('flattens an empty tree to an empty list', () => {
    expect(flattenTree([])).toEqual([]);
  });

  it('walks breadth-first and reports each item with its depth', () => {
    const flat = flattenTree(build());
    expect(flat.map((f) => f.item.id)).toEqual(['a', 'e', 'b', 'c', 'd']);
    expect(flat.map((f) => f.depth)).toEqual([0, 0, 1, 1, 2]);
  });

  it('preserves the original item references', () => {
    const roots = build();
    const flat = flattenTree(roots);
    expect(flat[0]!.item).toBe(roots[0]!.item);
    expect(flat[2]!.item).toBe(roots[0]!.children[0]!.item);
  });

  it('round-trips: flattening a built tree yields one entry per input item', () => {
    const items = [
      msg('a', undefined),
      msg('b', 'a'),
      msg('c', 'a'),
      msg('d', 'b'),
      msg('e', undefined),
    ];
    expect(flattenTree(buildTree(items))).toHaveLength(items.length);
  });

  it('does not mutate the tree during flattening', () => {
    const roots = build();
    const snapshot = JSON.parse(JSON.stringify(roots)) as TreeNode<Message>[];
    flattenTree(roots);
    expect(roots).toEqual(snapshot);
  });
});
