/* ═══════════════════════════════════════════════════════════════════════
   Shared keyboard shortcut matching utility.

   Provides a lightweight matchesShortcut predicate that both shared
   workbench code and desktop-layer code can use.  Handles the 'Ctrl/⌘'
   combined token so bindings work cross-platform without duplicating
   Windows (Ctrl) and macOS (⌘) entries.
   ═══════════════════════════════════════════════════════════════════════ */

/**
 * Lightweight keyboard-event subset — avoids importing DOM types
 * in environments that don't have them (tests, SSR, etc.).
 */
export interface KeyboardEventLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Check whether a keyboard event matches a key-binding pattern.
 *
 * Supported tokens:
 *  - 'Ctrl'   — Ctrl key (Windows / Linux)
 *  - '⌘'      — Cmd key (macOS)
 *  - 'Ctrl/⌘' — either Ctrl or Cmd is sufficient (cross-platform shortcut)
 *  - 'Shift'  — Shift key
 *  - 'Alt'    — Alt / Option key
 *  - any other string is treated as a main key (case-insensitive, e.g. 'K', 'Enter', 'F')
 *
 * Examples:
 *   matchesShortcut(e, ['Ctrl/⌘', 'K'])   // Ctrl+K or Cmd+K
 *   matchesShortcut(e, ['Ctrl', 'F'])     // Ctrl+F only
 *   matchesShortcut(e, ['Shift', 'Enter']) // Shift+Enter
 */
export function matchesShortcut(
  e: KeyboardEventLike,
  keys: string[],
): boolean {
  if (!keys || keys.length === 0) return false;

  // Expand 'Ctrl/⌘' token: either Ctrl or ⌘ satisfies the modifier check.
  const hasCtrlCmd = keys.includes('Ctrl/⌘');
  const effectiveKeys = keys.filter((k) => k !== 'Ctrl/⌘');

  const modifiers = new Set(
    effectiveKeys.filter((k) => ['Ctrl', '⌘', 'Shift', 'Alt'].includes(k)),
  );
  const mainKeys = effectiveKeys.filter(
    (k) => !['Ctrl', '⌘', 'Shift', 'Alt'].includes(k),
  );

  // Handle combined Ctrl/⌘ token
  if (hasCtrlCmd) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else {
    if (modifiers.has('Ctrl') !== e.ctrlKey) return false;
    if (modifiers.has('⌘') !== e.metaKey) return false;
  }
  if (modifiers.has('Shift') !== Boolean(e.shiftKey)) return false;
  if (modifiers.has('Alt') !== Boolean(e.altKey)) return false;

  if (mainKeys.length === 0) return false;
  return mainKeys.some((k) => k.toLowerCase() === e.key.toLowerCase());
}
