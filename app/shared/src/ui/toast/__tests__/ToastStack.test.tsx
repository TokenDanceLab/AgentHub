import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ToastContainer } from '../ToastStack';
import { useToastStore } from '../toastStore';

// Helper to add a toast and return its ID
function addToast(type: 'success' | 'error' | 'warning' | 'info', message: string) {
  return useToastStore.getState().addToast({ type, message });
}

// Clear all toasts between tests
beforeEach(() => {
  act(() => {
    useToastStore.setState({ toasts: [] });
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  // ── Rendering variants ──────────────────────────
  it('renders a success toast with check icon', () => {
    act(() => { addToast('success', 'Operation succeeded'); });
    render(<ToastContainer />);
    expect(screen.getByText('Operation succeeded')).toBeInTheDocument();
    expect(
      screen.getByText('Operation succeeded').closest('[aria-live="polite"]'),
    ).not.toBeNull();
  });

  it('renders an error toast', () => {
    act(() => { addToast('error', 'Something went wrong'); });
    render(<ToastContainer />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders a warning toast', () => {
    act(() => { addToast('warning', 'Proceed with caution'); });
    render(<ToastContainer />);
    expect(screen.getByText('Proceed with caution')).toBeInTheDocument();
  });

  it('renders an info toast', () => {
    act(() => { addToast('info', 'For your information'); });
    render(<ToastContainer />);
    expect(screen.getByText('For your information')).toBeInTheDocument();
  });

  // ── Accessibility ───────────────────────────────
  it('sets aria-live="polite" on the container', () => {
    act(() => { addToast('info', 'Accessible toast'); });
    render(<ToastContainer />);
    expect(screen.getByLabelText('Notifications')).toHaveAttribute('aria-live', 'polite');
  });

  it.each([
    ['success', 'polite'],
    ['info', 'polite'],
    ['error', 'assertive'],
    ['warning', 'assertive'],
  ] as const)('announces %s toasts with aria-live="%s"', (type, expected) => {
    act(() => { addToast(type, `${type} announcement`); });
    render(<ToastContainer />);
    const toast = screen.getByText(`${type} announcement`).closest('[aria-live]')!;
    expect(toast).toHaveAttribute('aria-live', expected);
  });

  it('uses one live region per toast', () => {
    act(() => {
      addToast('info', 'Polite toast');
      addToast('error', 'Assertive toast');
    });
    render(<ToastContainer />);
    expect(
      screen.getByText('Polite toast').closest('[aria-live="polite"]'),
    ).not.toBeNull();
    expect(
      screen.getByText('Assertive toast').closest('[aria-live="assertive"]'),
    ).not.toBeNull();
  });

  // ── Hover/focus pause ───────────────────────────
  it('pauses auto-dismiss while hovered and resumes on mouse leave', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().addToast({ type: 'info', message: 'Hover me', duration: 4000 });
    });
    render(<ToastContainer />);
    const toast = screen.getByText('Hover me').closest('[aria-live]')!;

    // 1s in, hover pauses the countdown.
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.mouseEnter(toast);

    // Hovering far past the original duration must not dismiss it.
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Hover me')).toBeInTheDocument();

    // Resuming continues from the remaining ~3s.
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(2999); });
    expect(screen.getByText('Hover me')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByText('Hover me')).not.toBeInTheDocument();
  });

  it('pauses auto-dismiss while focused and resumes on blur', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().addToast({ type: 'info', message: 'Focus me', duration: 4000 });
    });
    render(<ToastContainer />);

    act(() => { vi.advanceTimersByTime(1000); });
    const closeBtn = screen.getByLabelText('Close notification');
    fireEvent.focus(closeBtn);

    act(() => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByText('Focus me')).toBeInTheDocument();

    fireEvent.blur(closeBtn);
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByText('Focus me')).not.toBeInTheDocument();
  });

  it('still auto-dismisses after pause and resume cycles', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().addToast({ type: 'warning', message: 'Pulse', duration: 2000 });
    });
    render(<ToastContainer />);
    const toast = screen.getByText('Pulse').closest('[aria-live]')!;

    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(1000); });
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText('Pulse')).toBeInTheDocument();
    fireEvent.mouseLeave(toast);
    // Remaining ~1s elapses → exit animation → removal.
    act(() => { vi.advanceTimersByTime(1000); });
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByText('Pulse')).not.toBeInTheDocument();
  });

  // ── Manual close ────────────────────────────────
  it('dismisses a toast when close button is clicked', () => {
    vi.useFakeTimers();
    act(() => { addToast('info', 'Close me'); });
    render(<ToastContainer />);
    expect(screen.getByText('Close me')).toBeInTheDocument();

    const closeBtn = screen.getByLabelText('Close notification');
    fireEvent.click(closeBtn);

    // After exit animation fires, toast should be gone
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByText('Close me')).not.toBeInTheDocument();
  });

  // ── Auto-dismiss ────────────────────────────────
  it('auto-dismisses after default duration (4s)', () => {
    vi.useFakeTimers();
    act(() => { addToast('info', 'Auto dismiss'); });
    render(<ToastContainer />);
    expect(screen.getByText('Auto dismiss')).toBeInTheDocument();

    // Advance past duration + exit animation
    act(() => { vi.advanceTimersByTime(4300); });
    expect(screen.queryByText('Auto dismiss')).not.toBeInTheDocument();
  });

  it('respects custom duration', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().addToast({ type: 'info', message: 'Custom duration', duration: 1000 });
    });
    render(<ToastContainer />);
    expect(screen.getByText('Custom duration')).toBeInTheDocument();

    // Not yet dismissed at 800ms
    act(() => { vi.advanceTimersByTime(800); });
    expect(screen.getByText('Custom duration')).toBeInTheDocument();

    // Dismissed at 1300ms (1s + 300ms exit animation)
    act(() => { vi.advanceTimersByTime(500); });
    expect(screen.queryByText('Custom duration')).not.toBeInTheDocument();
  });

  // ── Multiple toasts stacking ────────────────────
  it('renders multiple toasts simultaneously', () => {
    act(() => {
      addToast('success', 'Toast 1');
      addToast('error', 'Toast 2');
      addToast('warning', 'Toast 3');
    });
    render(<ToastContainer />);
    expect(screen.getByText('Toast 1')).toBeInTheDocument();
    expect(screen.getByText('Toast 2')).toBeInTheDocument();
    expect(screen.getByText('Toast 3')).toBeInTheDocument();
  });

  it('caps visible toasts at 5, dropping oldest', () => {
    act(() => {
      for (let i = 1; i <= 7; i++) {
        addToast('info', `Toast ${i}`);
      }
    });
    render(<ToastContainer />);
    // First two should be dropped
    expect(screen.queryByText('Toast 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Toast 2')).not.toBeInTheDocument();
    // Last five should be visible
    expect(screen.getByText('Toast 3')).toBeInTheDocument();
    expect(screen.getByText('Toast 4')).toBeInTheDocument();
    expect(screen.getByText('Toast 5')).toBeInTheDocument();
    expect(screen.getByText('Toast 6')).toBeInTheDocument();
    expect(screen.getByText('Toast 7')).toBeInTheDocument();
  });

  // ── Empty state ─────────────────────────────────
  it('renders nothing when there are no toasts', () => {
    const { container } = render(<ToastContainer />);
    expect(container.firstChild).toBeNull();
  });

  // ── Animation state ─────────────────────────────
  it('removes toast after exit animation on dismiss', () => {
    vi.useFakeTimers();
    act(() => {
      useToastStore.getState().addToast({ type: 'info', message: 'Exiting', duration: 2000 });
    });
    render(<ToastContainer />);

    // Advance to trigger exit animation
    act(() => { vi.advanceTimersByTime(2050); });
    // After exit animation, toast should be removed
    act(() => { vi.advanceTimersByTime(350); });
    expect(screen.queryByText('Exiting')).not.toBeInTheDocument();
  });
});
