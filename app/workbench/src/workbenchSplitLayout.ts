/* ==========================================================================
   workbenchSplitLayout — pure layout tree for the split-view workspace
   (#1997, UX F3).

   codeg-inspired semantics (internalized from the public-source research):
   a pure GroupLeaf / SplitNode tree with per-level ratios, same-orientation
   flattening, collapse normalization (no empty splits, no single-child
   splits, no same-direction nesting), and MIN_SPLIT_RATIO so a pane can
   never be dragged to nothing. Every function here is pure — state mounting
   and persistence live in useWorkbenchPanelLayout.

   Honesty contract: a conversation can never appear in two panes at once;
   persisted blobs are defensively validated and rejected (fall back to a
   single group) instead of crashing hydration.
   ========================================================================== */

/** Split direction. horizontal = children sit left→right (Split Right); vertical = top→bottom (Split Down). */
export type SplitOrientation = 'horizontal' | 'vertical';

/** A single conversation group (one conversation shown per pane). */
export interface GroupLeaf {
  kind: 'leaf';
  paneId: string;
  /** null = empty pane awaiting a conversation pick (sidebar click fills it). */
  conversationId: string | null;
}

export interface SplitNode {
  kind: 'split';
  orientation: SplitOrientation;
  children: SplitLayoutNode[];
  /** Positive finite weights, one per child, normalized to sum 1. */
  ratios: number[];
}

export type SplitLayoutNode = GroupLeaf | SplitNode;

/** Normalized rect in 0..1 container space (x→right, y→down). */
export interface SplitRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** No pane may shrink below this fraction of its level span (防拖没). */
export const MIN_SPLIT_RATIO = 0.15;

/** Blob envelope version for persisted split layouts. */
export const SPLIT_LAYOUT_VERSION = 1;

/** Depth cap for structural checks — hostile blobs cannot stack-overflow. */
const MAX_VALIDATION_DEPTH = 32;

let paneIdCounter = 0;

/** Deterministic-enough unique pane id; explicit ids may be injected in tests. */
export function generatePaneId(): string {
  paneIdCounter += 1;
  return `split-pane-${Date.now().toString(36)}-${paneIdCounter}`;
}

export function createLeaf(paneId: string, conversationId: string | null): GroupLeaf {
  return { kind: 'leaf', paneId, conversationId };
}

/* ── shape guards ────────────────────────────────────────────────────────── */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural guard: accepts only the pure tree shape (extra keys on a leaf
 *  are tolerated; arity/orientation/ratio violations are not). */
export function isLayoutNode(value: unknown, depth = 0): value is SplitLayoutNode {
  if (depth > MAX_VALIDATION_DEPTH || !isRecord(value)) return false;
  if (value.kind === 'leaf') {
    return typeof value.paneId === 'string' && value.paneId.length > 0
      && (value.conversationId === null || typeof value.conversationId === 'string');
  }
  if (value.kind === 'split') {
    if (value.orientation !== 'horizontal' && value.orientation !== 'vertical') return false;
    if (!Array.isArray(value.children) || !Array.isArray(value.ratios)) return false;
    if (value.children.length < 2 || value.children.length !== value.ratios.length) return false;
    if (!value.ratios.every((ratio: unknown) =>
      typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0)) return false;
    return value.children.every((child: unknown) => isLayoutNode(child, depth + 1));
  }
  return false;
}

export type SplitLayoutValidationError = 'invalid-node-shape' | 'duplicate-conversation';

/** null when valid; otherwise the first violated invariant name. */
export function validateSplitLayout(node: unknown): SplitLayoutValidationError | null {
  if (!isLayoutNode(node)) return 'invalid-node-shape';
  const seen = new Set<string>();
  function walk(current: SplitLayoutNode): SplitLayoutValidationError | null {
    if (current.kind === 'leaf') {
      if (current.conversationId !== null) {
        if (seen.has(current.conversationId)) return 'duplicate-conversation';
        seen.add(current.conversationId);
      }
      return null;
    }
    for (const child of current.children) {
      const error = walk(child);
      if (error) return error;
    }
    return null;
  }
  return walk(node);
}

