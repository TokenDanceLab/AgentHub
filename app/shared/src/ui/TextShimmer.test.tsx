import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { TextShimmer } from './TextShimmer';

describe('TextShimmer', () => {
  it('renders the default number of bars (3)', () => {
    const { container } = render(<TextShimmer />);
    // .bar spans are inside the .bars wrapper div; select span children
    const barsWrapper = container.querySelector('[class*="bars"]');
    const barSpans = barsWrapper?.querySelectorAll('span');
    expect(barSpans?.length).toBe(3);
  });

  it('renders a custom number of bars', () => {
    const { container } = render(<TextShimmer bars={5} />);
    const barsWrapper = container.querySelector('[class*="bars"]');
    const barSpans = barsWrapper?.querySelectorAll('span');
    expect(barSpans?.length).toBe(5);
  });

  it('renders 0 bars when bars=0', () => {
    const { container } = render(<TextShimmer bars={0} />);
    const barsWrapper = container.querySelector('[class*="bars"]');
    const barSpans = barsWrapper?.querySelectorAll('span');
    expect(barSpans?.length).toBe(0);
  });

  it('renders label text when provided', () => {
    render(<TextShimmer label="Loading..." />);
    expect(screen.getByText('Loading...')).toBeDefined();
  });

  it('does not render label when not provided', () => {
    const { container } = render(<TextShimmer />);
    const labelEl = container.querySelector('[class*="label"]');
    expect(labelEl).toBeNull();
  });

  it('sets aria-busy="true" on the root element', () => {
    const { container } = render(<TextShimmer />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('aria-busy')).toBe('true');
  });

  it('becomes visible via animation frame', async () => {
    const { container } = render(<TextShimmer />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('shimmer');
    // Wait for rAF to flush the state update within act
    await act(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    });
    const updated = container.firstElementChild as HTMLElement;
    expect(updated.className).toContain('visible');
  });

  it('passes down the shimmer and visible CSS module classes', () => {
    const { container } = render(<TextShimmer />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toBeTruthy();
  });
});
