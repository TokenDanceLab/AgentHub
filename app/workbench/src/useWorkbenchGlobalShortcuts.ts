import { useEffect, useRef } from 'react';
import { getResolvedShortcutGroups } from '@shared/utils/keyboardShortcuts';
import { matchesShortcut } from '@shared/utils/keyboardUtils';
import { isEditableKeyboardTarget } from './workbenchSessionChromeHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchGlobalShortcuts — shared global keyboard dispatcher (#1822).

   Lives in the workbench layer (not desktop) so Web and Desktop shells get
   the same declared-but-real shortcuts: the help panel and Settings
   ShortcutsPane are shared surfaces, so the dispatcher must be shared too.

   Handled here (each has a real handler or it would not be in the canonical
   config):
   - search (Ctrl/⌘+K)         → global conversation/message search dialog
   - settings (Ctrl/⌘+,)       → navigate to the settings page
   - toggle-sidebar (Ctrl/⌘+B) → collapse/expand the conversation sidebar
   - toggle-run-panel (Ctrl/⌘+J) → collapse/expand the right inspector
   - Ctrl+P                    → quick-open the inspector Files tab (claimed
                                 by the inspector quick-open menu)

   Deliberately NOT handled here:
   - chat-search (Ctrl/⌘+F) — owned by useWorkbenchSessionChrome (needs the
     chat page + search panel state).
   - help (?) — owned by AgentHubWorkbench's modal.
   - composer send/newline/mention — component-level (textarea keydown).
   - Ctrl+T / Ctrl+` — the old quick-open menu claimed these; Web browsers
     reserve Ctrl+T (new tab), so the claims were removed from the menu
     (#1822).

   Bindings are read via getResolvedShortcutGroups so user-customized
   keybindings (Settings ShortcutsPane) take effect — the old desktop
   dispatcher read the canonical table only, so custom bindings could never
   fire (#1822).
   ═══════════════════════════════════════════════════════════════════════ */

export interface UseWorkbenchGlobalShortcutsOptions {
  /** Open the global search dialog (Ctrl/⌘+K). */
  onSearch: () => void;
  /** Navigate to the settings page (Ctrl/⌘+,). */
  onOpenSettings: () => void;
  /** Toggle the conversation sidebar collapsed state (Ctrl/⌘+B). */
  onToggleSidebar: () => void;
  /** Toggle the right inspector collapsed state (Ctrl/⌘+J). */
  onToggleRunPanel: () => void;
  /** Quick-open the inspector files tab (Ctrl+P). */
  onQuickOpen: () => void;
}

export function useWorkbenchGlobalShortcuts(options: UseWorkbenchGlobalShortcutsOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (isEditableKeyboardTarget(e.target)) return;

      const resolved = getResolvedShortcutGroups().flatMap((group) => group.shortcuts);
      const bindingFor = (id: string): string[] | undefined =>
        resolved.find((shortcut) => shortcut.id === id)?.keys;

      const searchBinding = bindingFor('search');
      if (searchBinding && matchesShortcut(e, searchBinding)) {
        e.preventDefault();
        optionsRef.current.onSearch();
        return;
      }
      const settingsBinding = bindingFor('settings');
      if (settingsBinding && matchesShortcut(e, settingsBinding)) {
        e.preventDefault();
        optionsRef.current.onOpenSettings();
        return;
      }
      const sidebarBinding = bindingFor('toggle-sidebar');
      if (sidebarBinding && matchesShortcut(e, sidebarBinding)) {
        e.preventDefault();
        optionsRef.current.onToggleSidebar();
        return;
      }
      const runPanelBinding = bindingFor('toggle-run-panel');
      if (runPanelBinding && matchesShortcut(e, runPanelBinding)) {
        e.preventDefault();
        optionsRef.current.onToggleRunPanel();
        return;
      }

      // Inspector quick-open claim (not part of the canonical groups — it
      // belongs to the inspector's own quick-open menu): Ctrl+P opens the
      // Files tab.
      if (matchesShortcut(e, ['Ctrl/⌘', 'P'])) {
        e.preventDefault();
        optionsRef.current.onQuickOpen();
        return;
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);
}
