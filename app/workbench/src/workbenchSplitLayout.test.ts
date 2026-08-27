// real_tested=true
import { describe, expect, it } from 'vitest';
import type { GroupLeaf } from './workbenchSplitLayout';
import {
  adjustSplitRatio,
  computeRects,
  countLeaves,
  createLeaf,
  findLeafByConversation,
  isLayoutNode,
  listLeaves,
  MIN_SPLIT_RATIO,
  moveConversationToPane,
  normalizeLayout,
  placeIncomingConversation,
  removePane,
  serializeSplitLayout,
  splitPane,
  SPLIT_LAYOUT_VERSION,
  tryParseSplitLayout,
  validateSplitLayout,
  type SplitLayoutNode,
  type SplitNode,
} from './workbenchSplitLayout';

/* ═══════════════════════════════════════════════════════════════════════
   workbenchSplitLayout — pure layout tree contract (#1997, UX F3).
   Behavior-first: rect tiling, collapse normalization, split/unsplit/move
   invariants, MIN_SPLIT_RATIO clamps, and hostile-persistence rejection.
   ═══════════════════════════════════════════════════════════════════════ */

function horizontal(children: SplitLayoutNode[], ratios: number[]): SplitNode {
  return { kind: 'split', orientation: 'horizontal', children, ratios };
}

function vertical(children: SplitLayoutNode[], ratios: number[]): SplitNode {
  return { kind: 'split', orientation: 'vertical', children, ratios };
}

function approxRect(rect: { x: number; y: number; w: number; h: number }) {
  return {
    x: expect.closeTo(rect.x, 8),
    y: expect.closeTo(rect.y, 8),
    w: expect.closeTo(rect.w, 8),
    h: expect.closeTo(rect.h, 8),
  };
}

describe('computeRects', () => {
  it('gives a single leaf the whole container', () => {
    const rects = computeRects(createLeaf('p1', 'conv-a'));
    expect(rects.get('p1')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('tiles a horizontal pair into left and right halves', () => {
    const rects = computeRects(horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]));
    expect(rects.get('p1')).toEqual(approxRect({ x: 0, y: 0, w: 0.5, h: 1 }));
    expect(rects.get('p2')).toEqual(approxRect({ x: 0.5, y: 0, w: 0.5, h: 1 }));
  });

  it('tiles a vertical pair into top and bottom halves', () => {
    const rects = computeRects(vertical([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]));
    expect(rects.get('p1')).toEqual(approxRect({ x: 0, y: 0, w: 1, h: 0.5 }));
    expect(rects.get('p2')).toEqual(approxRect({ x: 0, y: 0.5, w: 1, h: 0.5 }));
  });

  it('honors uneven ratios and nests splits without gaps or overlaps', () => {
    const tree = horizontal([
      createLeaf('p1', 'a'),
      vertical([createLeaf('p2', 'b'), createLeaf('p3', 'c')], [0.25, 0.75]),
    ], [0.4, 0.6]);
    const rects = computeRects(tree);
    expect(rects.get('p1')).toEqual(approxRect({ x: 0, y: 0, w: 0.4, h: 1 }));
    expect(rects.get('p2')).toEqual(approxRect({ x: 0.4, y: 0, w: 0.6, h: 0.25 }));
    expect(rects.get('p3')).toEqual(approxRect({ x: 0.4, y: 0.25, w: 0.6, h: 0.75 }));
    // Full coverage: the rects partition the unit square.
    const totalArea = [...rects.values()].reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(totalArea).toBeCloseTo(1, 8);
  });

  it('renormalizes drifted ratios so tiling still covers the container', () => {
    const rects = computeRects(horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [3, 1]));
    expect(rects.get('p1')?.w).toBeCloseTo(0.75, 8);
    expect(rects.get('p2')?.w).toBeCloseTo(0.25, 8);
  });
});

