import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip } from './Tooltip';

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders role=tooltip and links trigger via aria-describedby when open', () => {
    render(
      <Tooltip label="Help text">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    // Closed initially: tooltip not in the DOM.
    expect(screen.queryByRole('tooltip')).toBeNull();

    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);

    const tooltip = screen.getByRole('tooltip');
    expect(tooltip).toBeDefined();
    expect(tooltip.textContent).toBe('Help text');

    const describedBy = trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(describedBy).toContain(tooltip.id);
  });

  it('shows on hover after the 500ms delay', () => {
    render(
      <Tooltip label="Hover me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.mouseEnter(trigger);
    // Before the 500ms delay: still hidden.
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    // After the delay: visible.
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('shows on focus immediately (no delay)', () => {
    render(
      <Tooltip label="Focus me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(trigger);
    // Focus shows synchronously — no timer advance needed.
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('hides on Escape key', () => {
    render(
      <Tooltip label="Dismiss me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeDefined();

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides on blur', () => {
    render(
      <Tooltip label="Blur me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.focus(trigger);
    expect(screen.getByRole('tooltip')).toBeDefined();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hides on mouse leave', () => {
    render(
      <Tooltip label="Leave me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.mouseEnter(trigger);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByRole('tooltip')).toBeDefined();

    fireEvent.mouseLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('honors a custom delayMs', () => {
    render(
      <Tooltip label="Custom delay" delayMs={200}>
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });
    fireEvent.mouseEnter(trigger);

    act(() => {
      vi.advanceTimersByTime(199);
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toBeDefined();
  });

  it('clears pending show timer on unmount without throwing', () => {
    const { unmount } = render(
      <Tooltip label="Unmount me">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Trigger' }));
    // Partial advance — timer is still pending.
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(() => unmount()).not.toThrow();
  });

  it('preserves existing trigger handlers (merge, not overwrite)', () => {
    const onMouseEnter = vi.fn();
    const onFocus = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <Tooltip label="Merge">
        <button
          type="button"
          onMouseEnter={onMouseEnter}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
        >
          Trigger
        </button>
      </Tooltip>,
    );
    const trigger = screen.getByRole('button', { name: 'Trigger' });

    fireEvent.mouseEnter(trigger);
    expect(onMouseEnter).toHaveBeenCalledTimes(1);

    fireEvent.focus(trigger);
    expect(onFocus).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    // Tooltip should also have dismissed.
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('renders nothing for the tooltip when closed (no dangling element)', () => {
    render(
      <Tooltip label="Hidden">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  // TODO(reduced-motion): jsdom does not honor prefers-reduced-motion, so the
  // CSS animation gating cannot be asserted here — verify on a real browser.
  // TODO(viewport-flip): first version does not flip the tooltip when it would
  // overflow the viewport (no portal/IntersectionObserver); add later.
  // TODO(real-positioning): jsdom has no layout, so absolute side positioning
  // cannot be measured — verify visually in the desktop shell.
});
