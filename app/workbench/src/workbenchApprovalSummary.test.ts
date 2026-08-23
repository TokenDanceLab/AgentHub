import { describe, expect, it } from 'vitest';
import type { TranscriptBlock } from '@shared/transcript';
import {
  countPendingApprovals,
  firstPendingApprovalBlockId,
  isPendingApprovalBlock,
} from './workbenchApprovalSummary';

const author = { id: 'edge', name: 'Edge', role: 'agent' as const };

function permissionRequest(id: string): TranscriptBlock {
  return {
    id,
    kind: 'permission_request',
    author,
    requestId: `req-${id}`,
    title: `Allow ${id}`,
    status: 'pending',
  };
}

describe('workbenchApprovalSummary (#1819)', () => {
  it('counts permission_request blocks in the transcript', () => {
    const blocks: TranscriptBlock[] = [
      { id: 't1', kind: 'text', author, text: 'hi' },
      permissionRequest('a'),
      permissionRequest('b'),
    ];
    expect(countPendingApprovals(blocks)).toBe(2);
    expect(firstPendingApprovalBlockId(blocks)).toBe('a');
  });

  it('recurses into run_step_group children', () => {
    const blocks: TranscriptBlock[] = [
      {
        id: 'group-1',
        kind: 'run_step_group',
        author,
        icon: 'run',
        title: 'Run',
        status: 'running',
        open: true,
        children: [
          permissionRequest('nested-a'),
          {
            id: 'group-2',
            kind: 'run_step_group',
            author,
            icon: 'run',
            title: 'Nested',
            status: 'running',
            children: [permissionRequest('nested-b')],
          },
        ],
      },
    ];
    expect(countPendingApprovals(blocks)).toBe(2);
    expect(firstPendingApprovalBlockId(blocks)).toBe('nested-a');
  });

  it('counts decided approvals as not pending', () => {
    const decided: TranscriptBlock = {
      id: 'done-1',
      kind: 'permission_result',
      author,
      requestId: 'req-done',
      title: 'Allowed',
      status: 'completed',
      decision: 'allow',
    };
    expect(countPendingApprovals([decided])).toBe(0);
    expect(firstPendingApprovalBlockId([decided])).toBeUndefined();
  });

  it('treats legacy approval blocks as pending only when status is pending', () => {
    const pending: TranscriptBlock = {
      id: 'legacy-pending',
      kind: 'approval',
      author,
      title: 'Write',
      status: 'pending',
    };
    const completed: TranscriptBlock = {
      id: 'legacy-done',
      kind: 'approval',
      author,
      title: 'Write',
      status: 'completed',
    };
    expect(isPendingApprovalBlock(pending)).toBe(true);
    expect(isPendingApprovalBlock(completed)).toBe(false);
    expect(countPendingApprovals([pending, completed])).toBe(1);
  });

  it('returns zero for an empty transcript', () => {
    expect(countPendingApprovals([])).toBe(0);
    expect(firstPendingApprovalBlockId([])).toBeUndefined();
  });
});
