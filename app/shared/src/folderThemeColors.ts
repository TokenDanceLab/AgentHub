/**
 * Per-folder theme color SSOT for multi-project workbench visual partitioning.
 *
 * Mirrors the themePresets.ts pattern: TS registry + DOM apply helper so
 * desktop/web shells share one palette. CSS values live in
 * `styles/presets-folder-colors.css` under `[data-folder-accent=...]`.
 *
 * Design intent (agenthub-uiux-gap-analysis #M): each workspace folder may
 * carry an accent key; the active folder's accent drives `--td-accent` (and
 * soft/foreground/ring variants) for chrome/border/badge tinting. Unset folders
 * fall back to `--primary` (no visual regression).
 */

export const FOLDER_THEME_COLORS = [
  'plum',
  'blue',
  'emerald',
  'amber',
  'rose',
  'violet',
  'cyan',
  'orange',
] as const;

export type FolderThemeColor = (typeof FOLDER_THEME_COLORS)[number];

export interface FolderThemeColorMeta {
  /** Display label for the palette picker. */
  label: string;
  /** Accent fill in dark theme (hex). */
  dark: string;
  /** Accent fill in light theme (hex). */
  light: string;
  /** Foreground text on accent fill, dark theme. */
  darkForeground: string;
  /** Foreground text on accent fill, light theme. */
  lightForeground: string;
  /** Soft tint background for badges/icon chips, dark theme (rgba). */
  darkSoft: string;
  /** Soft tint background for badges/icon chips, light theme (rgba). */
  lightSoft: string;
  /** Focus ring rgba, dark theme. */
  darkRing: string;
  /** Focus ring rgba, light theme. */
  lightRing: string;
}

export const FOLDER_THEME_COLOR_META: Record<FolderThemeColor, FolderThemeColorMeta> = {
  plum: {
    label: 'Plum',
    dark: '#7c89e6',
    light: '#5d68cc',
    darkForeground: '#ffffff',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(124, 137, 230, 0.14)',
    lightSoft: 'rgba(93, 104, 204, 0.10)',
    darkRing: 'rgba(124, 137, 230, 0.42)',
    lightRing: 'rgba(93, 104, 204, 0.30)',
  },
  blue: {
    label: 'Blue',
    dark: '#3b82f6',
    light: '#2563eb',
    darkForeground: '#ffffff',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(59, 130, 246, 0.14)',
    lightSoft: 'rgba(37, 99, 235, 0.10)',
    darkRing: 'rgba(59, 130, 246, 0.42)',
    lightRing: 'rgba(37, 99, 235, 0.25)',
  },
  emerald: {
    label: 'Emerald',
    dark: '#34d399',
    light: '#10b981',
    darkForeground: '#06281d',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(52, 211, 153, 0.14)',
    lightSoft: 'rgba(16, 185, 129, 0.10)',
    darkRing: 'rgba(52, 211, 153, 0.42)',
    lightRing: 'rgba(16, 185, 129, 0.25)',
  },
  amber: {
    label: 'Amber',
    dark: '#f59e0b',
    light: '#d97706',
    darkForeground: '#2a1a02',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(245, 158, 11, 0.16)',
    lightSoft: 'rgba(217, 119, 6, 0.10)',
    darkRing: 'rgba(245, 158, 11, 0.42)',
    lightRing: 'rgba(217, 119, 6, 0.25)',
  },
  rose: {
    label: 'Rose',
    dark: '#fb7185',
    light: '#e11d48',
    darkForeground: '#2a060d',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(251, 113, 133, 0.14)',
    lightSoft: 'rgba(225, 29, 72, 0.10)',
    darkRing: 'rgba(251, 113, 133, 0.42)',
    lightRing: 'rgba(225, 29, 72, 0.25)',
  },
  violet: {
    label: 'Violet',
    dark: '#a78bfa',
    light: '#7c3aed',
    darkForeground: '#1a0f2e',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(167, 139, 250, 0.14)',
    lightSoft: 'rgba(124, 58, 237, 0.10)',
    darkRing: 'rgba(167, 139, 250, 0.42)',
    lightRing: 'rgba(124, 58, 237, 0.25)',
  },
  cyan: {
    label: 'Cyan',
    dark: '#22d3ee',
    light: '#0891b2',
    darkForeground: '#04252e',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(34, 211, 238, 0.14)',
    lightSoft: 'rgba(8, 145, 178, 0.10)',
    darkRing: 'rgba(34, 211, 238, 0.42)',
    lightRing: 'rgba(8, 145, 178, 0.25)',
  },
  orange: {
    label: 'Orange',
    dark: '#fb923c',
    light: '#ea580c',
    darkForeground: '#2a1402',
    lightForeground: '#ffffff',
    darkSoft: 'rgba(251, 146, 60, 0.14)',
    lightSoft: 'rgba(234, 88, 12, 0.10)',
    darkRing: 'rgba(251, 146, 60, 0.42)',
    lightRing: 'rgba(234, 88, 12, 0.25)',
  },
};

export function isFolderThemeColor(
  value: string | null | undefined,
): value is FolderThemeColor {
  return typeof value === 'string' && (FOLDER_THEME_COLORS as readonly string[]).includes(value);
}

export function getFolderThemeColorMeta(
  color: FolderThemeColor,
): FolderThemeColorMeta {
  return FOLDER_THEME_COLOR_META[color];
}

/**
 * Apply or clear `data-folder-accent` on <html>. Matches presets-folder-colors.css
 * selectors. Pass undefined to revert to the default (no accent attribute →
 * --td-accent falls back to --primary).
 */
export function applyFolderThemeColor(color: FolderThemeColor | undefined): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (color) {
    root.setAttribute('data-folder-accent', color);
  } else {
    root.removeAttribute('data-folder-accent');
  }
}
