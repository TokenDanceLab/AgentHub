import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Textarea } from './Textarea';

describe('Textarea', () => {
  it('renders a textarea with placeholder and value', () => {
    render(<Textarea value="hi" onChange={() => {}} placeholder="Notes" />);
    expect(screen.getByPlaceholderText('Notes')).toHaveValue('hi');
  });

  it('exposes aria-invalid when invalid', () => {
    render(<Textarea invalid aria-label="Notes" />);
    expect(screen.getByLabelText('Notes')).toHaveAttribute('aria-invalid', 'true');
  });

  it('supports typing', async () => {
    const user = userEvent.setup();
    let value = '';
    render(<Textarea aria-label="Notes" onChange={(e) => { value = e.target.value; }} />);
    await user.type(screen.getByLabelText('Notes'), 'abc');
    expect(value).toBe('abc');
  });

  it('applies size/mono classes and class name merge', () => {
    const { container } = render(<Textarea size="sm" mono className="extra" />);
    const el = container.querySelector('textarea')!;
    expect(el.className).toContain('sm');
    expect(el.className).toContain('mono');
    expect(el.className).toContain('extra');
  });
});
