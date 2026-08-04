import React from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { Tooltip, type TooltipSide } from './Tooltip';

// jsdom has no layout, so viewport flipping is exercised with mocked
// geometry (same pattern as the reduced-motion CSS-contract check below:
// pure-CSS positioning cannot be measured in jsdom).
const tooltipCss = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'Tooltip.module.css'),
  'utf8',
);

const EMPTY_RECT: DOMRect = {
  x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0,
  toJSON: () => ({}),
};

function rect(x: number, y: number, width: number, height: number): DOMRect {
  return {
    x, y, top: y, bottom: y + height, left: x, right: x + width, width, height,
    toJSON: () => ({}),
  };
}

/** Mock layout so the host sits at the bottom-right corner of the viewport
 *  (top=500, bottom=520, left=590, right=690):
 *  - a bottom tooltip (100px tall) overflows a 500px-tall viewport: 520+8+100 > 500
 *  - a right tooltip (200px wide) overflows a 600px-wide viewport: 690+9+200 > 600
 *  - the same geometry fits a 1024x768 viewport, so "no flip" cases stay sane. */
function mockOverflowingGeometry(): void {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(
    function mockGetRect(this: Element) {
      if (this.matches('[role="tooltip"]')) return rect(0, 0, 200, 100);
      // The host span contains the tooltip as a descendant (aria-describedby
      // lives on the cloned trigger, not on the host).
      if (this.querySelector('[role="tooltip"]') !== null) return rect(590, 500, 100, 20);
      return EMPTY_RECT;
    },
  );
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
}

function openTooltip(label: string, side?: TooltipSide): HTMLElement {
  render(
    <Tooltip label={label} side={side}>
      <button type="button">Trigger</button>
    </Tooltip>,
  );
  fireEvent.focus(screen.getByRole('button', { name: 'Trigger' }));
  return screen.getByRole('tooltip');
}

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setViewport(1024, 768);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setViewport(1024, 768);
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
});

// ── Viewport flipping (#1507) ─────────────────────────────────────────
describe('Tooltip viewport flip (#1507)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setViewport(1024, 768);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    setViewport(1024, 768);
  });

  it('flips a bottom tooltip to top when it would overflow the viewport', () => {
    mockOverflowingGeometry();
    setViewport(1024, 500);
    const tooltip = openTooltip('Flip me', 'bottom');
    // host.bottom(520) + 8 + tooltip.height(100) > 500 → flip to top
    expect(tooltip.getAttribute('data-side')).toBe('top');
  });

  it('flips a right tooltip to left when it would overflow the viewport', () => {
    mockOverflowingGeometry();
    setViewport(600, 768);
    const tooltip = openTooltip('Flip me', 'right');
    // host.right(690) + 9 + tooltip.width(200) > 600 → flip to left
    expect(tooltip.getAttribute('data-side')).toBe('left');
  });

  it('keeps the requested side when there is no overflow', () => {
    mockOverflowingGeometry();
    // Tall/wide enough viewport: 520+8+100 <= 768 and 690+9+200 <= 1024
    const tooltip = openTooltip('Stay put', 'bottom');
    expect(tooltip.getAttribute('data-side')).toBe('bottom');
  });

  it('re-measures on window resize and flips once the viewport shrinks', () => {
    mockOverflowingGeometry();
    setViewport(1024, 768);
    const tooltip = openTooltip('Shrink me', 'bottom');
    expect(tooltip.getAttribute('data-side')).toBe('bottom');

    setViewport(1024, 500);
    act(() => {
      fireEvent(window, new Event('resize'));
    });
    expect(tooltip.getAttribute('data-side')).toBe('top');
  });

  it('resets the flip when the requested side prop changes', () => {
    mockOverflowingGeometry();
    setViewport(600, 500);
    const { rerender } = render(
      <Tooltip label="Switch" side="right">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    fireEvent.focus(screen.getByRole('button', { name: 'Trigger' }));
    expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('left');

    // Switching to a side that fits (host top is 500; the top edge has room)…
    rerender(
      <Tooltip label="Switch" side="top">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    expect(screen.getByRole('tooltip').getAttribute('data-side')).toBe('top');
  });
});

// ── Reduced motion ────────────────────────────────────────────────────
describe('Tooltip reduced motion (#1507)', () => {
  it('gates the enter animation behind prefers-reduced-motion: no-preference', () => {
    // jsdom cannot evaluate media queries, so assert the CSS contract:
    // the animation must live inside the no-preference block only.
    expect(tooltipCss).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(tooltipCss).toMatch(/animation:\s*tooltipIn/);
  });
});
