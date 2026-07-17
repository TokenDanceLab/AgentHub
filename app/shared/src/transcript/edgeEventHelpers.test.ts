import { describe, expect, it } from 'vitest';
import {
  booleanField,
  cleanText,
  diffStat,
  durationLabel,
  errorPayloadMessage,
  firstString,
  formatCost,
  isRecord,
  numberField,
  pathFromContent,
  safeAuthorId,
  stringField,
} from './edgeEventFields';
import {
  approvalEvidence,
  eventRunId,
  normalizeApprovalRisk,
  normalizeEvidenceStatus,
  normalizeFileAction,
  runEvidence,
  toolEvidence,
} from './edgeEventEvidence';
import type { EventEnvelope } from '../events';

describe('edgeEventFields', () => {
  it('parses string / number / boolean fields with trim + finite guards', () => {
    expect(stringField('  hello  ')).toBe('hello');
    expect(stringField('   ')).toBeUndefined();
    expect(stringField(12)).toBeUndefined();
    expect(numberField(3.5)).toBe(3.5);
    expect(numberField('42')).toBe(42);
    expect(numberField('nope')).toBeUndefined();
    expect(numberField(Number.NaN)).toBeUndefined();
    expect(booleanField(true)).toBe(true);
    expect(booleanField('true')).toBeUndefined();
  });

  it('firstString returns the first non-empty string field', () => {
    expect(firstString(null, '  ', 'alpha', 'beta')).toBe('alpha');
    expect(firstString(undefined, 1, false)).toBeUndefined();
  });

  it('isRecord rejects arrays and null', () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord([1])).toBe(false);
  });

  it('formats cost, duration, and diff stats', () => {
    expect(formatCost(1.2)).toBe('$1.20');
    expect(formatCost(undefined)).toBeUndefined();
    expect(durationLabel(500)).toBe('500ms');
    expect(durationLabel(1500)).toBe('1.5s');
    expect(durationLabel(65000)).toBe('1m5s');
    expect(diffStat('+a\n-b\n ctx\n+++ header', '+')).toBe(1);
    expect(diffStat('+a\n-b\n--- header', '-')).toBe(1);
  });

  it('extracts path / error payload / cleans text / safe author id', () => {
    expect(cleanText('  hi  ')).toBe('hi');
    expect(cleanText('   ')).toBeUndefined();
    expect(pathFromContent('touched app/shared/foo.ts end')).toBe('app/shared/foo.ts');
    expect(pathFromContent('no path here')).toBeUndefined();
    expect(errorPayloadMessage({ message: ' boom ' })).toBe('boom');
    expect(errorPayloadMessage('not-object')).toBeUndefined();
    expect(safeAuthorId('Agent Name!!', 'agent')).toBe('agent-name');
    expect(safeAuthorId('!!!', 'agent')).toBe('agent');
  });
});

describe('edgeEventEvidence', () => {
  it('normalizes evidence status and approval risk', () => {
    expect(normalizeEvidenceStatus('queued')).toBe('pending');
    expect(normalizeEvidenceStatus('streaming')).toBe('running');
    expect(normalizeEvidenceStatus('denied')).toBe('failed');
    expect(normalizeEvidenceStatus('ready')).toBe('completed');
    expect(normalizeEvidenceStatus('mystery')).toBe('running');
    expect(normalizeApprovalRisk('高风险')).toBe('high');
    expect(normalizeApprovalRisk('mid')).toBe('medium');
    expect(normalizeApprovalRisk('nope')).toBeUndefined();
  });

  it('normalizes file actions and builds evidence refs', () => {
    expect(normalizeFileAction('add')).toBe('created');
    expect(normalizeFileAction('removed')).toBe('deleted');
    expect(normalizeFileAction('edit')).toBe('modified');
    expect(runEvidence('r1', 'running')).toEqual([
      { id: 'run-r1', kind: 'run', label: 'Run r1', status: 'running' },
    ]);
    expect(runEvidence(undefined, 'running')).toEqual([]);
    expect(toolEvidence('c1', 'rg', 'completed')).toEqual([
      { id: 'tool-c1', kind: 'tool', label: 'rg', status: 'completed' },
    ]);
    expect(approvalEvidence('a1', 'Write', 'pending')).toEqual({
      id: 'approval-a1',
      kind: 'approval',
      label: 'Write approval',
      status: 'pending',
    });
    expect(approvalEvidence('a1', 'Write approval', 'pending').label).toBe('Write approval');
  });

  it('reads runId from payload or scope', () => {
    const event = {
      id: 'e1',
      type: 'run.output',
      seq: 1,
      sentAt: '2026-06-07T00:00:00Z',
      scope: { runId: 'from-scope' },
      payload: {},
    } as EventEnvelope;
    expect(eventRunId(event)).toBe('from-scope');
    expect(eventRunId({ ...event, payload: { runId: 'from-payload' } })).toBe('from-payload');
  });
});
