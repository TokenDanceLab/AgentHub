import React from 'react';
// ThemeProvider preset sync (#1986): the provider must follow preset writes
// that originate outside the React tree (workbench settings), otherwise the
// next consumer of `themePreset` renders a stale selection.
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

// jsdom has no matchMedia; the provider's system-theme init needs the API.
beforeAll(() => {
  if (typeof window !== 'undefined' && !window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  }
});
import { setAgentHubThemePreset, persistAgentHubThemePreset } from '@shared/theme';
import { ThemeProvider, useTheme } from './ThemeContext';

function Probe(): React.ReactElement {
  const { themePreset, setThemePreset } = useTheme();
  return (
    <div>
      <span data-testid="preset-value">{themePreset ?? 'default'}</span>
      <button type="button" data-testid="set-internal" onClick={() => setThemePreset('dracula')}>
        set
      </button>
    </div>
  );
}

describe('ThemeProvider preset sync (#1986)', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme-preset');
    localStorage.clear();
  });

  it('initializes themePreset from storage', () => {
    persistAgentHubThemePreset('classic-blue');
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preset-value')).toHaveTextContent('classic-blue');
  });

  it('follows external preset writes without going stale', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preset-value')).toHaveTextContent('default');
    // Workbench settings (or any other surface) writes a preset directly.
    act(() => {
      setAgentHubThemePreset('one-dark-pro');
    });
    expect(screen.getByTestId('preset-value')).toHaveTextContent('one-dark-pro');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('one-dark-pro');
    // Clearing returns to default.
    act(() => {
      setAgentHubThemePreset(undefined);
    });
    expect(screen.getByTestId('preset-value')).toHaveTextContent('default');
  });

  it('keeps its own setThemePreset path working (apply + persist + state)', () => {
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByTestId('set-internal'));
    expect(screen.getByTestId('preset-value')).toHaveTextContent('dracula');
    expect(document.documentElement.getAttribute('data-theme-preset')).toBe('dracula');
  });
});
