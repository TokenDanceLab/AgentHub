import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';

describe('Switch', () => {
  it('exposes a switch role with aria-checked', () => {
    render(<Switch checked onChange={() => {}} aria-label="Dark mode" />);
    const sw = screen.getByRole('switch', { name: 'Dark mode' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('reports the next value on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="Dark mode" />);
    await user.click(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reports false when toggled off', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked onChange={onChange} aria-label="Dark mode" />);
    await user.click(screen.getByRole('switch', { name: 'Dark mode' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('does not fire when disabled (state stays visible)', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch checked disabled onChange={onChange} aria-label="Dark mode" />);
    const sw = screen.getByRole('switch', { name: 'Dark mode' });
    await user.click(sw);
    expect(onChange).not.toHaveBeenCalled();
    expect(sw).toBeDisabled();
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });
});