/* ── readers ─────────────────────────────────────────────────────────────── */

export function countLeaves(node: SplitLayoutNode): number {
  if (node.kind === 'leaf') return 1;
  return node.children.reduce((sum, child) => sum + countLeaves(child), 0);
}

/** Leaves in stable document order (depth-first). */
export function listLeaves(node: SplitLayoutNode): GroupLeaf[] {
  if (node.kind === 'leaf') return [node];
  return node.children.flatMap(listLeaves);
}

export function findLeafByConversation(
  node: SplitLayoutNode,
  conversationId: string,
): GroupLeaf | undefined {
  return listLeaves(node).find((leaf) => leaf.conversationId === conversationId);
}

function normalizeRatioList(ratios: number[]): number[] {
  const safe = ratios.map((ratio) =>
    typeof ratio === 'number' && Number.isFinite(ratio) && ratio > 0 ? ratio : 1);
  const total = safe.reduce((sum, ratio) => sum + ratio, 0);
  return total > 0 ? safe.map((ratio) => ratio / total) : safe.map(() => 1 / safe.length);
}

/* ── normalization ───────────────────────────────────────────────────────── */

/** Canonical form: flatten same-orientation nesting (proportional ratios),
 *  collapse single-child splits, drop empty splits. Null in → null out. */
