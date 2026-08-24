import { describe, expect, it } from 'vitest';

import { createMobilePlatform, resolveMobileDataMode } from './mobilePlatform';

describe('Mobile platform contract', () => {
  it('identifies Mobile as a Hub-only surface without Local Edge or local file capability', () => {
    const platform = createMobilePlatform({
      hubBaseUrl: 'http://127.0.0.1:8088',
      dataMode: 'mock',
    });

    expect(platform.surface).toBe('mobile');
    expect(platform.capabilities.localEdge).toBe(false);
    // #1947: Mobile has no local workspace/file-open path (pickFiles throws),
    // so the flag must stay false and keep localFiles-gated shell entries hidden.
    expect(platform.capabilities.localFiles).toBe(false);
  });

  it('resolves token-backed default mode to observed instead of claiming approved-real', () => {
    expect(resolveMobileDataMode(undefined, true)).toBe('observed');
    expect(resolveMobileDataMode('approved-real', false)).toBe('approved-real');
  });
});
