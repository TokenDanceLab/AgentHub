import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Radio } from './Radio';

describe('Radio', () => {
  it('renders a native radio exposed to a11y queries', () => {
    render(<Radio aria-label="Option A" name="g" value="a" checked onChange={() => {}} />);
    const radio = screen.getByRole('radio', { name: 'Option A' });
    expect(radio).toBeInstanceOf(HTMLInputElement);
    expect(radio).toBeChecked();
  });

  it('groups radios by name and reports the next value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <Radio aria-label="A" name="g" value="a" checked={false} onChange={onChange} />
        <Radio aria-label="B" name="g" value="b" checked onChange={onChange} />
      </div>,
    );
    expect(screen.getAllByRole('radio').length).toBe(2);
    await user.click(screen.getByRole('radio', { name: 'A' }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('associates a label text with the control', () => {
    render(<Radio label="First choice" name="g" value="1" checked onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'First choice' })).toBeChecked();
  });

  it('exposes aria-invalid when invalid', () => {
    render(<Radio invalid aria-label="A" name="g" value="a" checked={false} onChange={() => {}} />);
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('aria-invalid', 'true');
  });

  it('does not fire when disabled', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Radio label="Locked" name="g" value="a" checked={false} disabled onChange={onChange} />);
    await user.click(screen.getByRole('radio', { name: 'Locked' }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
