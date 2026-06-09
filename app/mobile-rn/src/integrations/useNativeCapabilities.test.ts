import { describe, expect, it } from 'vitest';

import { formatStorageLabel } from './useNativeCapabilities';

describe('AgentHub native capability status helpers', () => {
  it('formats storage snapshots without exposing local file paths', () => {
    expect(formatStorageLabel({})).toBe('Unknown');
    expect(formatStorageLabel({ availableBytes: 512 })).toBe('512 B');
    expect(formatStorageLabel({ totalBytes: 1024 * 1024 })).toBe('1.0 MB');
    expect(formatStorageLabel({ availableBytes: 1024 * 1024, totalBytes: 2 * 1024 * 1024 })).toBe('1.0 MB / 2.0 MB');
    expect(formatStorageLabel({
      availableBytes: 1024,
      cacheUri: 'file:///private/cache/agenthub-evidence',
      totalBytes: 4096,
    })).toBe('1.0 KB / 4.0 KB');
  });
});
