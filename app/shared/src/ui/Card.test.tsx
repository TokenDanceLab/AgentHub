import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Card, CardHeader, CardContent, CardFooter } from './Card';

describe('Card', () => {
  it('renders children', () => {
    const { container } = render(<Card>Hello</Card>);
    expect(container.textContent).toContain('Hello');
  });

  it('renders with glass variant', () => {
    const { container } = render(<Card variant="glass">Glass card</Card>);
    expect(container.firstElementChild!.className).toContain('glass');
  });

  it('renders with elevated variant', () => {
    const { container } = render(<Card variant="elevated">Elevated</Card>);
    expect(container.firstElementChild!.className).toContain('elevated');
  });

  it('renders header, content, footer', () => {
    const { container } = render(
      <Card>
        <CardHeader>Title</CardHeader>
        <CardContent>Body</CardContent>
        <CardFooter>Actions</CardFooter>
      </Card>,
    );
    expect(container.textContent).toContain('Title');
    expect(container.textContent).toContain('Body');
    expect(container.textContent).toContain('Actions');
  });

  it('accepts className on CardHeader', () => {
    const { container } = render(<CardHeader className="custom">H</CardHeader>);
    expect(container.firstElementChild!.className).toContain('custom');
  });
});
