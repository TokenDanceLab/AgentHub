import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ProgressBar } from './ProgressBar';

describe('ProgressBar', () => {
  it('renders with correct aria attributes', () => {
    const { container } = render(<ProgressBar value={75} />);
    const bar = container.querySelector('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('75');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('clamps value to 0-100', () => {
    const { container: c1 } = render(<ProgressBar value={150} />);
    expect(c1.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('100');

    const { container: c2 } = render(<ProgressBar value={-10} />);
    expect(c2.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('0');
  });

  it('shows label when provided', () => {
    const { container } = render(<ProgressBar value={50} label="Half done" />);
    expect(container.textContent).toContain('Half done');
  });

  it('shows paused styling', () => {
    const { container } = render(<ProgressBar value={30} paused />);
    expect(container.querySelector('[role="progressbar"]')!.className).toContain('paused');
  });
});
