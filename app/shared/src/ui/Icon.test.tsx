import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Icon } from './Icon';

describe('Icon', () => {
  it('renders the icon name as text content', () => {
    render(<Icon name="search" />);
    expect(screen.getByText('search')).toBeDefined();
  });

  it('applies default className when none provided', () => {
    const { container } = render(<Icon name="home" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.className).toBe('agenthub-icon');
  });

  it('accepts custom className', () => {
    const { container } = render(<Icon name="settings" className="my-custom-icon" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.className).toBe('my-custom-icon');
  });

  it('respects size prop for dimensions and font size', () => {
    const { container } = render(<Icon name="star" size={32} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.width).toBe('32px');
    expect(span.style.height).toBe('32px');
    expect(span.style.fontSize).toBe('32px');
  });

  it('defaults to size 20 when not specified', () => {
    const { container } = render(<Icon name="menu" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.width).toBe('20px');
    expect(span.style.height).toBe('20px');
  });

  it('renders with FILL=1 when filled prop is true', () => {
    const { container } = render(<Icon name="heart" filled={true} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.fontVariationSettings).toContain('"FILL" 1');
  });

  it('renders with FILL=0 when filled is false', () => {
    const { container } = render(<Icon name="heart" filled={false} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.fontVariationSettings).toContain('"FILL" 0');
  });

  it('defaults aria-hidden to true', () => {
    const { container } = render(<Icon name="close" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.getAttribute('aria-hidden')).toBe('true');
  });

  it('respects explicit aria-hidden prop', () => {
    const { container } = render(<Icon name="close" aria-hidden={false} />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.getAttribute('aria-hidden')).toBe('false');
  });

  it('renders with inline-flex display style', () => {
    const { container } = render(<Icon name="person" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.display).toBe('inline-flex');
  });

  it('renders Material Symbols font family', () => {
    const { container } = render(<Icon name="add" />);
    const span = container.firstElementChild as HTMLElement;
    expect(span.style.fontFamily).toContain('Material Symbols Outlined');
  });
});
