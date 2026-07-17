import { afterEach, describe, expect, it, vi } from 'vitest';
import { catchHubReport, formatHubError, logHubError } from './hubReportUtils';

describe('formatHubError', () => {
  it('extracts Error.message', () => {
    expect(formatHubError(new Error('hub down'))).toBe('hub down');
  });

  it('falls back to Error.name when message is empty', () => {
    const err = new Error('');
    expect(formatHubError(err)).toBe('Error');
  });

  it('returns string errors as-is', () => {
    expect(formatHubError('plain')).toBe('plain');
  });

  it('stringifies null/undefined and plain objects', () => {
    expect(formatHubError(null)).toBe('null');
    expect(formatHubError(undefined)).toBe('undefined');
    expect(formatHubError({ code: 'ECONNREFUSED' })).toBe('{"code":"ECONNREFUSED"}');
  });
});

describe('logHubError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs via console.error without throwing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => logHubError('doneTask:task-1', new Error('timeout'))).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe('[hubReport] doneTask:task-1 failed:');
    expect(spy.mock.calls[0]?.[1]).toBe('timeout');
  });
});

describe('catchHubReport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs rejected promises and resolves without rethrowing', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await catchHubReport('failTask:task-2', Promise.reject(new Error('network')));
    expect(result).toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(String(spy.mock.calls[0]?.[0])).toContain('failTask:task-2');
  });

  it('passes through fulfilled values', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await catchHubReport('ackTask:task-3', Promise.resolve({ ok: true }));
    expect(result).toEqual({ ok: true });
    expect(spy).not.toHaveBeenCalled();
  });
});
