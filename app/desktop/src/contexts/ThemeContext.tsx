import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
type ThemeMode = Theme | 'system';

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

const STORAGE_KEY = 'agenthub-theme';

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'dark';
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolveTheme(mode: ThemeMode): Theme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredMode);
  const [resolvedTheme, setResolvedTheme] = useState<Theme>(() => resolveTheme(getStoredMode()));

  // Persist to localStorage and resolve
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable */
    }
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
