import { describe, expect, it, vi } from 'vitest';
import type { TranscriptBlock } from '../transcript';
import {
  applyTranscriptChromeSideEffects,
  buildTranscriptContextMenuGroups,
  buildTranscriptMultiSelectActions,
  planContextAction,
  planMultiAction,
  planTranscriptBlockAction,
} from './workbenchTranscriptChromeActionMappers';

const t = (key: string, options?: Record<string, unknown>) => (
  options?.count !== undefined ? `${key}:${options.count}` : key
);

function textBlock(overrides: Partial<Extract<TranscriptBlock, { kind: 'text' }>> = {}): TranscriptBlock {
  return {
    id: 'b1',
    kind: 'text',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    text: 'hello world from agent',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function permissionBlock(
  overrides: Partial<Extract<TranscriptBlock, { kind: 'permission_request' }>> = {},
): Extract<TranscriptBlock, { kind: 'permission_request' }> {
  return {
    id: 'perm-1',
    kind: 'permission_request',
    requestId: 'req-1',
    title: 'Allow bash?',
    status: 'pending',
    author: { id: 'agent-1', role: 'agent', name: 'Agent' },
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('workbenchTranscriptChromeActionMappers', () => {
  it('plans context and multi actions with stable toast labels', () => {
    const transcript = [textBlock({ id: 'b1', text: 'Alpha title here' })];
    const copy = planContextAction({ action: 'copy', blockId: 'b1', transcript, t });
    expect(copy.some((effect) => effect.type === 'copy')).toBe(true);
    expect(copy.some((effect) => effect.type === 'toast')).toBe(true);

    const multiEmpty = planMultiAction({ action: 'copy', selectedBlockIds: [], transcript, t });
    expect(multiEmpty).toEqual([{ type: 'toast', message: 'toast.noCardSelected' }]);

    const multiDelete = planMultiAction({
      action: 'delete',
      selectedBlockIds: ['b1'],
      transcript,
      t,
    });
    expect(multiDelete.some((effect) => effect.type === 'softHide')).toBe(true);
    expect(multiDelete.some((effect) => effect.type === 'exitSelection')).toBe(true);
  });

  it('plans permission and regenerate block actions', () => {
    const transcript = [permissionBlock(), textBlock({ id: 'agent' })];
    const approve = planTranscriptBlockAction({
      action: 'approve',
      blockId: 'perm-1',
      transcript,
      t,
    });
    expect(approve.some((effect) => effect.type === 'approval')).toBe(true);

    const regenerate = planTranscriptBlockAction({
      action: 'regenerate',
      blockId: 'agent',
      transcript,
      t,
    });
    expect(regenerate.some((effect) => effect.type === 'regenerate')).toBe(true);
  });

  it('builds menu/multi view models and applies side effects', () => {
    const onAction = vi.fn();
    const onEnterSelection = vi.fn();
    const groups = buildTranscriptContextMenuGroups({
      blockId: 'b1',
      transcript: [textBlock()],
      t,
      onAction,
      onEnterSelection,
    });
    expect(groups.flat().map((item) => item.label)).toContain('context.quote');
    groups[0]?.[0]?.onClick?.();
    expect(onAction).toHaveBeenCalledWith('copy', 'b1');

    const multi = buildTranscriptMultiSelectActions({
      t,
      onSelectAll: vi.fn(),
      onClear: vi.fn(),
      onMultiAction: vi.fn(),
      onExit: vi.fn(),
    });
    expect(multi.map((item) => item.label)).toContain('bar.exit');

    const handlers = {
      copyText: vi.fn(),
      softHideBlocks: vi.fn(),
      dispatchComposer: vi.fn(),
      focusComposer: vi.fn(),
      pulseBlock: vi.fn(),
      showWorkbenchToast: vi.fn(),
      exitSelection: vi.fn(),
    };
    applyTranscriptChromeSideEffects([
      { type: 'copy', text: 'x' },
      { type: 'toast', message: 'y' },
      { type: 'exitSelection' },
    ], handlers);
    expect(handlers.copyText).toHaveBeenCalledWith('x');
    expect(handlers.showWorkbenchToast).toHaveBeenCalledWith('y');
    expect(handlers.exitSelection).toHaveBeenCalledOnce();
  });
});
