import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useToastStore, type ToastItem } from '../toastStore';

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('addToast appends a toast and returns its id', () => {
    const id = useToastStore.getState().addToast({ type: 'success', message: 'Saved' });
    expect(id).toMatch(/^toast-/);
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.type).toBe('success');
    expect(toast?.message).toBe('Saved');
  });

  it('addToast keeps at most 5 toasts', () => {
    const { addToast } = useToastStore.getState();
    for (let i = 0; i < 7; i++) {
      addToast({ type: 'info', message: `msg ${i}` });
    }
    expect(useToastStore.getState().toasts).toHaveLength(5);
    expect(useToastStore.getState().toasts[4]?.message).toBe('msg 6');
  });

  it('addToast preserves duration and action', () => {
    const action = { label: 'Undo', onClick: vi.fn() };
    const id = useToastStore
      .getState()
      .addToast({ type: 'warning', message: 'Careful', duration: 1000, action });
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.duration).toBe(1000);
    expect(toast?.action?.label).toBe('Undo');
  });

  it('addToast auto-dismisses after the duration', () => {
    useToastStore.getState().addToast({ type: 'info', message: 'Auto', duration: 500 });
    vi.advanceTimersByTime(499);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(useToastStore.getState().toasts[0]?.exiting).toBe(true);
    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('addToast with duration 0 never auto-dismisses', () => {
    useToastStore.getState().addToast({ type: 'error', message: 'Sticky', duration: 0 });
    vi.advanceTimersByTime(100_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('showToast builds a toast from type + message + options', () => {
    const id = useToastStore
      .getState()
      .showToast('error', 'Boom', { duration: 200, action: { label: 'Retry', onClick: vi.fn() } });
    const toast = useToastStore.getState().toasts.find((t) => t.id === id);
    expect(toast?.type).toBe('error');
    expect(toast?.message).toBe('Boom');
    expect(toast?.duration).toBe(200);
    expect(toast?.action?.label).toBe('Retry');
  });

  it('dismissToast marks exiting then removes after the animation', () => {
    const id = useToastStore.getState().addToast({ type: 'info', message: 'Bye' });
    useToastStore.getState().dismissToast(id);
    expect(useToastStore.getState().toasts.find((t) => t.id === id)?.exiting).toBe(true);
    vi.advanceTimersByTime(300);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast removes immediately without the exit animation', () => {
    const id = useToastStore.getState().addToast({ type: 'info', message: 'Gone' });
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it('removeToast on an unknown id is a no-op', () => {
    useToastStore.getState().addToast({ type: 'info', message: 'Keep me' });
    useToastStore.getState().removeToast('toast-999');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('dismissToast on an unknown id is a no-op', () => {
    useToastStore.getState().addToast({ type: 'info', message: 'Still here' });
    useToastStore.getState().dismissToast('toast-999');
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it('does not mutate previous toast items when adding', () => {
    const before = useToastStore.getState().toasts as ToastItem[];
    useToastStore.getState().addToast({ type: 'info', message: 'Immutable' });
    const after = useToastStore.getState().toasts;
    expect(after[0]).not.toBe(before[0]);
  });
});
