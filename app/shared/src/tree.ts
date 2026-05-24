// Message tree — generic tree builder following LibreChat's buildTree pattern.
// Converts flat messages with optional parentId into a hierarchical tree.
// Reference: LibreChat client/src/utils/messages.ts buildTree()

export interface TreeNode<T> {
  item: T;
  children: TreeNode<T>[];
  depth: number;
}

/**
 * Converts a flat list of items with parent references into a tree.
 * Each item may have an optional parentId field.
 * Items without a parentId become roots.
 * Items referencing non-existent parents become roots (graceful degradation).
 * Runs in O(n) single pass.
 */
export function buildTree<T extends { id: string; parentId?: string }>(
  items: T[],
): TreeNode<T>[] {
  if (!items || items.length === 0) return [];

  const nodeMap = new Map<string, TreeNode<T>>();
  const roots: TreeNode<T>[] = [];

  for (const item of items) {
    const node: TreeNode<T> = {
      item,
      children: [],
      depth: 0,
    };
    nodeMap.set(item.id, node);

    if (!item.parentId) {
      roots.push(node);
      continue;
    }

    const parent = nodeMap.get(item.parentId);
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      // Orphan: parent not yet seen or doesn't exist — become root
      roots.push(node);
    }
  }

  return roots;
}

/**
 * Flattens a tree back to a depth-ordered list using BFS traversal.
 * Returns each item with its depth, preserving sibling order.
 */
export function flattenTree<T>(
  roots: TreeNode<T>[],
): Array<{ item: T; depth: number }> {
  const result: Array<{ item: T; depth: number }> = [];
  const queue: TreeNode<T>[] = [...roots];

  while (queue.length > 0) {
    const node = queue.shift()!;
    result.push({ item: node.item, depth: node.depth });
    queue.push(...node.children);
  }

  return result;
}
