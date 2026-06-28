import { describe, expect, it } from 'vitest';

import { createMobilePlatform, resolveMobileDataMode } from './mobilePlatform';

describe('Mobile platform contract', () => {
  it('identifies Mobile as its own shared platform surface without Local Edge capability', () => {
    const platform = createMobilePlatform({
      hubBaseUrl: 'http://127.0.0.1:8088',
      dataMode: 'mock',
    });

    expect(platform.surface).toBe('mobile');
    expect(platform.capabilities.localEdge).toBe(false);
    expect(platform.capabilities.localFiles).toBe(true);
  });

  it('resolves token-backed default mode to observed instead of claiming approved-real', () => {
    expect(resolveMobileDataMode(undefined, true)).toBe('observed');
    expect(resolveMobileDataMode('approved-real', false)).toBe('approved-real');
  });
});
