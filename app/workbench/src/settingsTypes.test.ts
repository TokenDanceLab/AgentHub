import { describe, expect, it } from 'vitest';
import {
  ALL_SETTINGS_KEYS,
  BOOLEAN_SETTINGS_KEYS,
  JSON_SETTINGS_KEYS,
  LOCAL_ONLY_KEYS,
  STRING_SETTINGS_KEYS,
  deserializeSettings,
  serializeSettings,
} from './settingsTypes';

describe('settings key registries', () => {
  it('ALL_SETTINGS_KEYS is the disjoint union of boolean/string/json groups', () => {
    expect(ALL_SETTINGS_KEYS).toHaveLength(
      BOOLEAN_SETTINGS_KEYS.length + STRING_SETTINGS_KEYS.length + JSON_SETTINGS_KEYS.length,
    );
    expect(new Set(ALL_SETTINGS_KEYS).size).toBe(ALL_SETTINGS_KEYS.length);
    for (const key of [...BOOLEAN_SETTINGS_KEYS, ...STRING_SETTINGS_KEYS, ...JSON_SETTINGS_KEYS]) {
      expect(ALL_SETTINGS_KEYS).toContain(key);
    }
  });

  it('local-only keys never overlap the persistable keys', () => {
    for (const key of LOCAL_ONLY_KEYS) {
      expect(ALL_SETTINGS_KEYS).not.toContain(key);
    }
  });
});

describe('serializeSettings', () => {
  it('serializes booleans, objects and strings, skipping unknown and undefined keys', () => {
    const serialized = serializeSettings({
      inspectorVisible: true,
      stackedAvatars: false,
      theme: '深色',
      permissions: { allow: ['shell'] },
      notASettingKey: 'ignored',
      density: undefined,
    });
    expect(serialized).toEqual({
      inspectorVisible: 'true',
      stackedAvatars: 'false',
      theme: '深色',
      permissions: '{"allow":["shell"]}',
    });
  });

  it('coerces non-string scalar values via String()', () => {
    // logLevel is a string-typed key; a stray number must still serialize.
    const serialized = serializeSettings({ logLevel: 3 as unknown as string });
    expect(serialized.logLevel).toBe('3');
  });
});

describe('deserializeSettings', () => {
  it('parses boolean and JSON keys back into typed values', () => {
    const parsed = deserializeSettings({
      inspectorVisible: 'true',
      stackedAvatars: 'false',
      theme: '深色',
      stateStrategies: '{"a":1}',
    });
    expect(parsed).toEqual({
      inspectorVisible: true,
      stackedAvatars: false,
      theme: '深色',
      stateStrategies: { a: 1 },
    });
  });

  it('keeps corrupt JSON payloads as raw strings and ignores unknown keys', () => {
    const parsed = deserializeSettings({
      permissions: '{not json',
      bogus: 'nope',
    });
    expect(parsed).toEqual({ permissions: '{not json' });
  });

  it('round-trips a full settings snapshot', () => {
    const snapshot = {
      inspectorVisible: true,
      theme: '浅色',
      permissions: { role: 'admin' },
    };
    expect(deserializeSettings(serializeSettings(snapshot))).toEqual(snapshot);
  });
});
