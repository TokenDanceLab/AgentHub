import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-localization', () => ({
  getLocales: () => [{ languageTag: 'en-US' }],
}));

import { resolveAgentHubLocale, strings } from './strings';

describe('AgentHub mobile i18n strings', () => {
  it('keeps zh and en dictionaries structurally aligned', () => {
    expect(Object.keys(strings.zh).sort()).toEqual(Object.keys(strings.en).sort());
  });

  it('uses Chinese for zh system locales and English otherwise', () => {
    expect(resolveAgentHubLocale('zh-CN')).toBe('zh');
    expect(resolveAgentHubLocale('zh-Hans')).toBe('zh');
    expect(resolveAgentHubLocale('zh-Hant-HK')).toBe('zh');
    expect(resolveAgentHubLocale('en-US')).toBe('en');
    expect(resolveAgentHubLocale('ja-JP')).toBe('en');
    expect(resolveAgentHubLocale(undefined)).toBe('en');
  });
});
