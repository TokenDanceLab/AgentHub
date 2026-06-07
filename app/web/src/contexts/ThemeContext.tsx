import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
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

function getStoredMode(): ThemeMode {
  return getStoredAgentHubThemeMode();
}

function getSystemTheme(): Theme {
  return getSystemAgentHubTheme();
}

function resolveTheme(mode: ThemeMode): Theme {
  return resolveAgentHubTheme(mode);
}

function applyTheme(theme: Theme) {
  applyAgentHubTheme(theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredMode);
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(() => resolveTheme(getStoredMode()));

  // Persist to localStorage and resolve
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    persistAgentHubThemeMode(mode);
  }, []);

  // Keep resolvedTheme in sync with themeMode + system changes
  useEffect(() => {
    const resolved = resolveTheme(themeMode);
    setResolvedTheme(resolved);
  }, [themeMode]);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      setResolvedTheme(getSystemTheme());
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeMode]);

  // Apply data-theme to <html>
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  const toggleTheme = useCallback(() => {
    if (themeMode === 'system') {
      // Exiting system mode: pick the opposite of current system preference
      const next = getSystemTheme() === 'dark' ? 'light' : 'dark';
      setThemeMode(next);
    } else {
      const next: Theme = themeMode === 'dark' ? 'light' : 'dark';
      setThemeMode(next);
    }
  }, [themeMode, setThemeMode]);

  return (
    <ThemeContext.Provider value={{ theme: resolvedTheme, themeMode, setThemeMode, toggleTheme }}>
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