describe('normalizeLayout (collapse normalization)', () => {
  it('flattens same-orientation nesting with proportional ratios', () => {
    const nested = horizontal([
      horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]),
      createLeaf('p3', 'c'),
    ], [0.5, 0.5]);
    const flat = normalizeLayout(nested);
    expect(flat?.kind).toBe('split');
    if (flat?.kind !== 'split') return;
    expect(flat.children.map((child) => child.kind === 'leaf' && child.paneId)).toEqual(['p1', 'p2', 'p3']);
    expect(flat.ratios[0]).toBeCloseTo(0.25, 8);
    expect(flat.ratios[1]).toBeCloseTo(0.25, 8);
    expect(flat.ratios[2]).toBeCloseTo(0.5, 8);
  });

  it('keeps cross-orientation nesting intact', () => {
    const nested = horizontal([
      vertical([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]),
      createLeaf('p3', 'c'),
    ], [0.5, 0.5]);
    const normalized = normalizeLayout(nested);
    expect(normalized?.kind).toBe('split');
    if (normalized?.kind !== 'split') return;
    expect(normalized.children[0]?.kind).toBe('split');
  });

  it('collapses a single surviving child into itself', () => {
    const lone = normalizeLayout(horizontal([createLeaf('p1', 'a')], [1]));
    expect(lone).toEqual(createLeaf('p1', 'a'));
  });

  it('returns null for empty input and empty splits', () => {
    expect(normalizeLayout(null)).toBeNull();
    expect(normalizeLayout({ kind: 'split', orientation: 'horizontal', children: [], ratios: [] })).toBeNull();
  });
});

describe('splitPane', () => {
  it('replaces the target pane with a same-orientation equal pair (target first)', () => {
    const tree = splitPane(createLeaf('p1', 'conv-a'), 'p1', 'horizontal', 'p2');
    expect(tree?.kind).toBe('split');
    if (tree?.kind !== 'split') return;
    expect(tree.orientation).toBe('horizontal');
    expect(tree.children.map((child) => child.kind === 'leaf' && child.paneId)).toEqual(['p1', 'p2']);
    expect(tree.ratios).toEqual([0.5, 0.5]);
    // The original conversation stays in the original pane; sibling is empty.
    expect(findLeafByConversation(tree, 'conv-a')?.paneId).toBe('p1');
    expect(tree.children[1]?.kind === 'leaf' && tree.children[1].conversationId).toBeNull();
  });

  it('splits nested panes and flattens same-direction results', () => {
    const base = horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);
    const tree = splitPane(base, 'p2', 'horizontal', 'p3');
    if (tree?.kind !== 'split') throw new Error('expected split');
    expect(tree.children).toHaveLength(3);
    const rects = computeRects(tree);
    expect(rects.get('p2')?.w).toBeCloseTo(0.25, 8);
    expect(rects.get('p3')?.w).toBeCloseTo(0.25, 8);
  });

  it('returns null for an unknown pane', () => {
    expect(splitPane(createLeaf('p1', 'a'), 'missing', 'vertical')).toBeNull();
  });
});

describe('removePane (Unsplit primitives)', () => {
  it('removes one pane and renormalizes the survivor to the full container', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);
    const remaining = removePane(tree, 'p2');
    expect(remaining).toEqual(createLeaf('p1', 'a'));
    expect(computeRects(remaining as SplitLayoutNode).get('p1')).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('keeps the remaining siblings proportional after a middle removal', () => {
    const tree = horizontal(
      [createLeaf('p1', 'a'), createLeaf('p2', 'b'), createLeaf('p3', 'c')],
      [0.25, 0.5, 0.25],
    );
    const remaining = removePane(tree, 'p2');
    if (remaining?.kind !== 'split') throw new Error('expected split');
    expect(remaining.children).toHaveLength(2);
    // Survivors keep their relative share: 0.25 : 0.25 → 0.5 : 0.5.
    expect(remaining.ratios[0]).toBeCloseTo(0.5, 8);
    expect(remaining.ratios[1]).toBeCloseTo(0.5, 8);
  });

  it('renormalizes asymmetric survivors proportionally', () => {
    const tree = horizontal(
      [createLeaf('p1', 'a'), createLeaf('p2', 'b'), createLeaf('p3', 'c')],
      [0.25, 0.25, 0.5],
    );
    const remaining = removePane(tree, 'p2');
    if (remaining?.kind !== 'split') throw new Error('expected split');
    expect(remaining.ratios[0]).toBeCloseTo(1 / 3, 8);
    expect(remaining.ratios[1]).toBeCloseTo(2 / 3, 8);
  });

  it('returns null when the last pane is removed', () => {
    expect(removePane(createLeaf('p1', 'a'), 'p1')).toBeNull();
  });
});

