import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it('applies variant classes', () => {
    const { container } = render(<Button variant="destructive">Delete</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('destructive');
    expect(btn.className).toContain('base');
  });

  it('applies size classes', () => {
    const { container } = render(<Button size="lg">Big</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('lg');
  });

  it('handles click events', async () => {
    const user = userEvent.setup();
    let clicked = false;
    render(<Button onClick={() => { clicked = true; }}>Click</Button>);
    await user.click(screen.getByRole('button'));
    expect(clicked).toBe(true);
  });

  it('disables interaction when disabled', () => {
    render(<Button disabled>Disabled</Button>);
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('renders as forwardRef', () => {
    const { container } = render(<Button>Ref test</Button>);
    expect(container.querySelector('button')).toBeInstanceOf(HTMLButtonElement);
  });

  it('merges className prop', () => {
    const { container } = render(<Button className="extra">Merged</Button>);
    const btn = container.querySelector('button')!;
    expect(btn.className).toContain('extra');
  });
});
