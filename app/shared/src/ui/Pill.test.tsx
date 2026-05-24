import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Pill } from './Pill';

describe('Pill', () => {
  it('renders text', () => {
    const { container } = render(<Pill>Active</Pill>);
    expect(container.textContent).toContain('Active');
  });

  it('applies color variants', () => {
    const { container } = render(<Pill variant="green">Done</Pill>);
    expect(container.firstElementChild!.className).toContain('green');
  });

  it('defaults to default variant', () => {
    const { container } = render(<Pill>Default</Pill>);
    expect(container.firstElementChild!.className).toContain('default');
  });

  it('accepts className', () => {
    const { container } = render(<Pill className="extra">Tag</Pill>);
    expect(container.firstElementChild!.className).toContain('extra');
  });
});
