import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from './Input';
import { FormField } from './FormField';

describe('Input', () => {
  it('renders a text input with placeholder and value', () => {
    render(<Input value="hub" onChange={() => {}} placeholder="URL" />);
    const input = screen.getByPlaceholderText('URL') as HTMLInputElement;
    expect(input.value).toBe('hub');
  });

  it('exposes aria-invalid when invalid', () => {
    render(<Input invalid aria-label="Field" />);
    expect(screen.getByLabelText('Field')).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not set aria-invalid when valid', () => {
    render(<Input aria-label="Field" />);
    expect(screen.getByLabelText('Field')).not.toHaveAttribute('aria-invalid');
  });

  it('applies size and mono classes', () => {
    const { container } = render(<Input size="sm" mono />);
    expect(container.querySelector('input')!.className).toContain('sm');
    expect(container.querySelector('input')!.className).toContain('mono');
  });

  it('merges className and forwards ref', () => {
    const ref = { current: null as HTMLInputElement | null };
    const { container } = render(<Input ref={ref} className="extra" />);
    expect(container.querySelector('input')!.className).toContain('extra');
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it('fires change events', async () => {
    const user = userEvent.setup();
    let value = '';
    render(<Input aria-label="Field" onChange={(e) => { value = e.target.value; }} />);
    await user.type(screen.getByLabelText('Field'), 'x');
    expect(value).toBe('x');
  });

  it('accepts a label binding from FormField', () => {
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    expect(screen.getByLabelText('Name')).toBeInstanceOf(HTMLInputElement);
  });
});
