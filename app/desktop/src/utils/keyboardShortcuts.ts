/* ═══════════════════════════════════════════════════════════════════════
   Desktop keyboard shortcut layer.

   Re-exports the canonical shortcut config from shared and adds
   event-specific helpers (deriveKeysFromEvent, matchesBinding) that
   depend on the DOM KeyboardEvent type.
   ═══════════════════════════════════════════════════════════════════════ */

// Re-export the canonical config + localStorage helpers from shared
export {
  KEYBOARD_SHORTCUT_GROUPS,
  KEYBOARD_SHORTCUTS,
  checkConflicts,
  getBinding,
  getResolvedShortcutGroups,
  hasCustomKeybindings,
  resetKeybindings,
  saveCustomKeybindings,
} from '@shared/utils/keyboardShortcuts';

export type {
  ShortcutGroupId,
  KeyboardShortcut,
  KeyboardShortcutGroup,
  CustomKeybinding,
} from '@shared/utils/keyboardShortcuts';

// ── Event-specific helpers (desktop only) ────────────────────────────

/** Derive a canonical key-token array from a live KeyboardEvent. */
export function deriveKeysFromEvent(e: KeyboardEvent): string[] {
  const result: string[] = [];
  if (e.ctrlKey || e.metaKey) result.push(e.ctrlKey ? 'Ctrl' : '⌘');
  if (e.altKey) result.push('Alt');
  if (e.shiftKey) result.push('Shift');
  const mainKey = e.key;
  if (!['Control', 'Meta', 'Alt', 'Shift'].includes(e.key) && mainKey) {
    result.push(mainKey.length === 1 ? mainKey.toUpperCase() : mainKey);
  }
  return result;
}

/**
 * Check whether a live KeyboardEvent matches a shortcut binding.
 *
 * Supports the 'Ctrl/⌘' combined token: either Ctrl (Windows/Linux)
 * or ⌘ (macOS) satisfies the modifier check — no need to duplicate
 * bindings per platform.
 */
export function matchesBinding(e: KeyboardEvent, keys: string[] | undefined): boolean {
  if (!keys || keys.length === 0) return false;

  // Expand 'Ctrl/⌘' token: either Ctrl or ⌘ satisfies the modifier check.
  const hasCtrlCmd = keys.includes('Ctrl/⌘');
  const effectiveKeys = keys.filter((k) => k !== 'Ctrl/⌘');

  const modifiers = new Set(effectiveKeys.filter((k) => ['Ctrl', '⌘', 'Shift', 'Alt'].includes(k)));
  const mainKeys = effectiveKeys.filter((k) => !['Ctrl', '⌘', 'Shift', 'Alt'].includes(k));

  if (hasCtrlCmd) {
    if (!e.ctrlKey && !e.metaKey) return false;
  } else {
    if (modifiers.has('Ctrl') !== e.ctrlKey) return false;
    if (modifiers.has('⌘') !== e.metaKey) return false;
  }
  if (modifiers.has('Shift') !== e.shiftKey) return false;
  if (modifiers.has('Alt') !== e.altKey) return false;

  if (mainKeys.length === 0) return false;
  return mainKeys.some((k) => k.toLowerCase() === e.key.toLowerCase());
}
