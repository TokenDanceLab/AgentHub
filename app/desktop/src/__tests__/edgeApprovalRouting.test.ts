import { describe, expect, it } from 'vitest';
import type {
  PermissionRequestTranscriptBlock,
  RunStepGroupTranscriptBlock,
  TextTranscriptBlock,
  TranscriptAuthor,
} from '@shared/transcript';
import { resolveEdgePermissionRunId } from '@/platform/edgeApprovalRouting';

const EDGE_AUTHOR: TranscriptAuthor = { id: 'edge', name: 'Edge', role: 'system' };

function permissionBlock(
  overrides: Partial<PermissionRequestTranscriptBlock> & { requestId: string },
): PermissionRequestTranscriptBlock {
  return {
    id: `edge-event-${overrides.requestId}`,
    author: EDGE_AUTHOR,
    kind: 'permission_request',
    title: `Permission requested: ${overrides.toolName ?? 'shell'}`,
    status: 'pending',
    ...overrides,
  };
}

function textBlock(id: string): TextTranscriptBlock {
  return { id, author: EDGE_AUTHOR, kind: 'text', text: 'context block' };
}

describe('resolveEdgePermissionRunId', () => {
  it('recovers the runId from the matching permission_request run evidence', () => {
    const transcript = [
      textBlock('t1'),
      permissionBlock({
        requestId: 'perm-1',
        evidenceRefs: [
          { id: 'run-run-42', kind: 'run', label: 'Run run-42', status: 'pending' },
          { id: 'approval-perm-1', kind: 'approval', label: 'shell approval', status: 'pending' },
        ],
      }),
    ];

    expect(resolveEdgePermissionRunId(transcript, 'perm-1')).toBe('run-42');
  });

  it('matches the requested permission, not a sibling request', () => {
    const transcript = [
      permissionBlock({
        requestId: 'perm-old',
        evidenceRefs: [{ id: 'run-run-old', kind: 'run', label: 'Run run-old' }],
      }),
      permissionBlock({
        requestId: 'perm-new',
        evidenceRefs: [{ id: 'run-run-new', kind: 'run', label: 'Run run-new' }],
      }),
    ];

    expect(resolveEdgePermissionRunId(transcript, 'perm-old')).toBe('run-old');
    expect(resolveEdgePermissionRunId(transcript, 'perm-new')).toBe('run-new');
  });

  it('finds requests nested inside a run_step_group', () => {
    const group: RunStepGroupTranscriptBlock = {
      id: 'group-1',
      author: EDGE_AUTHOR,
      kind: 'run_step_group',
      title: 'Run steps',
      status: 'running',
      children: [
        permissionBlock({
          requestId: 'perm-nested',
          evidenceRefs: [{ id: 'run-run-nested', kind: 'run', label: 'Run run-nested' }],
        }),
      ],
    };

    expect(resolveEdgePermissionRunId([group], 'perm-nested')).toBe('run-nested');
  });

  it('returns undefined when no block matches the requestId', () => {
    const transcript = [
      permissionBlock({
        requestId: 'perm-other',
        evidenceRefs: [{ id: 'run-run-1', kind: 'run', label: 'Run run-1' }],
      }),
    ];

    expect(resolveEdgePermissionRunId(transcript, 'perm-missing')).toBeUndefined();
  });

  it('returns undefined when the matching block carries no run evidence', () => {
    const transcript = [
      permissionBlock({
        requestId: 'perm-no-run',
        evidenceRefs: [{ id: 'approval-perm-no-run', kind: 'approval', label: 'shell approval' }],
      }),
    ];

    expect(resolveEdgePermissionRunId(transcript, 'perm-no-run')).toBeUndefined();
  });
});
