// ThemePresetPicker behavior (#1986, UX F15): chip rendering, apply/persist
// on selection, clearing via the default chip, and honest reflection of
// preset writes that originate elsewhere (subscription, not local echo).
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_PRESETS, getStoredAgentHubThemePreset, setAgentHubThemePreset } from '@shared/theme';
import { ThemePresetPicker } from './ThemePresetPicker';

function renderPicker() {
  return render(
    <ThemePresetPicker groupLabel="Theme preset selection" defaultLabel="Default" />,
  );
}

describe('ThemePresetPicker (#1986)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-preset');
    localStorage.clear();
  });

  it('renders the default chip plus all six presets', () => {
    renderPicker();
    expect(screen.getByTestId('theme-preset-picker')).toBeInTheDocument();
    expect(screen.getByTestId('theme-preset-default')).toBeInTheDocument();
    for (const id of THEME_PRESETS) {
      expect(screen.getByTestId(`theme-preset-${id}`)).toBeInTheDocument();
    }
  });

  it('marks the default chip active when no preset is stored', () => {
    renderPicker();
    expect(screen.getByTestId('theme-preset-default')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('theme-preset-dracula')).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting a preset applies the DOM attribute, persists, and flips the active chip', () => {
    renderPicker();
    fireEvent.click(screen.getByTestId('theme-preset-dracula'));
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('dracula');
    expect(getStoredAgentHubThemePreset()).toBe('dracula');
    expect(screen.getByTestId('theme-preset-dracula')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('theme-preset-default')).toHaveAttribute('aria-pressed', 'false');
  });

  it('selecting the default chip clears the attribute and the stored preset', () => {
    act(() => {
      setAgentHubThemePreset('one-dark-pro');
    });
    renderPicker();
    expect(screen.getByTestId('theme-preset-one-dark-pro')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('theme-preset-default'));
    expect(document.documentElement.hasAttribute('data-theme-preset')).toBe(false);
    expect(getStoredAgentHubThemePreset()).toBeUndefined();
    expect(screen.getByTestId('theme-preset-default')).toHaveAttribute('aria-pressed', 'true');
  });

  it('reflects external preset writes through the subscription (no stale selection)', () => {
    renderPicker();
    // Another surface (or provider) writes a preset behind the picker's back.
    act(() => {
      setAgentHubThemePreset('claude-warm');
    });
    expect(screen.getByTestId('theme-preset-claude-warm')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('theme-preset-default')).toHaveAttribute('aria-pressed', 'false');
  });

  it('initializes from stored state (refresh persistence)', () => {
    act(() => {
      setAgentHubThemePreset('deepseek-tech');
    });
    renderPicker();
    expect(screen.getByTestId('theme-preset-deepseek-tech')).toHaveAttribute('aria-pressed', 'true');
  });
});
