import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useSearchStore } from '@/stores/searchStore';
import { useGlobalKeyboardShortcuts } from './useGlobalKeyboardShortcuts';

describe('useGlobalKeyboardShortcuts', () => {
  beforeEach(() => {
    useSearchStore.setState({ open: false, query: '', results: [], selectedIndex: 0 });
  });

  it('opens search outside editable elements and ignores typed input', () => {
    renderHook(() => useGlobalKeyboardShortcuts());
    const input = document.createElement('input');
    document.body.appendChild(input);

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'k' }));
    });
    expect(useSearchStore.getState().open).toBe(false);

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'k' }));
    });
    expect(useSearchStore.getState().open).toBe(true);
    input.remove();
  });

  it('dispatches settings navigation and ignores unrelated shortcuts', () => {
    const events: Event[] = [];
    const listener = (event: Event) => events.push(event);
    window.addEventListener('agenthub:navigate', listener);
    renderHook(() => useGlobalKeyboardShortcuts());

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: ',' }));
      document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'x' }));
    });

    expect(events).toHaveLength(1);
    expect((events[0] as CustomEvent).detail).toEqual({ page: 'settings' });
    window.removeEventListener('agenthub:navigate', listener);
  });
});
