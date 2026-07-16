import { describe, expect, it } from 'vitest';
import en from './locales/en.json';
import zh from './locales/zh.json';

// Product Settings SSOT is shared workbench SettingsPage (own i18n surface).
// Desktop orphan SettingsPage + residual SectionId menu cluster were deleted
// (#443 / #541). Locale completeness for desktop settings remains the
// runtime category keys that desktop still owns (no components/settings scan).
const runtimeSettingsKeys = [
  'settings.dataCategory.settings',
  'settings.dataCategory.modelSettings',
  'settings.dataCategory.appearance',
  'settings.dataCategory.auth',
  'settings.dataCategory.device',
  'settings.dataCategory.config',
  'settings.dataCategory.shortcuts',
  'settings.dataCategory.agents',
  'settings.dataCategory.workspace',
  'settings.dataCategory.draft',
  'settings.dataCategory.offlineQueue',
  'settings.dataCategory.threadState',
  'settings.dataCategory.uiState',
  'settings.dataCategory.promptCache',
  'settings.dataCategory.other',
];

function collectStaticSettingsKeys(): string[] {
  return [...runtimeSettingsKeys].sort();
}

describe('Desktop settings i18n locales', () => {
  it('defines every static settings translation key in zh and en', () => {
    const keys = collectStaticSettingsKeys();
    const zhKeys = new Set(Object.keys(zh));
    const enKeys = new Set(Object.keys(en));

    expect(keys.filter((key) => !zhKeys.has(key))).toEqual([]);
    expect(keys.filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it('does not render settings keys as their own fallback text', () => {
    for (const key of collectStaticSettingsKeys()) {
      expect(zh[key as keyof typeof zh], `zh ${key}`).toBeTruthy();
      expect(en[key as keyof typeof en], `en ${key}`).toBeTruthy();
      expect(zh[key as keyof typeof zh], `zh ${key}`).not.toBe(key);
      expect(en[key as keyof typeof en], `en ${key}`).not.toBe(key);
    }
  });
});
