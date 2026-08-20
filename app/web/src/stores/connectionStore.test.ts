import { describe, expect, it } from 'vitest';
import { deriveWorkbenchConnectionStatus } from './connectionStore';

describe('deriveWorkbenchConnectionStatus (#1816)', () => {
  it('maps live connection to connected', () => {
    expect(deriveWorkbenchConnectionStatus({ isConnected: true, reconnecting: false }))
      .toBe('connected');
    // A live socket wins even if a stale reconnecting flag is set.
    expect(deriveWorkbenchConnectionStatus({ isConnected: true, reconnecting: true }))
      .toBe('connected');
  });

  it('maps an in-flight reconnection to connecting', () => {
    expect(deriveWorkbenchConnectionStatus({ isConnected: false, reconnecting: true }))
      .toBe('connecting');
  });

  it('maps the idle/down state to disconnected', () => {
    expect(deriveWorkbenchConnectionStatus({ isConnected: false, reconnecting: false }))
      .toBe('disconnected');
  });
});
