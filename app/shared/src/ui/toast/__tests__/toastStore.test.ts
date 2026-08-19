import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore, type ToastItem } from '../toastStore';
// real_tested=true

const EXIT_ANIMATION_MS = 300;
const DEFAULT_DURATION_MS = 4000;

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('addToast', () => {
    it('appends a toast with type and message and returns its id', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'success', message: 'Saved' });
      expect(id).toMatch(/^toast-\d+$/);
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.type).toBe('success');
      expect(toast?.message).toBe('Saved');
    });

    it('generates a unique id for every toast', () => {
      const first = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'one' });
      const second = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'two' });
      expect(second).not.toBe(first);
      expect(useToastStore.getState().toasts).toHaveLength(2);
    });

    it('accepts an empty message', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: '' });
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.message).toBe('');
    });

    it('uses the default duration when duration is omitted', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Default' });
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.duration).toBeUndefined();
      expect(toast?.action).toBeUndefined();

      vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('preserves a provided duration and action', () => {
      const action = { label: 'Undo', onClick: vi.fn() };
      const id = useToastStore.getState().addToast({
        type: 'warning',
        message: 'Careful',
        duration: 1500,
        action,
      });
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.duration).toBe(1500);
      expect(toast?.action).toBe(action);
      expect(toast?.action?.label).toBe('Undo');
    });

    it('auto-dismisses after the provided duration', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Auto', duration: 500 });
      vi.advanceTimersByTime(499);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS - 1);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('never auto-dismisses when duration is 0', () => {
      useToastStore
        .getState()
        .addToast({ type: 'error', message: 'Sticky', duration: 0 });
      vi.advanceTimersByTime(100_000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0]?.exiting).toBeUndefined();
    });

    it('never auto-dismisses when duration is negative', () => {
      const id = useToastStore.getState().addToast({
        type: 'error',
        message: 'Negative',
        duration: -100,
      });
      vi.advanceTimersByTime(100_000);
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.duration).toBe(-100);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('keeps at most 5 toasts and drops the oldest', () => {
      const { addToast } = useToastStore.getState();
      for (let i = 0; i < 7; i++) {
        addToast({ type: 'info', message: `msg ${i}` });
      }
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(5);
      expect(toasts[0]?.message).toBe('msg 2');
      expect(toasts[4]?.message).toBe('msg 6');
    });

    it('keeps exactly 5 toasts when the cap is not exceeded', () => {
      const { addToast } = useToastStore.getState();
      for (let i = 0; i < 5; i++) {
        addToast({ type: 'info', message: `msg ${i}` });
      }
      const toasts = useToastStore.getState().toasts;
      expect(toasts).toHaveLength(5);
      expect(toasts[0]?.message).toBe('msg 0');
      expect(toasts[4]?.message).toBe('msg 4');
    });

    it('does not mutate previously stored toast items', () => {
      useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Immutable' });
      const before = useToastStore.getState().toasts as ToastItem[];
      const beforeFirst = before[0];
      useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Second' });
      const after = useToastStore.getState().toasts;
      expect(after).not.toBe(before);
      // Existing items are reused by reference but never modified.
      expect(after[0]).toBe(beforeFirst);
      expect(beforeFirst?.message).toBe('Immutable');
      expect(beforeFirst?.exiting).toBeUndefined();
      expect(after[1]?.message).toBe('Second');
    });
  });

  describe('showToast', () => {
    it('builds a toast from type, message and options', () => {
      const action = { label: 'Retry', onClick: vi.fn() };
      const id = useToastStore
        .getState()
        .showToast('error', 'Boom', { duration: 200, action });
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      expect(toast?.type).toBe('error');
      expect(toast?.message).toBe('Boom');
      expect(toast?.duration).toBe(200);
      expect(toast?.action).toBe(action);
    });

    it('works without options and uses the default duration', () => {
      const id = useToastStore
        .getState()
        .showToast('warning', 'No options');
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.duration,
      ).toBeUndefined();
      vi.advanceTimersByTime(DEFAULT_DURATION_MS - 1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
    });
  });

  describe('dismissToast', () => {
    it('marks the toast exiting and removes it after the exit animation', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Bye' });
      useToastStore.getState().dismissToast(id);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS - 1);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      vi.advanceTimersByTime(1);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('clears a pending auto-dismiss timer so the toast is not double-expired', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Timed', duration: 2000 });
      useToastStore.getState().dismissToast(id);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(0);
      vi.advanceTimersByTime(10_000);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('is a no-op for an unknown id', () => {
      useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Still here' });
      useToastStore.getState().dismissToast('toast-unknown');
      expect(useToastStore.getState().toasts).toHaveLength(1);
      expect(useToastStore.getState().toasts[0]?.exiting).toBeUndefined();
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('removeToast', () => {
    it('removes the toast immediately without the exit animation', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Gone' });
      useToastStore.getState().removeToast(id);
      expect(useToastStore.getState().toasts).toHaveLength(0);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('clears a pending auto-dismiss timer', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Gone', duration: 100 });
      useToastStore.getState().removeToast(id);
      vi.advanceTimersByTime(10_000);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('is a no-op for an unknown id', () => {
      useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Keep me' });
      useToastStore.getState().removeToast('toast-unknown');
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });
  });

  describe('pauseAutoDismiss / resumeAutoDismiss', () => {
    it('pauses the auto-dismiss clock and resume continues where it left off', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Pausable', duration: 1000 });
      vi.advanceTimersByTime(400);
      useToastStore.getState().pauseAutoDismiss(id);

      vi.advanceTimersByTime(10_000);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();

      useToastStore.getState().resumeAutoDismiss(id);
      vi.advanceTimersByTime(599);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('is idempotent when called twice', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Double pause', duration: 1000 });
      useToastStore.getState().pauseAutoDismiss(id);
      useToastStore.getState().pauseAutoDismiss(id);
      vi.advanceTimersByTime(10_000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
      useToastStore.getState().resumeAutoDismiss(id);
      vi.advanceTimersByTime(999);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
    });

    it('pause is a no-op for an unknown id', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Untouched', duration: 100 });
      useToastStore.getState().pauseAutoDismiss('toast-unknown');
      vi.advanceTimersByTime(99);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
    });

    it('pause is a no-op for a toast without a timer (duration 0)', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Sticky', duration: 0 });
      useToastStore.getState().pauseAutoDismiss(id);
      useToastStore.getState().resumeAutoDismiss(id);
      vi.advanceTimersByTime(100_000);
      expect(useToastStore.getState().toasts).toHaveLength(1);
    });

    it('resume is a no-op for an unknown id', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Untouched', duration: 100 });
      useToastStore.getState().resumeAutoDismiss('toast-unknown');
      vi.advanceTimersByTime(100);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
    });

    it('resume while a timer is already active does not double-schedule', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Active', duration: 1000 });
      useToastStore.getState().resumeAutoDismiss(id);
      vi.advanceTimersByTime(999);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });

    it('resume after pause preserves the remaining time', () => {
      const id = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Remaining', duration: 1000 });
      vi.advanceTimersByTime(900);
      useToastStore.getState().pauseAutoDismiss(id);
      useToastStore.getState().resumeAutoDismiss(id);
      vi.advanceTimersByTime(99);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(1);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === id)?.exiting,
      ).toBe(true);
    });
  });

  describe('multiple toasts', () => {
    it('auto-dismisses one toast without affecting others', () => {
      const first = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'First', duration: 500 });
      const second = useToastStore
        .getState()
        .addToast({ type: 'error', message: 'Second', duration: 0 });
      vi.advanceTimersByTime(500);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === first)?.exiting,
      ).toBe(true);
      expect(
        useToastStore.getState().toasts.find((t) => t.id === second)?.exiting,
      ).toBeUndefined();
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([
        second,
      ]);
    });

    it('dismisses only the targeted toast', () => {
      const first = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'First', duration: 0 });
      const second = useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Second', duration: 0 });
      useToastStore.getState().dismissToast(first);
      vi.advanceTimersByTime(EXIT_ANIMATION_MS);
      expect(useToastStore.getState().toasts.map((t) => t.id)).toEqual([
        second,
      ]);
    });
  });

  describe('store integration', () => {
    it('supports selector subscriptions via subscribeWithSelector', () => {
      const lengths: number[] = [];
      const unsubscribe = useToastStore.subscribe(
        (state) => state.toasts.length,
        (length) => lengths.push(length),
      );
      useToastStore
        .getState()
        .addToast({ type: 'info', message: 'Sub' });
      expect(lengths).toEqual([1]);
      const id = useToastStore.getState().toasts[0]?.id ?? 'missing';
      useToastStore.getState().removeToast(id);
      expect(lengths).toEqual([1, 0]);
      unsubscribe();
    });

    it('stores the action callback so the UI can invoke it', () => {
      const onClick = vi.fn();
      const id = useToastStore.getState().addToast({
        type: 'info',
        message: 'Action',
        action: { label: 'Go', onClick },
      });
      const toast = useToastStore.getState().toasts.find((t) => t.id === id);
      toast?.action?.onClick();
      expect(onClick).toHaveBeenCalledTimes(1);
    });
  });
});
