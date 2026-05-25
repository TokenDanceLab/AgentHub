import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Avatar } from './Avatar';

describe('Avatar', () => {
  it('renders initials', () => {
    const { container } = render(<Avatar initials="AB" />);
    expect(container.textContent).toBe('AB');
  });

  it('truncates to 2 chars', () => {
    const { container } = render(<Avatar initials="HelloWorld" />);
    expect(container.textContent).toBe('HE');
  });

  it('uppercases initials', () => {
    const { container } = render(<Avatar initials="ab" />);
    expect(container.textContent).toBe('AB');
  });

  it('applies size classes', () => {
    const { container } = render(<Avatar initials="X" size="lg" />);
    expect(container.firstElementChild!.className).toContain('lg');
  });

  it('applies brand variant', () => {
    const { container } = render(<Avatar initials="AH" variant="brand" />);
    expect(container.firstElementChild!.className).toContain('brand');
  });

  it('is aria-hidden', () => {
    const { container } = render(<Avatar initials="X" />);
    expect(container.firstElementChild!.getAttribute('aria-hidden')).toBe('true');
  });
});
