import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import {
  applyAgentHubTheme,
  getStoredAgentHubThemeMode,
  getSystemAgentHubTheme,
  persistAgentHubThemeMode,
  resolveAgentHubTheme,
  type AgentHubTheme,
  type AgentHubThemeMode,
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
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Thin React wrapper over shared theme SSOT (`@shared/theme`).
 * Web does not expose preset UI yet; CSS presets still load via styles/presets.css.
 * Preset registry/apply lives in shared for desktop (and future web) consumers.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredAgentHubThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(() =>
    resolveAgentHubTheme(getStoredAgentHubThemeMode()),
  );

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    persistAgentHubThemeMode(mode);
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
    () => ({ theme: resolvedTheme, themeMode, setThemeMode, toggleTheme }),
    [resolvedTheme, themeMode, setThemeMode, toggleTheme],
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
