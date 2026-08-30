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

// #2072 P1: error.startConversation + devices.pingOk/pingFailed must exist in
// both locales so t() never falls back to the raw key name on screen.
const errorUxP1Keys = [
  'error.startConversation',
  'error.cancelRunFailed',
  'devices.pingOk',
  'devices.pingFailed',
  'error.code.auth_invalid_token',
  'error.code.auth_token_expired',
  'error.code.workspace_not_allowed',
  'error.code.agent_offline',
  'error.code.target_not_routable',
];

describe('Desktop error UX P1 i18n keys (#2072)', () => {
  it('defines every P1 error key in zh and en', () => {
    const zhKeys = new Set(Object.keys(zh));
    const enKeys = new Set(Object.keys(en));
    expect(errorUxP1Keys.filter((k) => !zhKeys.has(k))).toEqual([]);
    expect(errorUxP1Keys.filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it('does not render P1 error keys as their own fallback text', () => {
    for (const key of errorUxP1Keys) {
      expect(zh[key as keyof typeof zh], `zh ${key}`).toBeTruthy();
      expect(en[key as keyof typeof en], `en ${key}`).toBeTruthy();
      expect(zh[key as keyof typeof zh], `zh ${key}`).not.toBe(key);
      expect(en[key as keyof typeof en], `en ${key}`).not.toBe(key);
    }
  });

  it('keeps zh copy free of raw English technical strings', () => {
    // Guard against accidentally pasting backend English into zh locale.
    const technicalEnglish = /\b(HTTP|proxy|stack|TypeError|ReferenceError|node:|fetch|abort)\b/i;
    for (const key of errorUxP1Keys) {
      const value = zh[key as keyof typeof zh];
      expect(value, `zh ${key} contains technical English`).not.toMatch(technicalEnglish);
    }
  });
});
