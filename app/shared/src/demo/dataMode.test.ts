import { describe, expect, it } from 'vitest';
import { normalizeWorkbenchDataMode } from './dataMode';

describe('normalizeWorkbenchDataMode', () => {
  it('normalizes explicit workbench data mode values', () => {
    expect(normalizeWorkbenchDataMode('demo')).toBe('demo');
    expect(normalizeWorkbenchDataMode('mock')).toBe('demo');
    expect(normalizeWorkbenchDataMode('real')).toBe('real');
    expect(normalizeWorkbenchDataMode(undefined)).toBe('auto');
    expect(normalizeWorkbenchDataMode('')).toBe('auto');
    expect(normalizeWorkbenchDataMode('unexpected')).toBe('auto');
  });
});
