export type AgentHubTheme = 'dark' | 'light';
export type AgentHubThemeMode = AgentHubTheme | 'system';

export const AGENTHUB_THEME_STORAGE_KEY = 'agenthub-v4-theme';

// Preset registry / apply helpers — shared SSOT (see themePresets.ts + presets-base.css)
export {
  AGENTHUB_THEME_PRESET_STORAGE_KEY,
  THEME_PRESETS,
  THEME_PRESET_META,
  applyAgentHubThemePreset,
  getStoredAgentHubThemePreset,
  setAgentHubThemePreset,
  subscribeAgentHubThemePreset,
  isThemePreset,
  persistAgentHubThemePreset,
  type ThemePreset,
  type ThemePresetListener,
} from './themePresets';

const TRANSITION_SYNC_ATTR = 'data-theme-sync';
let transitionSyncTimer: number | undefined;

export function getSystemAgentHubTheme(): AgentHubTheme {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function resolveAgentHubTheme(mode: AgentHubThemeMode): AgentHubTheme {
  return mode === 'system' ? getSystemAgentHubTheme() : mode;
}

export function getStoredAgentHubThemeMode(): AgentHubThemeMode {
  try {
    const stored = localStorage.getItem(AGENTHUB_THEME_STORAGE_KEY);
    if (stored === 'dark' || stored === 'light' || stored === 'system') return stored;
  } catch {
    /* localStorage unavailable */
  }
  return 'light';
}

export function persistAgentHubThemeMode(mode: AgentHubThemeMode): void {
  try {
    localStorage.setItem(AGENTHUB_THEME_STORAGE_KEY, mode);
  } catch {
    /* localStorage unavailable */
  }
}

export function getAppliedAgentHubTheme(): AgentHubTheme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

export function applyAgentHubTheme(
  theme: AgentHubTheme,
  options: { persistMode?: AgentHubThemeMode; syncTransitions?: boolean } = {},
): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  if (options.persistMode) {
    persistAgentHubThemeMode(options.persistMode);
  }

  if (options.syncTransitions !== false) {
    root.setAttribute(TRANSITION_SYNC_ATTR, 'true');
    if (transitionSyncTimer !== undefined) {
      window.clearTimeout(transitionSyncTimer);
    }
  }

  root.setAttribute('data-theme', theme);
  root.style.colorScheme = theme;

  if (options.syncTransitions !== false) {
    const releaseSync = () => {
      transitionSyncTimer = window.setTimeout(() => {
        root.removeAttribute(TRANSITION_SYNC_ATTR);
        transitionSyncTimer = undefined;
      }, 80);
    };

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => window.requestAnimationFrame(releaseSync));
      return;
    }
    releaseSync();
  }
}

export function toggleAppliedAgentHubTheme(): AgentHubTheme {
  const next = getAppliedAgentHubTheme() === 'dark' ? 'light' : 'dark';
  applyAgentHubTheme(next, { persistMode: next });
  return next;
}
