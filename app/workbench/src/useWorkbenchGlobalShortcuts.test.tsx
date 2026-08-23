import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWorkbenchGlobalShortcuts } from './useWorkbenchGlobalShortcuts';
import { resetKeybindings, saveCustomKeybindings } from '@shared/utils/keyboardShortcuts';

/* #1822: shared global dispatcher — every claim that stays in the canonical
   config must actually fire here. */

function fire(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  document.dispatchEvent(event);
  return event;
}

function editableTarget(): HTMLTextAreaElement {
  const textarea = document.createElement('textarea');
  document.body.appendChild(textarea);
  return textarea;
}

describe('useWorkbenchGlobalShortcuts', () => {
  const onSearch = vi.fn();
  const onOpenSettings = vi.fn();
  const onToggleSidebar = vi.fn();
  const onToggleRunPanel = vi.fn();
  const onQuickOpen = vi.fn();

  function renderDispatcher(): void {
    renderHook(() => useWorkbenchGlobalShortcuts({
      onSearch,
      onOpenSettings,
      onToggleSidebar,
      onToggleRunPanel,
      onQuickOpen,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetKeybindings();
    renderDispatcher();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    resetKeybindings();
  });

  it('fires search for Ctrl/⌘+K', () => {
    fire('k', { ctrlKey: true });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('fires settings for Ctrl/⌘+,', () => {
    fire(',', { ctrlKey: true });
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it('fires toggle-sidebar for Ctrl/⌘+B and toggle-run-panel for Ctrl/⌘+J', () => {
    fire('b', { ctrlKey: true });
    expect(onToggleSidebar).toHaveBeenCalledOnce();
    fire('j', { ctrlKey: true });
    expect(onToggleRunPanel).toHaveBeenCalledOnce();
  });

  it('fires quick-open for Ctrl/⌘+P', () => {
    fire('p', { ctrlKey: true });
    expect(onQuickOpen).toHaveBeenCalledOnce();
  });

  it('prevents the default for bound shortcuts', () => {
    const event = fire('b', { ctrlKey: true });
    expect(event.defaultPrevented).toBe(true);
  });

  it('never fires inside editable targets (composer not hijacked)', () => {
    const textarea = editableTarget();
    for (const key of ['k', ',', 'b', 'j', 'p']) {
      // Dispatch on the textarea itself so it bubbles with target=textarea.
      textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key, ctrlKey: true, bubbles: true, cancelable: true,
      }));
    }
    expect(onSearch).not.toHaveBeenCalled();
    expect(onOpenSettings).not.toHaveBeenCalled();
    expect(onToggleSidebar).not.toHaveBeenCalled();
    expect(onToggleRunPanel).not.toHaveBeenCalled();
    expect(onQuickOpen).not.toHaveBeenCalled();
    document.body.removeChild(textarea);
  });

  it('does not fire for unbound combos', () => {
    fire('k', { ctrlKey: false });
    fire('x', { ctrlKey: true });
    expect(onSearch).not.toHaveBeenCalled();
    expect(onQuickOpen).not.toHaveBeenCalled();
  });

  it('#1822: reads RESOLVED groups so custom keybindings take effect', () => {
    // Remap search to Ctrl+L — the canonical Ctrl+K must stop firing and
    // Ctrl+L must open the search dialog (dispatcher reads the resolved
    // binding, not the canonical table).
    saveCustomKeybindings([{ id: 'search', keys: ['Ctrl/⌘', 'L'] }]);

    const stale = fire('k', { ctrlKey: true });
    expect(stale.defaultPrevented).toBe(false);
    expect(onSearch).not.toHaveBeenCalled();

    fire('l', { ctrlKey: true });
    expect(onSearch).toHaveBeenCalledOnce();
  });

  it('#1822: custom settings binding fires instead of the canonical one', () => {
    saveCustomKeybindings([{ id: 'settings', keys: ['Ctrl/⌘', 'S'] }]);
    fire('s', { ctrlKey: true });
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });
});
