import { useEffect } from 'react';
import { KEYBOARD_SHORTCUTS, matchesBinding } from '@/utils/keyboardShortcuts';
import { useSearchStore } from '@/stores/searchStore';

/**
 * Central keyboard shortcut dispatcher.
 *
 * Listens on `document` for keydown events and routes them through
 * {@link matchesBinding} against the canonical KEYBOARD_SHORTCUTS config.
 * Each shortcut has a well-defined handler registered here; individual
 * components no longer add their own ad-hoc keydown listeners.
 *
 * Shortcut map:
 *  - search (Ctrl/⌘+K) — open global search dialog
 *  - chat-search (Ctrl/⌘+F) — handled by shared workbench layer (isChatSearchShortcut)
 *  - toggle-sidebar (Ctrl/⌘+B) — toggle conversation sidebar
 *  - toggle-run-panel (Ctrl/⌘+J) — toggle right inspector / run panel
 *
 * Non-keybinding concerns (e.g. Esc-to-close in dialogs) remain at the
 * component level because they depend on local open/closed state.
 */
export function useGlobalKeyboardShortcuts(): void {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      // Skip if the user is typing in an input, textarea, select, or contenteditable
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase() ?? '';
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable === true;

      // ── Shortcuts that work even inside editable elements ──
      // (none currently; all require non-editable context)

      // ── Shortcuts that only fire outside editable elements ──
      if (!isEditable) {
        const searchBinding = KEYBOARD_SHORTCUTS.find((s) => s.id === 'search')?.keys;
        if (searchBinding && matchesBinding(e, searchBinding)) {
          e.preventDefault();
          useSearchStore.getState().openDialog();
          return;
        }

        // Settings: Ctrl/⌘ + ,
        const settingsBinding = KEYBOARD_SHORTCUTS.find((s) => s.id === 'settings')?.keys;
        if (settingsBinding && matchesBinding(e, settingsBinding)) {
          e.preventDefault();
          // Navigate to settings page — dispatched via custom event so shared
          // WorkbenchFrame can pick it up without a desktop→shared import.
          window.dispatchEvent(new CustomEvent('agenthub:navigate', { detail: { page: 'settings' } }));
          return;
        }

        // Chat search: Ctrl/⌘ + F — handled by the shared useWorkbenchSessionChrome hook
        // which has its own document-level listener.  We intentionally do NOT
        // handle it here to avoid double-firing.  The shared hook calls
        // isChatSearchShortcut → matchesShortcut(['Ctrl/⌘', 'F']) under the hood.
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
