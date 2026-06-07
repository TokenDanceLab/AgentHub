import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'dark' | 'light';
type ThemeMode = Theme | 'system';

export const THEME_PRESETS = [
  'classic-blue',
  'claude-warm',
  'chatgpt-minimal',
  'deepseek-tech',
  'one-dark-pro',
  'dracula',
] as const;
export type ThemePreset = (typeof THEME_PRESETS)[number];

export const THEME_PRESET_META: Record<ThemePreset, { label: string; lightPreview: string[]; darkPreview: string[] }> = {
  'classic-blue':    { label: 'Classic Blue',    lightPreview: ['#2563EB', '#F1F5F9', '#E2E8F0'], darkPreview: ['#1E1E2E', '#252536', '#3B82F6'] },
  'claude-warm':     { label: 'Claude Warm',     lightPreview: ['#D97706', '#FEF3C7', '#FDE68A'], darkPreview: ['#2D2420', '#3D3028', '#F59E0B'] },
  'chatgpt-minimal': { label: 'ChatGPT Minimal', lightPreview: ['#10A37F', '#F7F7F8', '#E5E5E5'], darkPreview: ['#212121', '#2D2D2D', '#10A37F'] },
  'deepseek-tech':   { label: 'DeepSeek Tech',   lightPreview: ['#6366F1', '#F1F5F9', '#E2E8F0'], darkPreview: ['#0F172A', '#1E293B', '#818CF8'] },
  'one-dark-pro':    { label: 'One Dark Pro',    lightPreview: ['#61AFEF', '#F0F0F0', '#E0E0E0'], darkPreview: ['#282C34', '#2C313C', '#61AFEF'] },
  'dracula':         { label: 'Dracula',         lightPreview: ['#BD93F9', '#F0F0E8', '#E0E0D8'], darkPreview: ['#282A36', '#2C2E3A', '#BD93F9'] },
};

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

const STORAGE_KEY = 'agenthub-v4-theme';
const PRESET_STORAGE_KEY = 'agenthub-v4-theme-preset';

function getStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'light';
}

function getStoredPreset(): ThemePreset | undefined {
  try {
    const stored = localStorage.getItem(PRESET_STORAGE_KEY);
    if (stored && (THEME_PRESETS as readonly string[]).includes(stored)) return stored as ThemePreset;
  } catch {
    /* localStorage unavailable */
  }
  return undefined;
}

function getSystemTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

function applyThemePreset(preset: ThemePreset | undefined) {
  if (preset) {
    document.documentElement.setAttribute('data-theme-preset', preset);
  } else {
    document.documentElement.removeAttribute('data-theme-preset');
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getStoredMode);
  const [systemTheme, setSystemTheme] = useState<Theme>(getSystemTheme);
  const [themePreset, setThemePresetState] = useState<ThemePreset | undefined>(getStoredPreset);
  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  // Persist to localStorage and resolve
  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const setThemePreset = useCallback((preset: ThemePreset | undefined) => {
    setThemePresetState(preset);
    try {
      if (preset) {
        localStorage.setItem(PRESET_STORAGE_KEY, preset);
      } else {
        localStorage.removeItem(PRESET_STORAGE_KEY);
      }
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  // Listen for system theme changes when in system mode
  useEffect(() => {
    if (themeMode !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => {
      setSystemTheme(getSystemTheme());
    };
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [themeMode]);

  // Apply data-theme to <html>
  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Apply data-theme-preset to <html>
  useEffect(() => {
    applyThemePreset(themePreset);
  }, [themePreset]);

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
    <ThemeContext.Provider value={{ theme: resolvedTheme, themeMode, setThemeMode, toggleTheme, themePreset, setThemePreset }}>
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
