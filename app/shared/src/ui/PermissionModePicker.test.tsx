import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PermissionModePicker } from './PermissionModePicker';
import type { PermissionModeOption } from './PermissionModePicker';

const DEFAULT_OPTIONS: PermissionModeOption[] = [
  { value: 'default', label: 'Default' },
  { value: 'acceptEdits', label: 'Accept Edits' },
  { value: 'plan', label: 'Plan Mode' },
  { value: 'bypassPermissions', label: 'Bypass' },
];

describe('PermissionModePicker', () => {
  it('renders trigger button with label text', () => {
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Permissions')).toBeDefined();
  });

  it('trigger button has type="button"', () => {
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.type).toBe('button');
  });

  it('trigger button sets aria-expanded to false when closed', () => {
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens popover on trigger click and sets aria-expanded to true', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders all options in popover when open', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button'));
    for (const opt of DEFAULT_OPTIONS) {
      expect(screen.getByText(opt.label)).toBeDefined();
    }
  });

  it('calls onChange with option value when an option is clicked', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('Accept Edits'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('acceptEdits');
  });

  it('closes popover after option selection', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button');
    await user.click(trigger);
    await user.click(screen.getByText('Plan Mode'));
    // After selection, the popover should close
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes popover on Escape key', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const trigger = screen.getByRole('button');
    await user.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('does not open when disabled', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
        disabled={true}
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.hasAttribute('disabled')).toBe(true);
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('toggles closed when trigger is clicked while open', async () => {
    const user = userEvent.setup();
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    await user.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('closes popover when clicking outside', async () => {
    render(
      <div>
        <div data-testid="picker">
          <PermissionModePicker
            value="default"
            label="Permissions"
            options={DEFAULT_OPTIONS}
            onChange={vi.fn()}
          />
        </div>
        <div data-testid="outside" style={{ width: 100, height: 100 }} />
      </div>,
    );
    const trigger = screen.getByText('Permissions');
    fireEvent.click(trigger);
    // Popover should be open now
    expect(screen.getByText('Permissions').closest('button')!.getAttribute('aria-expanded')).toBe('true');
    // Click outside on the outside div via mousedown (how the component listens)
    fireEvent.mouseDown(screen.getByTestId('outside'));
    // After mousedown outside, the event listener should close the popover
    expect(screen.getByText('Permissions').closest('button')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('applies className to root element', () => {
    const { container } = render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
        className="custom-root"
      />,
    );
    expect(container.firstElementChild?.className).toContain('custom-root');
  });

  it('applies triggerClassName to trigger button', () => {
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
        triggerClassName="custom-trigger"
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('custom-trigger');
  });

  it('uses ariaLabel on trigger button', () => {
    render(
      <PermissionModePicker
        value="default"
        label="Permissions"
        options={DEFAULT_OPTIONS}
        onChange={vi.fn()}
        ariaLabel="Select permission mode"
      />,
    );
    const btn = screen.getByRole('button');
    expect(btn.getAttribute('aria-label')).toBe('Select permission mode');
  });
});
