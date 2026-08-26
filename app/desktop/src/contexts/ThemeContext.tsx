import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import {
  THEME_PRESETS,
  THEME_PRESET_META,
  applyAgentHubTheme,
  applyAgentHubThemePreset,
  getStoredAgentHubThemeMode,
  getStoredAgentHubThemePreset,
  getSystemAgentHubTheme,
  persistAgentHubThemeMode,
  persistAgentHubThemePreset,
  subscribeAgentHubThemePreset,
  type AgentHubTheme,
  type AgentHubThemeMode,
  type ThemePreset,
} from '@shared/theme';

type Theme = AgentHubTheme;
type ThemeMode = AgentHubThemeMode;

// Re-export shared preset SSOT so existing desktop imports keep working.
export { THEME_PRESETS, THEME_PRESET_META, type ThemePreset };

interface ThemeContextValue {
  /** The resolved theme currently applied (dark or light). */
  theme: Theme;
  /** The user's selected mode (dark, light, or system). */
  themeMode: ThemeMode;
  /** Set a specific theme mode. */
  setThemeMode: (mode: ThemeMode) => void;
  /** Toggle between dark and light (exits system mode if active). */
  toggleTheme: () => void;
  /** The selected theme preset, or undefined for default. */
  themePreset: ThemePreset | undefined;
  /** Set a theme preset; pass undefined to reset to default. */
  setThemePreset: (preset: ThemePreset | undefined) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredAgentHubThemeMode);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemAgentHubTheme);
  const [themePreset, setThemePresetState] = useState<ThemePreset | undefined>(
    getStoredAgentHubThemePreset,
  );
  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    persistAgentHubThemeMode(mode);
  }, []);

  const setThemePreset = useCallback((preset: ThemePreset | undefined) => {
    setThemePresetState(preset);
    persistAgentHubThemePreset(preset);
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      setSystemTheme(getSystemAgentHubTheme());
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeMode]);

  // Apply data-theme to <html>
  useEffect(() => {
    applyAgentHubTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Apply data-theme-preset to <html>
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
    () => ({
      theme: resolvedTheme,
      themeMode,
      setThemeMode,
      toggleTheme,
      themePreset,
      setThemePreset,
    }),
    [resolvedTheme, themeMode, setThemeMode, toggleTheme, themePreset, setThemePreset],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}


/** Consumer hook for the desktop theme context (#1986). Mirrors the web
 *  surface's `useTheme`; throws outside the provider so misuse fails loudly
 *  instead of silently dropping theme/preset state. */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
