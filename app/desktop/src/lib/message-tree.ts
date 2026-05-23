// Message tree — runtime O(n) build from flat items
// 参考: LibreChat messages.ts buildTree() + CCViewer conversationRows

export interface FlatItem {
  itemId: string;
  parentId: string | null;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  turnUndone?: boolean;
  authority?: 'hub' | 'edge' | 'hybrid';
  agentName?: string;
}

export interface TreeNode {
  itemId: string;
  parentId: string | null;
  role: 'user' | 'agent' | 'system';
  text: string;
  timestamp: string;
  children: TreeNode[];
  depth: number;
  siblingIndex: number;
  turnUndone: boolean;
  authority?: 'hub' | 'edge' | 'hybrid';
  agentName?: string;
}

// ── buildTree: O(n) single-pass ──
// 参考: LibreChat messages.ts:5-50
export function buildTree(items: FlatItem[]): TreeNode[] {
  if (!items || items.length === 0) return [];

  const nodeMap = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const childCount = new Map<string, number>();

  for (const item of items) {
    const parentKey = item.parentId ?? '__root__';
    const count = (childCount.get(parentKey) ?? 0) + 1;
    childCount.set(parentKey, count);

    const node: TreeNode = {
      ...item,
      children: [],
      depth: 0,
      siblingIndex: count - 1,
      turnUndone: item.turnUndone ?? false,
    };

    nodeMap.set(item.itemId, node);

    if (!item.parentId) {
      roots.push(node);
      continue;
    }

    const parent = nodeMap.get(item.parentId);
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      // orphan: parent not yet seen, become root
      roots.push(node);
    }
  }

  return roots;
}

// ── flattenActivePath: linear array for chat rendering ──
// Only renders the ACTIVE branch (newest child at each level)
export function flattenActivePath(root: TreeNode, siblingIdx = 0): TreeNode[] {
  const result: TreeNode[] = [root];
  let current = root;

  while (current.children.length > 0) {
    const idx = Math.max(0, Math.min(siblingIdx, current.children.length - 1));
    // siblingIdx=0 → last child (newest), matches LibreChat reverse-index
    const childIdx = current.children.length - 1 - idx;
    current = current.children[Math.max(0, Math.min(childIdx, current.children.length - 1))];
    result.push(current);
  }

  return result;
}

// ── Fork: DIRECT_PATH ──
// Returns ancestor chain from root to target (inclusive)
export function getDirectPath(items: FlatItem[], targetId: string): FlatItem[] {
  const msgMap = new Map(items.map((m) => [m.itemId, m]));
  const path: FlatItem[] = [];
  const visited = new Set<string>();
  let currentId: string | null = targetId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    const msg = msgMap.get(currentId);
    if (!msg) break;
    path.push(msg);
    currentId = msg.parentId;
  }

  return path.reverse();
}

// ── Fork: INCLUDE_BRANCHES ──
// Returns ancestor chain + all siblings at each level (excluding target's descendants)
export function getIncludeBranches(items: FlatItem[], targetId: string): FlatItem[] {
  const msgMap = new Map(items.map((m) => [m.itemId, m]));
  const pathToRoot = new Set<string>();
  let currentId: string | null = targetId;

  while (currentId) {
    pathToRoot.add(currentId);
    const msg = msgMap.get(currentId);
    currentId = msg?.parentId ?? null;
  }

  // Include nodes that are: in the path, OR have a parent in the path
  return items.filter(
    (m) => pathToRoot.has(m.itemId) || (m.parentId != null && pathToRoot.has(m.parentId)),
  );
}

export type ForkMode = 'DIRECT_PATH' | 'INCLUDE_BRANCHES';
