import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('renders a native checkbox exposed to a11y queries', () => {
    render(<Checkbox aria-label="Subscribe" checked={false} onChange={() => {}} />);
    const box = screen.getByRole('checkbox', { name: 'Subscribe' });
    expect(box).toBeInstanceOf(HTMLInputElement);
  });

  it('toggles via click and reports the next value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="Subscribe" checked={false} onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Subscribe' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('associates a label text with the control', () => {
    render(<Checkbox label="Accept terms" checked onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeChecked();
  });

  it('exposes aria-invalid when invalid', () => {
    render(<Checkbox invalid aria-label="Terms" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('checkbox', { name: 'Terms' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not toggle when disabled via a real label click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox label="Locked" disabled checked onChange={onChange} />);
    await user.click(screen.getByRole('checkbox', { name: 'Locked' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