export function normalizeLayout(node: SplitLayoutNode | null): SplitLayoutNode | null {
  if (node === null) return null;
  if (node.kind === 'leaf') return node;
  if (node.children.length === 0) return null;

  const children: SplitLayoutNode[] = [];
  const ratios: number[] = [];
  const normalizedRatios = normalizeRatioList(node.ratios);
  node.children.forEach((child, index) => {
    const share = normalizedRatios[index] ?? 1 / node.children.length;
    const normalized = normalizeLayout(child);
    if (normalized === null) return; // empty split collapses away
    if (normalized.kind === 'split' && normalized.orientation === node.orientation) {
      const innerRatios = normalizeRatioList(normalized.ratios);
      normalized.children.forEach((grandChild, innerIndex) => {
        children.push(grandChild);
        ratios.push(share * (innerRatios[innerIndex] ?? 1 / normalized.children.length));
      });
      return;
    }
    children.push(normalized);
    ratios.push(share);
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0] ?? null;
  return {
    kind: 'split',
    orientation: node.orientation,
    children,
    ratios: normalizeRatioList(ratios),
  };
}

/* ── transforms ──────────────────────────────────────────────────────────── */

/** Replace the target pane with a same-orientation [target, empty] pair.
 *  Nested targets are wrapped; normalize flattens same-direction nesting so
 *  the invariant "no same-orientation nesting" always holds. */
export function splitPane(
  root: SplitLayoutNode,
  paneId: string,
  orientation: SplitOrientation,
  newPaneId?: string,
): SplitLayoutNode | null {
  const target = listLeaves(root).find((leaf) => leaf.paneId === paneId);
  if (!target) return null;
  const emptyLeaf = createLeaf(newPaneId ?? generatePaneId(), null);

  function transform(node: SplitLayoutNode): SplitLayoutNode {
    if (node.kind === 'leaf') {
      if (node.paneId !== paneId) return node;
      return {
        kind: 'split',
        orientation,
        children: [node, emptyLeaf],
        ratios: [0.5, 0.5],
      };
    }
    return {
      kind: 'split',
      orientation: node.orientation,
      children: node.children.map(transform),
      ratios: node.ratios,
    };
  }

  return normalizeLayout(transform(root));
}

/** Remove one pane. Survivors keep their proportional share; single-child
 *  splits collapse. Returns null when the last pane is removed. */
export function removePane(root: SplitLayoutNode, paneId: string): SplitLayoutNode | null {
  if (root.kind === 'leaf') return root.paneId === paneId ? null : root;

  function transform(node: SplitLayoutNode): SplitLayoutNode | null {
    if (node.kind === 'leaf') return node;
    const children: SplitLayoutNode[] = [];
    const ratios: number[] = [];
    const normalizedRatios = normalizeRatioList(node.ratios);
    node.children.forEach((child, index) => {
      if (child.kind === 'leaf' && child.paneId === paneId) return;
      const kept = child.kind === 'split' ? transform(child) : child;
      if (kept === null) return;
      children.push(kept);
      ratios.push(normalizedRatios[index] ?? 1 / node.children.length);
    });
    if (children.length === 0) return null;
    if (children.length === 1) return children[0] ?? null;
    return {
      kind: 'split',
      orientation: node.orientation,
      children,
      ratios: normalizeRatioList(ratios),
    };
  }

  return normalizeLayout(transform(root));
}

/** Move the conversation hosted by `fromPaneId` into `toPaneId`.
 *  - target occupied → swap (bijection preserved);
 *  - target empty → the conversation relocates and the emptied pane
 *    collapses away (a move never leaves a stray empty pane);
 *  - same pane / unknown pane / empty source → no-op reference or null. */
export function moveConversationToPane(
  root: SplitLayoutNode,
  fromPaneId: string,
  toPaneId: string,
): SplitLayoutNode | null {
  if (fromPaneId === toPaneId) {
    return listLeaves(root).some((leaf) => leaf.paneId === fromPaneId) ? root : null;
  }
  const fromLeaf = listLeaves(root).find((leaf) => leaf.paneId === fromPaneId);
  const toLeaf = listLeaves(root).find((leaf) => leaf.paneId === toPaneId);
  if (!fromLeaf || !toLeaf || fromLeaf.conversationId === null) return null;

  const moving = fromLeaf.conversationId;
  const displaced = toLeaf.conversationId;

  function transform(node: SplitLayoutNode): SplitLayoutNode {
    if (node.kind === 'leaf') {
      if (node.paneId === fromPaneId) {
        return displaced === null
          ? createLeaf(node.paneId, null) // emptied — removePane step below collapses it
          : createLeaf(node.paneId, displaced);
      }
      if (node.paneId === toPaneId) return createLeaf(node.paneId, moving);
      return node;
    }
    return {
      kind: 'split',
      orientation: node.orientation,
      children: node.children.map(transform),
      ratios: node.ratios,
    };
  }

  const swapped = transform(root);
  return displaced === null ? removePane(swapped, fromPaneId) : swapped;
}

export interface PlaceIncomingResult {
  tree: SplitLayoutNode;
  changed: boolean;
}

/** Route an incoming conversation (sidebar click / deep link) into the tree:
 *  already open → untouched; else first empty pane; else the pane that is
 *  NOT hosting the previously active conversation (parallel review must not
 *  evict what the user is looking at); else the first pane. */
export function placeIncomingConversation(
  root: SplitLayoutNode,
  conversationId: string,
  previousActiveConversationId?: string,
): PlaceIncomingResult {
  if (findLeafByConversation(root, conversationId)) return { tree: root, changed: false };

  const leaves = listLeaves(root);
  const emptyLeaf = leaves.find((leaf) => leaf.conversationId === null);
  const target = emptyLeaf
    ?? (previousActiveConversationId !== undefined
      ? leaves.find((leaf) => leaf.conversationId !== previousActiveConversationId)
      : undefined)
    ?? leaves[0];
  if (!target) return { tree: root, changed: false };
  const targetLeaf = target;

  function transform(node: SplitLayoutNode): SplitLayoutNode {
    if (node.kind === 'leaf') {
      return node.paneId === targetLeaf.paneId
        ? createLeaf(node.paneId, conversationId)
        : node;
    }
    return {
      kind: 'split',
      orientation: node.orientation,
      children: node.children.map(transform),
      ratios: node.ratios,
    };
  }

  return { tree: transform(root), changed: true };
}

/** Drag-hairline primitive: shift the pane's share against its NEXT sibling
 *  by `delta` (positive grows the pane). Both sides clamp at
 *  MIN_SPLIT_RATIO. Null when nothing can move (lone leaf / trailing pane). */
export function adjustSplitRatio(
  root: SplitLayoutNode,
  paneId: string,
  delta: number,
): SplitLayoutNode | null {
  if (!Number.isFinite(delta) || delta === 0) return null;
  if (root.kind === 'leaf') return null;

  function transform(node: SplitLayoutNode): SplitLayoutNode | null {
    if (node.kind === 'leaf') return null;
    const ratios = normalizeRatioList(node.ratios);
    const index = node.children.findIndex((child) =>
      child.kind === 'leaf' && child.paneId === paneId);
    if (index >= 0) {
      if (index + 1 >= node.children.length) return null; // trailing pane
      const current = ratios[index] ?? MIN_SPLIT_RATIO;
      const next = ratios[index + 1] ?? MIN_SPLIT_RATIO;
      const clamped = Math.min(Math.max(delta, MIN_SPLIT_RATIO - current), next - MIN_SPLIT_RATIO);
      if (Math.abs(clamped) < 1e-9) return null;
      const nextRatios = [...ratios];
      nextRatios[index] = current + clamped;
      nextRatios[index + 1] = next - clamped;
      return {
        kind: 'split',
        orientation: node.orientation,
        children: node.children,
        ratios: nextRatios,
      };
    }
    let changed = false;
    const children = node.children.map((child) => {
      if (changed || child.kind === 'leaf') return child;
      const result = transform(child);
      if (result === null) return child;
      if (result !== child) changed = true;
      return result;
    });
    if (!changed) return node;
    return {
      kind: 'split',
      orientation: node.orientation,
      children,
      ratios: node.ratios,
    };
  }

  const result = transform(root);
  return result === root ? null : result;
}

/* ── geometry ────────────────────────────────────────────────────────────── */

/** Tile the unit container; returns each leaf's rect keyed by paneId.
 *  Drifted ratios are renormalized so coverage always sums to 1. */
export function computeRects(root: SplitLayoutNode): Map<string, SplitRect> {
  const rects = new Map<string, SplitRect>();

  function fill(node: SplitLayoutNode, rect: SplitRect): void {
    if (node.kind === 'leaf') {
      rects.set(node.paneId, rect);
      return;
    }
    const ratios = normalizeRatioList(node.ratios);
    let cursor = 0;
    node.children.forEach((child, index) => {
      const share = ratios[index] ?? 1 / node.children.length;
      const childRect: SplitRect = node.orientation === 'horizontal'
        ? { x: rect.x + cursor * rect.w, y: rect.y, w: share * rect.w, h: rect.h }
        : { x: rect.x, y: rect.y + cursor * rect.h, w: rect.w, h: share * rect.h };
      cursor += share;
      fill(child, childRect);
    });
  }

  fill(root, { x: 0, y: 0, w: 1, h: 1 });
  return rects;
}

/* ── persistence ─────────────────────────────────────────────────────────── */

export function serializeSplitLayout(node: SplitLayoutNode): string {
  return JSON.stringify({ v: SPLIT_LAYOUT_VERSION, root: node });
}

/** Defensive hydration: any corrupt/hostile blob returns null so callers can
 *  fall back to a single group instead of a white screen. */
export function tryParseSplitLayout(raw: string | null | undefined): SplitLayoutNode | null {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // includes literal NaN/Infinity tokens in the raw text
  }
  if (!isRecord(parsed)) return null;
  if (parsed.v !== SPLIT_LAYOUT_VERSION) return null;
  if (validateSplitLayout(parsed.root) !== null) return null;
  return normalizeLayout(parsed.root as SplitLayoutNode);
}
