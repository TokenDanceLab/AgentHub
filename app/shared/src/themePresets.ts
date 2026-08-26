/**
 * Theme preset SSOT for AgentHub product surfaces.
 *
 * CSS values live in `styles/presets-base.css` under `[data-theme-preset=...]`.
 * This module owns the TS registry, storage key, and DOM apply helpers so
 * desktop/web shells do not fork preset lists or attribute names.
 */

export const AGENTHUB_THEME_PRESET_STORAGE_KEY = 'agenthub-v4-theme-preset';

export const THEME_PRESETS = [
  'classic-blue',
  'claude-warm',
  'chatgpt-minimal',
  'deepseek-tech',
  'one-dark-pro',
  'dracula',
] as const;

export type ThemePreset = (typeof THEME_PRESETS)[number];

export const THEME_PRESET_META: Record<
  ThemePreset,
  { label: string; lightPreview: string[]; darkPreview: string[] }
> = {
  'classic-blue': {
    label: 'Classic Blue',
    lightPreview: ['#2563EB', '#F1F5F9', '#E2E8F0'],
    darkPreview: ['#1E1E2E', '#252536', '#3B82F6'],
  },
  'claude-warm': {
    label: 'Claude Warm',
    lightPreview: ['#D97706', '#FEF3C7', '#FDE68A'],
    darkPreview: ['#2D2420', '#3D3028', '#F59E0B'],
  },
  'chatgpt-minimal': {
    label: 'ChatGPT Minimal',
    lightPreview: ['#10A37F', '#F7F7F8', '#E5E5E5'],
    darkPreview: ['#212121', '#2D2D2D', '#10A37F'],
  },
  'deepseek-tech': {
    label: 'DeepSeek Tech',
    lightPreview: ['#6366F1', '#F1F5F9', '#E2E8F0'],
    darkPreview: ['#0F172A', '#1E293B', '#818CF8'],
  },
  'one-dark-pro': {
    label: 'One Dark Pro',
    lightPreview: ['#61AFEF', '#F0F0F0', '#E0E0E0'],
    darkPreview: ['#282C34', '#2C313C', '#61AFEF'],
  },
  dracula: {
    label: 'Dracula',
    lightPreview: ['#BD93F9', '#F0F0E8', '#E0E0D8'],
    darkPreview: ['#282A36', '#2C2E3A', '#BD93F9'],
  },
};

export function isThemePreset(value: string | null | undefined): value is ThemePreset {
  return typeof value === 'string' && (THEME_PRESETS as readonly string[]).includes(value);
}

export function getStoredAgentHubThemePreset(): ThemePreset | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  try {
    const stored = localStorage.getItem(AGENTHUB_THEME_PRESET_STORAGE_KEY);
    return isThemePreset(stored) ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function persistAgentHubThemePreset(preset: ThemePreset | undefined): void {
  if (typeof localStorage !== 'undefined') {
    try {
      if (preset) {
        localStorage.setItem(AGENTHUB_THEME_PRESET_STORAGE_KEY, preset);
      } else {
        localStorage.removeItem(AGENTHUB_THEME_PRESET_STORAGE_KEY);
      }
    } catch {
      /* localStorage unavailable */
    }
  }
  // In-app state sync (#1986): surfaces holding preset state (ThemeProviders)
  // subscribe here so a write from any surface updates every consumer —
  // persistence is best-effort, notification is unconditional.
  notifyAgentHubThemePresetListeners(preset);
}

/** Apply or clear `data-theme-preset` on <html>. Matches presets-base.css selectors. */
export function applyAgentHubThemePreset(preset: ThemePreset | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (preset) {
    root.setAttribute('data-theme-preset', preset);
  } else {
    root.removeAttribute('data-theme-preset');
  }
}


// ── #1986: preset change subscription ───────────────────────────────────────
// The workbench (surface-agnostic) writes presets through `setAgentHubThemePreset`
// while Web/Desktop each hold a ThemeProvider with its own `themePreset` state.
// Without this subscription an external write leaves provider state stale
// (AuthPage chip highlight, future preset consumers). Listeners receive the
// new preset (`undefined` = default) after persistence was attempted.

export type ThemePresetListener = (preset: ThemePreset | undefined) => void;

const themePresetListeners = new Set<ThemePresetListener>();

/** Subscribe to preset changes (any surface's writes). Returns unsubscribe. */
export function subscribeAgentHubThemePreset(listener: ThemePresetListener): () => void {
  themePresetListeners.add(listener);
  return () => {
    themePresetListeners.delete(listener);
  };
}

function notifyAgentHubThemePresetListeners(preset: ThemePreset | undefined): void {
  for (const listener of [...themePresetListeners]) {
    listener(preset);
  }
}

/**
 * One-stop preset write (#1986): apply the DOM attribute, persist, and notify
 * subscribers. Use this from UI surfaces instead of calling apply/persist
 * separately so no consumer can observe a half-applied change.
 */
export function setAgentHubThemePreset(preset: ThemePreset | undefined): void {
  applyAgentHubThemePreset(preset);
  persistAgentHubThemePreset(preset);
}
