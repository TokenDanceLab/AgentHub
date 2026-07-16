import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENTHUB_THEME_PRESET_STORAGE_KEY,
  THEME_PRESETS,
  applyAgentHubThemePreset,
  getStoredAgentHubThemePreset,
  isThemePreset,
  persistAgentHubThemePreset,
} from './themePresets';

describe('themePresets SSOT', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-preset');
    localStorage.clear();
  });

  it('lists the six product presets matching presets-base.css', () => {
    expect(THEME_PRESETS).toEqual([
      'classic-blue',
      'claude-warm',
      'chatgpt-minimal',
      'deepseek-tech',
      'one-dark-pro',
      'dracula',
    ]);
  });

  it('validates and persists preset storage', () => {
    expect(isThemePreset('classic-blue')).toBe(true);
    expect(isThemePreset('not-a-preset')).toBe(false);

    persistAgentHubThemePreset('dracula');
    expect(localStorage.getItem(AGENTHUB_THEME_PRESET_STORAGE_KEY)).toBe('dracula');
    expect(getStoredAgentHubThemePreset()).toBe('dracula');

    persistAgentHubThemePreset(undefined);
    expect(localStorage.getItem(AGENTHUB_THEME_PRESET_STORAGE_KEY)).toBeNull();
    expect(getStoredAgentHubThemePreset()).toBeUndefined();
  });

  it('applies data-theme-preset on the document element', () => {
    applyAgentHubThemePreset('one-dark-pro');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('one-dark-pro');

    applyAgentHubThemePreset(undefined);
    expect(document.documentElement.hasAttribute('data-theme-preset')).toBe(false);
  });
});
