import { beforeEach, describe, expect, it } from 'vitest';
import {
  DESKTOP_TARGET_PREFERENCE_KEY,
  LOCAL_EDGE_TARGET_ID,
  readDesktopTargetPreference,
  resolveDesktopTargetPreference,
  writeDesktopTargetPreference,
} from './targetPreference';

describe('desktop target preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults ownership to Desktop Local Edge when no mutable preference exists', () => {
    expect(resolveDesktopTargetPreference()).toEqual({
      owner: 'desktop',
      targetId: LOCAL_EDGE_TARGET_ID,
      targetType: 'local_edge',
      route: 'local-edge-api',
      source: 'local-edge-sidecar',
    });
  });

  it('persists only the supported Local Edge target preference', () => {
    const stored = writeDesktopTargetPreference({
      owner: 'hub',
      targetId: 'cloud-edge-1',
      targetType: 'cloud_edge',
      route: 'hub-relay',
      source: 'hub',
    });

    expect(stored).toEqual(resolveDesktopTargetPreference());
    expect(readDesktopTargetPreference()).toEqual(resolveDesktopTargetPreference());
    expect(JSON.parse(localStorage.getItem(DESKTOP_TARGET_PREFERENCE_KEY) ?? '{}')).toMatchObject({
      owner: 'desktop',
      targetId: LOCAL_EDGE_TARGET_ID,
      route: 'local-edge-api',
    });
  });
});
