import { describe, expect, it } from 'vitest';

import { createMobilePlatform, resolveMobileDataMode } from './mobilePlatform';

describe('Mobile platform contract', () => {
  it('identifies Mobile as its own shared platform surface without Local Edge or local file capability', () => {
    const platform = createMobilePlatform({
      hubBaseUrl: 'http://127.0.0.1:8088',
      dataMode: 'mock',
    });

    expect(platform.surface).toBe('mobile');
    // Hub-only surface: every capability backed by a local host is false.
    // pickFiles throws and ChatScreen renders no file-open path (#1947).
    expect(platform.capabilities).toEqual({
      localEdge: false,
      localFiles: false,
      browserPreview: false,
      localTerminal: false,
    });
  });

  it('resolves token-backed default mode to observed instead of claiming approved-real', () => {
    expect(resolveMobileDataMode(undefined, true)).toBe('observed');
    expect(resolveMobileDataMode('approved-real', false)).toBe('approved-real');
  });
});
