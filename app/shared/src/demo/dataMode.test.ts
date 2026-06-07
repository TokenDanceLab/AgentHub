import { describe, expect, it } from 'vitest';
import {
  WORKBENCH_DATA_MODE_STORAGE_KEY,
  normalizeWorkbenchDataMode,
  readWorkbenchDataModeOverride,
  resolveWorkbenchDataMode,
  writeWorkbenchDataModeOverride,
} from './dataMode';

describe('normalizeWorkbenchDataMode', () => {
  it('normalizes explicit workbench data mode values', () => {
    expect(normalizeWorkbenchDataMode('demo')).toBe('demo');
    expect(normalizeWorkbenchDataMode('mock')).toBe('demo');
    expect(normalizeWorkbenchDataMode('模拟')).toBe('demo');
    expect(normalizeWorkbenchDataMode('auto')).toBe('auto');
    expect(normalizeWorkbenchDataMode('自动')).toBe('auto');
    expect(normalizeWorkbenchDataMode('real')).toBe('real');
    expect(normalizeWorkbenchDataMode('normal')).toBe('real');
    expect(normalizeWorkbenchDataMode('正常')).toBe('real');
    expect(normalizeWorkbenchDataMode(undefined)).toBe('auto');
    expect(normalizeWorkbenchDataMode('')).toBe('auto');
    expect(normalizeWorkbenchDataMode('unexpected')).toBe('auto');
  });

  it('persists a browser override that takes priority over env mode', () => {
    localStorage.removeItem(WORKBENCH_DATA_MODE_STORAGE_KEY);

    expect(readWorkbenchDataModeOverride()).toBeUndefined();
    expect(resolveWorkbenchDataMode('real')).toBe('real');

    writeWorkbenchDataModeOverride('demo');

    expect(localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY)).toBe('demo');
    expect(readWorkbenchDataModeOverride()).toBe('demo');
    expect(resolveWorkbenchDataMode('real')).toBe('demo');
  });
});
