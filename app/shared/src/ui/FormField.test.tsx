import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FormField } from './FormField';
import { Input } from './Input';

describe('FormField', () => {
  it('binds the label to the control auto-id', () => {
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toBeTruthy();
  });

  it('honors an explicit control id', () => {
    render(
      <FormField label="Name">
        <Input id="my-input" />
      </FormField>,
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute('id', 'my-input');
  });

  it('wires aria-invalid + aria-describedby when error is present', () => {
    render(
      <FormField label="Name" error="Name is required">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const errorId = input.getAttribute('aria-describedby');
    expect(errorId).toBeTruthy();
    const errorEl = screen.getByText('Name is required');
    expect(errorEl.id).toBe(errorId);
  });

  it('shows the hint and links it when there is no error', () => {
    render(
      <FormField label="Name" hint="Max 40 chars">
        <Input />
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    const hintId = input.getAttribute('aria-describedby');
    expect(hintId).toBeTruthy();
    expect(screen.getByText('Max 40 chars').id).toBe(hintId);
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('hides the hint while an error is shown', () => {
    render(
      <FormField label="Name" hint="Max 40 chars" error="Too long">
        <Input />
      </FormField>,
    );
    expect(screen.queryByText('Max 40 chars')).toBeNull();
    expect(screen.getByText('Too long')).toBeInTheDocument();
  });

  it('merges its own error wiring with an existing invalid flag', () => {
    render(
      <FormField label="Name" error="Required">
        <Input invalid />
      </FormField>,
    );
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders a hidden required marker when required', () => {
    render(
      <FormField label="Name" required>
        <Input />
      </FormField>,
    );
    const star = screen.getByText('*');
    expect(star).toHaveAttribute('aria-hidden', 'true');
  });

  it('keeps the control interactive', async () => {
    const user = userEvent.setup();
    render(
      <FormField label="Name">
        <Input />
      </FormField>,
    );
    await user.type(screen.getByLabelText('Name'), 'alice');
    expect(screen.getByLabelText('Name')).toHaveValue('alice');
  });
});
