import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { useComposerCore } from '@/hooks/useComposerCore';

describe('useComposerCore', () => {
  describe('canSend', () => {
    it('allows sending by default', () => {
      const { result } = renderHook(() => useComposerCore());
      expect(result.current.canSend).toBe(true);
    });

    it('blocks sending when disabled', () => {
      const { result } = renderHook(() => useComposerCore({ disabled: true }));
      expect(result.current.canSend).toBe(false);
    });

    it('blocks sending when streaming', () => {
      const { result } = renderHook(() => useComposerCore({ isStreaming: true }));
      expect(result.current.canSend).toBe(false);
    });

    it('blocks sending when starting', () => {
      const { result } = renderHook(() => useComposerCore({ isStarting: true }));
      expect(result.current.canSend).toBe(false);
    });

    it('blocks sending when multiple states are true', () => {
      const { result } = renderHook(() => useComposerCore({ disabled: true, isStreaming: true }));
      expect(result.current.canSend).toBe(false);
    });
  });

  describe('trimForSend', () => {
    it('returns trimmed text when canSend is true', () => {
      const { result } = renderHook(() => useComposerCore());
      expect(result.current.trimForSend('  hello  ')).toBe('hello');
    });

    it('returns null for whitespace-only text', () => {
      const { result } = renderHook(() => useComposerCore());
      expect(result.current.trimForSend('   ')).toBeNull();
    });

    it('returns null for empty text', () => {
      const { result } = renderHook(() => useComposerCore());
      expect(result.current.trimForSend('')).toBeNull();
    });

    it('returns null when disabled', () => {
      const { result } = renderHook(() => useComposerCore({ disabled: true }));
      expect(result.current.trimForSend('hello')).toBeNull();
    });

    it('returns null when streaming', () => {
      const { result } = renderHook(() => useComposerCore({ isStreaming: true }));
      expect(result.current.trimForSend('hello')).toBeNull();
    });

    it('returns null when starting', () => {
      const { result } = renderHook(() => useComposerCore({ isStarting: true }));
      expect(result.current.trimForSend('hello')).toBeNull();
    });
  });

  describe('handleEnterKey', () => {
    it('calls sendAction on Enter without Shift', () => {
      const { result } = renderHook(() => useComposerCore());
      const sendAction = vi.fn();
      const e = { key: 'Enter', shiftKey: false, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;

      const handled = result.current.handleEnterKey(e, sendAction);

      expect(handled).toBe(true);
      expect(sendAction).toHaveBeenCalledOnce();
    });

    it('does not call sendAction on Shift+Enter', () => {
      const { result } = renderHook(() => useComposerCore());
      const sendAction = vi.fn();
      const e = { key: 'Enter', shiftKey: true, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;

      const handled = result.current.handleEnterKey(e, sendAction);

      expect(handled).toBe(false);
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('does not call sendAction for non-Enter keys', () => {
      const { result } = renderHook(() => useComposerCore());
      const sendAction = vi.fn();
      const e = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() } as unknown as React.KeyboardEvent;

      const handled = result.current.handleEnterKey(e, sendAction);

      expect(handled).toBe(false);
      expect(sendAction).not.toHaveBeenCalled();
    });

    it('prevents default on Enter', () => {
      const { result } = renderHook(() => useComposerCore());
      const preventDefault = vi.fn();
      const e = { key: 'Enter', shiftKey: false, preventDefault } as unknown as React.KeyboardEvent;

      result.current.handleEnterKey(e, vi.fn());

      expect(preventDefault).toHaveBeenCalledOnce();
    });
  });

  describe('autoResize', () => {
    it('sets textarea height to scrollHeight', () => {
      const { result } = renderHook(() => useComposerCore());
      const textarea = document.createElement('textarea');
      Object.defineProperty(textarea, 'scrollHeight', { value: 120 });
      vi.spyOn(textarea.style, 'height', 'set');

      result.current.autoResize(textarea);

      expect(textarea.style.height).toBe('120px');
    });
  });

  describe('clearTextarea', () => {
    it('clears value and resets height', () => {
      const { result } = renderHook(() => useComposerCore());
      const textarea = document.createElement('textarea');
      textarea.value = 'some text';

      result.current.clearTextarea(textarea);

      expect(textarea.value).toBe('');
      expect(textarea.style.height).toBe('auto');
    });
  });
});
