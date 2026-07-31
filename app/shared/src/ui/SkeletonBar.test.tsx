import React from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SkeletonBar } from './SkeletonBar';

function barClass(container: HTMLElement, index: number): string {
  return container.querySelectorAll('span')[index]?.className ?? '';
}

describe('SkeletonBar', () => {
  it('renders a single line bar by default with busy/aria-hidden semantics', () => {
    const { container } = render(<SkeletonBar />);

    expect(container.firstElementChild).toHaveAttribute('aria-busy', 'true');
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('span')).toHaveLength(1);
    expect(barClass(container, 0)).toContain('line');
  });

  it('renders the requested number of bars with the gap', () => {
    const { container } = render(<SkeletonBar lines={3} gap="8px" />);

    expect(container.querySelectorAll('span')).toHaveLength(3);
    expect(container.firstElementChild).toHaveStyle({ gap: '8px' });
  });

  it('adds the circle variant class for avatar placeholders', () => {
    const { container } = render(<SkeletonBar variant="circle" width="34px" height="34px" />);

    expect(barClass(container, 0)).toContain('circle');
    expect(barClass(container, 0)).toContain('line');
  });

  it('defaults a bare circle to a square driven by its height', () => {
    const { container } = render(<SkeletonBar variant="circle" height="34px" />);

    expect(container.querySelector('span')).toHaveStyle({ width: '34px', height: '34px' });
  });

  it('keeps an explicitly supplied width on circles', () => {
    const { container } = render(<SkeletonBar variant="circle" width="48px" height="34px" />);

    expect(container.querySelector('span')).toHaveStyle({ width: '48px', height: '34px' });
  });

  it('adds the block variant class for card placeholders', () => {
    const { container } = render(<SkeletonBar variant="block" width="100%" height="120px" />);

    expect(barClass(container, 0)).toContain('block');
    expect(barClass(container, 0)).toContain('line');
  });
});