describe('moveConversationToPane (Move to Group)', () => {
  it('swaps conversations between two occupied panes without duplication', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);
    const moved = moveConversationToPane(tree, 'p1', 'p2');
    expect(findLeafByConversation(moved as SplitLayoutNode, 'a')?.paneId).toBe('p2');
    expect(findLeafByConversation(moved as SplitLayoutNode, 'b')?.paneId).toBe('p1');
    expect(countLeaves(moved as SplitLayoutNode)).toBe(2);
  });

  it('fills an empty target and collapses the source pane', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', null)], [0.5, 0.5]);
    const moved = moveConversationToPane(tree, 'p1', 'p2');
    expect(moved).toEqual(createLeaf('p2', 'a'));
  });

  it('rejects no-op and unknown panes', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);
    expect(moveConversationToPane(tree, 'p1', 'p1')).toBe(tree);
    expect(moveConversationToPane(tree, 'ghost', 'p2')).toBeNull();
    expect(moveConversationToPane(tree, 'p1', 'ghost')).toBeNull();
  });

  it('refuses to move an empty pane', () => {
    const tree = horizontal([createLeaf('p1', null), createLeaf('p2', 'b')], [0.5, 0.5]);
    expect(moveConversationToPane(tree, 'p1', 'p2')).toBeNull();
  });
});

describe('placeIncomingConversation (sidebar / deep-link routing)', () => {
  const split = (): SplitLayoutNode =>
    horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);

  it('leaves the tree unchanged when the conversation is already open', () => {
    const tree = split();
    const { tree: next, changed } = placeIncomingConversation(tree, 'b', 'a');
    expect(next).toBe(tree);
    expect(changed).toBe(false);
  });

  it('prefers an empty pane over evicting any conversation', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', null)], [0.5, 0.5]);
    const { tree: next, changed } = placeIncomingConversation(tree, 'c', 'a');
    expect(changed).toBe(true);
    expect(findLeafByConversation(next, 'c')?.paneId).toBe('p2');
  });

  it('drops into the non-active pane when all panes are occupied', () => {
    const { tree: next } = placeIncomingConversation(split(), 'c', 'a');
    // Previous active was 'a' in p1 → the incoming conversation lands in p2.
    expect(findLeafByConversation(next, 'c')?.paneId).toBe('p2');
    expect(findLeafByConversation(next, 'a')?.paneId).toBe('p1');
  });

  it('falls back to the first pane when it is also the previous active pane', () => {
    const tree = createLeaf('p1', 'a');
    const { tree: next } = placeIncomingConversation(tree, 'b', 'a');
    expect(findLeafByConversation(next, 'b')?.paneId).toBe('p1');
  });
});

describe('adjustSplitRatio (MIN_SPLIT_RATIO clamps)', () => {
  const pair = (): SplitLayoutNode =>
    horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]);

  it('shifts ratio toward the next sibling', () => {
    const adjusted = adjustSplitRatio(pair(), 'p1', 0.1);
    if (adjusted?.kind !== 'split') throw new Error('expected split');
    expect(adjusted.ratios[0]).toBeCloseTo(0.6, 8);
    expect(adjusted.ratios[1]).toBeCloseTo(0.4, 8);
  });

  it('never shrinks a pane below MIN_SPLIT_RATIO', () => {
    const adjusted = adjustSplitRatio(pair(), 'p1', -0.9);
    if (adjusted?.kind !== 'split') throw new Error('expected split');
    expect(adjusted.ratios[0]).toBeCloseTo(MIN_SPLIT_RATIO, 8);
    expect(adjusted.ratios[1]).toBeCloseTo(1 - MIN_SPLIT_RATIO, 8);
  });

  it('never grows a pane past the neighbor floor', () => {
    const adjusted = adjustSplitRatio(pair(), 'p1', 0.9);
    if (adjusted?.kind !== 'split') throw new Error('expected split');
    expect(adjusted.ratios[0]).toBeCloseTo(1 - MIN_SPLIT_RATIO, 8);
    expect(adjusted.ratios[1]).toBeCloseTo(MIN_SPLIT_RATIO, 8);
  });

  it('returns null for a lone leaf and for trailing panes without a next sibling', () => {
    expect(adjustSplitRatio(createLeaf('p1', 'a'), 'p1', 0.1)).toBeNull();
    expect(adjustSplitRatio(pair(), 'p2', 0.1)).toBeNull();
  });
});

