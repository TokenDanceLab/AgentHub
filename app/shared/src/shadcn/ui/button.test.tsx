import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';

describe('shadcn Button (vendored)', () => {
  it('renders its label and the default variant classes', () => {
    render(<Button>Send</Button>);

    const button = screen.getByRole('button', { name: 'Send' });
    expect(button).toBeInTheDocument();
    expect(button.className).toContain('bg-primary');
    expect(button.className).toContain('rounded-md');
  });

  it('applies a caller className through cn()', () => {
    render(
      <Button variant="outline" className="mt-2">
        Cancel
      </Button>,
    );

    const button = screen.getByRole('button', { name: 'Cancel' });
    expect(button.className).toContain('border');
    expect(button.className).toContain('mt-2');
  });
});
