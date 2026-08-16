import { describe, expect, it } from 'vitest';
import {
  approvalKind,
  chunkText,
  chunkTexts,
  compact,
  decision,
  isEmptyWorkbenchData,
  keyRunLogs,
  list,
  mergeByKey,
  normalizeSnapshot,
  number,
  optionalString,
  role,
  runStatus,
  setRunStatus,
  text,
  threadItemFromMessage,
  threadItemKind,
  threadStatus,
  truncationNotice,
  upsertBy,
  withSeq,
  WORKBENCH_EPOCH,
} from './workbenchStateHelpers';
import type { WorkbenchState } from './workbenchStateTypes';

const emptyState: WorkbenchState = {
  projects: [],
  threads: [],
  runners: [],
  runs: [],
  threadItems: [],
  approvals: [],
  artifacts: [],
  previews: [],
  runLogs: {},
  connection: { status: 'idle' },
  lastSeq: 0,
};

describe('workbenchStateHelpers', () => {
  it('normalizes list payloads and compacts falsy entries', () => {
    expect(list(undefined)).toEqual([]);
    expect(list(null)).toEqual([]);
    expect(list([{ id: 'a' }])).toEqual([{ id: 'a' }]);
    expect(list({ items: [{ id: 'b' }], page: { hasMore: false } })).toEqual([{ id: 'b' }]);
    expect(compact([1, 0 as unknown as number, 2, null as unknown as number])).toEqual([1, 2]);
  });

  it('normalizes snapshots into compact collections and keyed run logs', () => {
    const snapshot = normalizeSnapshot({
      projects: { items: [{ id: 'p1', name: 'A', createdAt: WORKBENCH_EPOCH }], page: { hasMore: false } },
      runs: null,
      runLogs: [
        { runId: 'run-1', stdout: 'ok', stderr: '' },
        { runId: '', stdout: 'skip', stderr: '' } as never,
      ],
    });

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.runs).toEqual([]);
    expect(snapshot.runLogs).toEqual({
      'run-1': { runId: 'run-1', stdout: 'ok', stderr: '' },
    });
    expect(keyRunLogs(undefined)).toEqual({});
  });

  it('detects empty workbench data and merges snapshot rows behind live keys', () => {
    expect(isEmptyWorkbenchData(emptyState)).toBe(true);
    expect(
      isEmptyWorkbenchData({
        ...emptyState,
        projects: [{ id: 'p1', name: 'A', createdAt: WORKBENCH_EPOCH }],
      }),
    ).toBe(false);

    const merged = mergeByKey(
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 2 },
      ],
      [{ id: 'b', value: 20 }],
      (item) => item.id,
    );
    expect(merged).toEqual([
      { id: 'a', value: 1 },
      { id: 'b', value: 20 },
    ]);
  });

  it('upserts by id/runId and sets run status with epoch fallbacks', () => {
    const byId = upsertBy([{ id: 'x', value: 1 }], 'x', (current) => ({
      id: 'x',
      value: (current?.value ?? 0) + 1,
    }));
    expect(byId).toEqual([{ id: 'x', value: 2 }]);

    const created = upsertBy<{ id?: string; runId?: string; value: number }>(
      [],
      'run-1',
      () => ({ runId: 'run-1', value: 1 }),
    );
    expect(created).toEqual([{ runId: 'run-1', value: 1 }]);

    const runs = setRunStatus([], 'run-1', 'waiting_approval');
    expect(runs[0]).toMatchObject({
      runId: 'run-1',
      status: 'waiting_approval',
      createdAt: WORKBENCH_EPOCH,
      projectId: '',
      threadId: '',
    });
    expect('startedAt' in (runs[0] ?? {})).toBe(false);
  });

  it('builds message items and parses log chunks / truncation notices', () => {
    expect(
      threadItemFromMessage(
        { messageId: 'm1', threadId: 't1', role: 'user', content: 'hi' },
        WORKBENCH_EPOCH,
      ),
    ).toEqual({
      id: 'm1',
      threadId: 't1',
      kind: 'message',
      role: 'user',
      content: 'hi',
      createdAt: WORKBENCH_EPOCH,
    });
    expect(threadItemFromMessage({ messageId: 'm1' }, WORKBENCH_EPOCH)).toBeNull();

    expect(chunkTexts(undefined)).toEqual([]);
    expect(chunkTexts([{ text: 'a', stream: 'stderr' }, { text: 'b' }], 'stdout')).toEqual([
      { text: 'a', stream: 'stderr' },
      { text: 'b', stream: 'stdout' },
    ]);
    expect(chunkText('plain')).toEqual({ text: 'plain' });
    expect(chunkText('err', 'stderr')).toEqual({ text: 'err', stream: 'stderr' });

    expect(truncationNotice({ truncated: false })).toBeUndefined();
    expect(truncationNotice({ truncated: true, bytesWritten: 10, message: 'cap' })).toBe(
      '\n[output truncated after 10 bytes: cap]\n',
    );
    expect(truncationNotice({ truncated: true, bytesBefore: 4 })).toBe(
      '\n[output truncated after 4 bytes]\n',
    );
    expect(truncationNotice({ truncated: true, maxBytes: 8 })).toBe(
      '\n[output truncated at 8 bytes]\n',
    );
  });

  it('parses scalar/status helpers and optional property spreads', () => {
    expect(text('ok')).toBe('ok');
    expect(text(1)).toBeUndefined();
    expect(number(3)).toBe(3);
    expect(number(Number.NaN)).toBeUndefined();
    expect(role('user')).toBe('user');
    expect(role('system')).toBeUndefined();
    expect(threadStatus('archived')).toBe('archived');
    expect(threadItemKind('diff')).toBe('diff');
    expect(threadItemKind('note')).toBeUndefined();
    expect(runStatus('run.started', 'banana')).toBe('running');
    expect(runStatus('run.status.changed', 'failed')).toBe('failed');
    expect(runStatus('run.unknown', 'nope')).toBeUndefined();
    expect(approvalKind('publish')).toBe('publish');
    expect(decision('rejected')).toBe('rejected');
    expect(optionalString('url', undefined)).toEqual({});
    expect(optionalString('url', 'http://x')).toEqual({ url: 'http://x' });
    expect(withSeq(emptyState, 0)).toBe(emptyState);
    expect(withSeq(emptyState, 2).lastSeq).toBe(2);
  });
});