describe('persistence roundtrip', () => {
  it('serializes and re-hydrates a nested tree', () => {
    const tree = horizontal([
      createLeaf('p1', 'a'),
      vertical([createLeaf('p2', 'b'), createLeaf('p3', 'c')], [0.5, 0.5]),
    ], [0.5, 0.5]);
    const restored = tryParseSplitLayout(serializeSplitLayout(tree));
    expect(restored).toEqual(normalizeLayout(tree));
  });

  it('keeps empty panes through the roundtrip', () => {
    const tree = horizontal([createLeaf('p1', 'a'), createLeaf('p2', null)], [0.5, 0.5]);
    expect(tryParseSplitLayout(serializeSplitLayout(tree))).toEqual(tree);
  });
});

describe('defensive hydration (hostile persistence input)', () => {
  const validLeaf = (paneId: string, conversationId: string | null) =>
    ({ kind: 'leaf', paneId, conversationId });

  function blob(root: unknown, version: unknown = SPLIT_LAYOUT_VERSION): string {
    return JSON.stringify({ v: version, root });
  }

  it('rejects null, empty and non-JSON input', () => {
    expect(tryParseSplitLayout(null)).toBeNull();
    expect(tryParseSplitLayout(undefined)).toBeNull();
    expect(tryParseSplitLayout('')).toBeNull();
    expect(tryParseSplitLayout('{not json')).toBeNull();
    expect(tryParseSplitLayout('"just a string"')).toBeNull();
  });

  it('rejects unknown envelope versions', () => {
    expect(tryParseSplitLayout(blob(validLeaf('p1', 'a'), 999))).toBeNull();
    expect(tryParseSplitLayout(blob(validLeaf('p1', 'a'), '1'))).toBeNull();
  });

  it('rejects structurally invalid roots', () => {
    expect(tryParseSplitLayout(blob(42))).toBeNull();
    expect(tryParseSplitLayout(blob([validLeaf('p1', 'a')]))).toBeNull();
    expect(tryParseSplitLayout(blob({ kind: 'leaf' }))).toBeNull();
    expect(tryParseSplitLayout(blob({ kind: 'leaf', paneId: '', conversationId: 'a' }))).toBeNull();
    expect(tryParseSplitLayout(blob({ kind: 'leaf', paneId: 'p1', conversationId: 7 }))).toBeNull();
    expect(tryParseSplitLayout(blob({ kind: 'split', orientation: 'diagonal', children: [], ratios: [] }))).toBeNull();
  });

  it('rejects splits with fewer than two children', () => {
    expect(tryParseSplitLayout(blob({
      kind: 'split', orientation: 'horizontal', children: [validLeaf('p1', 'a')], ratios: [1],
    }))).toBeNull();
    expect(tryParseSplitLayout(blob({
      kind: 'split', orientation: 'horizontal', children: [], ratios: [],
    }))).toBeNull();
  });

  it('rejects ratios that are not finite positive numbers', () => {
    const shape = (ratios: unknown) => blob({
      kind: 'split',
      orientation: 'horizontal',
      children: [validLeaf('p1', 'a'), validLeaf('p2', 'b')],
      ratios,
    });
    expect(tryParseSplitLayout(shape([0.5, 0.5, 0.1]))).toBeNull(); // length mismatch
    expect(tryParseSplitLayout(shape([0, 1]))).toBeNull();
    expect(tryParseSplitLayout(shape([-0.5, 1.5]))).toBeNull();
    expect(tryParseSplitLayout(shape([Number.POSITIVE_INFINITY, 0.5]))).toBeNull();
    expect(tryParseSplitLayout(shape([Number.NaN, 0.5]))).toBeNull();
    expect(tryParseSplitLayout(shape(['0.5', 0.5]))).toBeNull();
    expect(tryParseSplitLayout(shape([null, 1]))).toBeNull();
  });

  it('rejects a conversation open in two panes at once', () => {
    const duplicated = blob({
      kind: 'split',
      orientation: 'horizontal',
      children: [validLeaf('p1', 'same-conversation'), validLeaf('p2', 'same-conversation')],
      ratios: [0.5, 0.5],
    });
    expect(tryParseSplitLayout(duplicated)).toBeNull();
  });

  it('rejects NaN smuggled through raw JSON text', () => {
    const raw = '{"v":1,"root":{"kind":"split","orientation":"horizontal","children":[' +
      '{"kind":"leaf","paneId":"p1","conversationId":"a"},' +
      '{"kind":"leaf","paneId":"p2","conversationId":"b"}],"ratios":[NaN,0.5]}}';
    expect(tryParseSplitLayout(raw)).toBeNull();
  });

  it('rejects overflowed ratios that JSON parses as Infinity', () => {
    const raw = '{"v":1,"root":{"kind":"split","orientation":"horizontal","children":[' +
      '{"kind":"leaf","paneId":"p1","conversationId":"a"},' +
      '{"kind":"leaf","paneId":"p2","conversationId":"b"}],"ratios":[1e999,0.5]}}';
    expect(tryParseSplitLayout(raw)).toBeNull();
  });
});

