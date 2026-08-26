import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import {
  applyAgentHubTheme,
  applyAgentHubThemePreset,
  getStoredAgentHubThemeMode,
  getStoredAgentHubThemePreset,
  getSystemAgentHubTheme,
  persistAgentHubThemeMode,
  persistAgentHubThemePreset,
  subscribeAgentHubThemePreset,
  resolveAgentHubTheme,
  type AgentHubTheme,
  type AgentHubThemeMode,
  type ThemePreset,
} from '@shared/theme';

type Theme = AgentHubTheme;
type ThemeMode = AgentHubThemeMode;

interface ThemeContextValue {
  /** The resolved theme currently applied (dark or light). */
  theme: Theme;
  /** The user's selected mode (dark, light, or system). */
  themeMode: ThemeMode;
  /** Set a specific theme mode. */
  setThemeMode: (mode: ThemeMode) => void;
  /** Toggle between dark and light (exits system mode if active). */
  toggleTheme: () => void;
  /** The active theme preset, or undefined for the AgentHub default. */
  themePreset: ThemePreset | undefined;
  /** Set a theme preset; pass undefined to reset to the default. */
  setThemePreset: (preset: ThemePreset | undefined) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Thin React wrapper over shared theme SSOT (`@shared/theme`).
 * Preset registry/apply/subscription lives in shared; the workbench settings
 * surface owns the preset picker (#1986) and writes through the shared SSOT,
 * which this provider follows via `subscribeAgentHubThemePreset`.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredAgentHubThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(() =>
    resolveAgentHubTheme(getStoredAgentHubThemeMode()),
  );
  const [themePreset, setThemePresetState] = useState<ThemePreset | undefined>(
    getStoredAgentHubThemePreset,
  );

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    persistAgentHubThemeMode(mode);
  }, []);

  const setThemePreset = useCallback((preset: ThemePreset | undefined) => {
    setThemePresetState(preset);
    persistAgentHubThemePreset(preset);
  }, []);

  // Keep resolvedTheme in sync with themeMode + system changes
  useEffect(() => {
    setResolvedTheme(resolveAgentHubTheme(themeMode));
  }, [themeMode]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      setResolvedTheme(getSystemAgentHubTheme());
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeMode]);

  // Apply data-theme to <html>
  useEffect(() => {
    applyAgentHubTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Apply data-theme-preset to <html> (matches presets-base.css selectors)
  useEffect(() => {
    applyAgentHubThemePreset(themePreset);
  }, [themePreset]);

  // #1986: preset writes can originate from other surfaces (workbench
  // settings). Subscribe so provider state never goes stale; a provider's
  // own write echoes back as an identity no-op.
  useEffect(() => {
    return subscribeAgentHubThemePreset((preset) => {
      setThemePresetState((current) => (current === preset ? current : preset));
    });
  }, []);

  const toggleTheme = useCallback(() => {
    if (themeMode === 'system') {
      // Exiting system mode: pick the opposite of current system preference
      const next = getSystemAgentHubTheme() === 'dark' ? 'light' : 'dark';
      setThemeMode(next);
    } else {
      const next: Theme = themeMode === 'dark' ? 'light' : 'dark';
      setThemeMode(next);
    }
  }, [themeMode, setThemeMode]);

  const contextValue = useMemo<ThemeContextValue>(
    () => ({ theme: resolvedTheme, themeMode, setThemeMode, toggleTheme, themePreset, setThemePreset }),
    [resolvedTheme, themeMode, setThemeMode, toggleTheme, themePreset, setThemePreset],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

/**
 * Non-throwing variant for surfaces that must render both inside and outside
 * the provider (SSR, tests, storybook). Returns null when absent.
 */
export function useThemeContext(): ThemeContextValue | null {
  return useContext(ThemeContext);
}
