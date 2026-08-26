import { afterEach, describe, expect, it } from 'vitest';
import {
  AGENTHUB_THEME_PRESET_STORAGE_KEY,
  THEME_PRESETS,
  applyAgentHubThemePreset,
  getStoredAgentHubThemePreset,
  isThemePreset,
  persistAgentHubThemePreset,
  setAgentHubThemePreset,
  subscribeAgentHubThemePreset,
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


describe('themePreset subscription + one-stop setter (#1986)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-preset');
    localStorage.clear();
  });

  it('notifies subscribers when a preset is persisted', () => {
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeAgentHubThemePreset((preset) => seen.push(preset));
    persistAgentHubThemePreset('dracula');
    persistAgentHubThemePreset(undefined);
    unsubscribe();
    persistAgentHubThemePreset('classic-blue'); // after unsubscribe: silent
    expect(seen).toEqual(['dracula', undefined]);
    expect(getStoredAgentHubThemePreset()).toBe('classic-blue');
  });

  it('setAgentHubThemePreset applies the attribute, persists, and notifies in one call', () => {
    const seen: Array<string | undefined> = [];
    const unsubscribe = subscribeAgentHubThemePreset((preset) => seen.push(preset));
    setAgentHubThemePreset('claude-warm');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('claude-warm');
    expect(getStoredAgentHubThemePreset()).toBe('claude-warm');
    expect(seen).toEqual(['claude-warm']);
    setAgentHubThemePreset(undefined);
    expect(document.documentElement.hasAttribute('data-theme-preset')).toBe(false);
    expect(getStoredAgentHubThemePreset()).toBeUndefined();
    expect(seen).toEqual(['claude-warm', undefined]);
    unsubscribe();
  });

  it('unsubscribing one listener does not silence the others', () => {
    const a: Array<string | undefined> = [];
    const b: Array<string | undefined> = [];
    const unsubA = subscribeAgentHubThemePreset((preset) => a.push(preset));
    const unsubB = subscribeAgentHubThemePreset((preset) => b.push(preset));
    unsubA();
    setAgentHubThemePreset('deepseek-tech');
    expect(a).toEqual([]);
    expect(b).toEqual(['deepseek-tech']);
    unsubB();
    setAgentHubThemePreset(undefined);
  });
});