describe('invariants', () => {
  it('validateSplitLayout flags duplicate conversations and bad shapes', () => {
    expect(validateSplitLayout(createLeaf('p1', 'a'))).toBeNull();
    expect(validateSplitLayout(horizontal(
      [createLeaf('p1', 'a'), createLeaf('p2', 'a')],
      [0.5, 0.5],
    ))).toBe('duplicate-conversation');
    expect(validateSplitLayout({ kind: 'weird' })).toBe('invalid-node-shape');
  });

  it('isLayoutNode accepts only the pure tree shape', () => {
    expect(isLayoutNode(createLeaf('p1', null))).toBe(true);
    expect(isLayoutNode(horizontal([createLeaf('p1', 'a'), createLeaf('p2', 'b')], [0.5, 0.5]))).toBe(true);
    expect(isLayoutNode(undefined)).toBe(false);
    expect(isLayoutNode({ kind: 'leaf', paneId: 'p1', conversationId: 'a', extra: true })).toBe(true);
    expect(isLayoutNode({ kind: 'split', orientation: 'horizontal', children: [createLeaf('p1', 'a')], ratios: [1] })).toBe(false);
  });

  it('never duplicates a conversation across operation sequences', () => {
    let tree: SplitLayoutNode = createLeaf('p1', 'conv-a');
    tree = splitPane(tree, 'p1', 'horizontal', 'p2') as SplitLayoutNode;
    tree = placeIncomingConversation(tree, 'conv-b', 'conv-a').tree;
    tree = splitPane(tree, (findLeafByConversation(tree, 'conv-b') as GroupLeaf).paneId, 'vertical', 'p3') as SplitLayoutNode;
    tree = placeIncomingConversation(tree, 'conv-c', 'conv-b').tree;
    tree = moveConversationToPane(tree, 'p1', 'p3') as SplitLayoutNode;
    tree = removePane(tree, 'p2') as SplitLayoutNode;

    const ids = listLeaves(tree)
      .map((leaf) => leaf.conversationId)
      .filter((id): id is string => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateSplitLayout(tree)).toBeNull();
    // Tiling still covers the whole container after every mutation.
    const area = [...computeRects(tree).values()].reduce((sum, rect) => sum + rect.w * rect.h, 0);
    expect(area).toBeCloseTo(1, 8);
  });
});

type GroupLeaf = import('./workbenchSplitLayout').GroupLeaf;
