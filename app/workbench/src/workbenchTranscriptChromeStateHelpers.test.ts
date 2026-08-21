import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  addIdIfMissing,
  createEnterSelectionSnapshot,
  createExitSelectionSnapshot,
  createResetSelectionSnapshot,
  mergeUniqueIds,
  nextActionedBlockIdsOnPulseEnd,
  nextActionedBlockIdsOnPulseStart,
  nextSelectedBlockIdsOnRange,
  nextSelectedBlockIdsOnToggle,
  planBeginHoldSelection,
  planBlockPointerUp,
  planBlockSelect,
  planSelectionHotkeyEffect,
  planUpdateHoldSelection,
  removeIdFromList,
  resolveSelectionRangeIds,
  shouldCancelSelectionHold,
  toggleIdInList,
  transcriptBlockIds,
} from './workbenchTranscriptChromeStateHelpers';

function textBlock(overrides: Partial<Extract<TranscriptBlock, { kind: 'text' }>> = {}): TranscriptBlock {
  return {
    id: 'b1',
    kind: 'text',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    text: 'hello',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function pointer(
  overrides: Partial<{
    button: number;
    target: EventTarget | null;
    currentTarget: HTMLElement;
    shiftKey: boolean;
    clientX: number;
    clientY: number;
  }> = {},
) {
  const card = document.createElement('div');
  return {
    button: 0,
    target: card,
    currentTarget: card,
    shiftKey: false,
    clientX: 1,
    clientY: 2,
    ...overrides,
  };
}

describe('workbenchTranscriptChromeStateHelpers', () => {
  it('toggles and merges selection id lists', () => {
    expect(toggleIdInList(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleIdInList(['a', 'b'], 'a')).toEqual(['b']);
    expect(addIdIfMissing(['a'], 'a')).toEqual(['a']);
    expect(mergeUniqueIds(['a', 'b'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(removeIdFromList(['a', 'b'], 'a')).toEqual(['b']);
    expect(nextActionedBlockIdsOnPulseStart(['a'], 'b')).toEqual(['a', 'b']);
    expect(nextActionedBlockIdsOnPulseEnd(['a', 'b'], 'a')).toEqual(['b']);
    expect(nextSelectedBlockIdsOnToggle(['a'], 'b')).toEqual(['a', 'b']);
    expect(nextSelectedBlockIdsOnRange(['a'], ['b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  it('resolves ranges and residual selection snapshots', () => {
    const transcript = [textBlock({ id: 'a' }), textBlock({ id: 'b' }), textBlock({ id: 'c' })];
    expect(resolveSelectionRangeIds(transcript, ['a'], 'c')).toEqual(['a', 'b', 'c']);
    expect(transcriptBlockIds(transcript)).toEqual(['a', 'b', 'c']);
    expect(createExitSelectionSnapshot()).toEqual({ selectionMode: false, selectedBlockIds: [] });
    expect(createEnterSelectionSnapshot('x')).toEqual({ selectionMode: true, selectedBlockIds: ['x'] });
    expect(createResetSelectionSnapshot()).toEqual({
      contextMenu: null,
      selectionMode: false,
      selectedBlockIds: [],
      actionedBlockIds: [],
      softHiddenBlockIds: [],
    });
  });

  it('plans hold/pointer/select/hotkey residual flows', () => {
    expect(shouldCancelSelectionHold({ x: 10, y: 10 }, 50, 10)).toBe(true);
    expect(planBeginHoldSelection('b1', pointer()).type).toBe('begin');
    expect(planUpdateHoldSelection({ x: 1, y: 1 }, 1, 1)).toEqual({ type: 'noop' });
    expect(planUpdateHoldSelection({ x: 1, y: 1 }, 100, 1)).toEqual({ type: 'cancel' });
    expect(planBlockPointerUp('b1', {
      suppressPointerUp: true,
      selectionMode: true,
      event: pointer(),
    })).toEqual({ type: 'consumeSuppress' });
    expect(planBlockSelect('b2', false, [textBlock({ id: 'b1' }), textBlock({ id: 'b2' })], ['b1']))
      .toEqual({ type: 'toggle', blockId: 'b2' });
    expect(planSelectionHotkeyEffect({ key: 'Escape', ctrlKey: false, metaKey: false }, [textBlock()]))
      .toEqual({ type: 'clearSelection', preventDefault: false });
  });
});
