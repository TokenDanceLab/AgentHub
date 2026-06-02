import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SelectableRow } from './SelectableRow';

describe('SelectableRow', () => {
  it('renders selectable title, meta and actions without nesting action buttons', () => {
    render(
      <SelectableRow
        title="Web design convergence"
        meta="just now · 4 messages"
        icon={<span>icon</span>}
        actions={<button type="button">Rename</button>}
        ariaLabel="Open Web design convergence"
      />,
    );

    expect(screen.getByRole('button', { name: 'Open Web design convergence' })).toBeInTheDocument();
    expect(screen.getByText('just now · 4 messages')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('fires onSelect from the main row button', () => {
    const onSelect = vi.fn();

    render(
      <SelectableRow
        title="Mobile handoff evidence"
        selected
        ariaLabel="Open Mobile handoff evidence"
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole('button', { name: 'Open Mobile handoff evidence' });
    fireEvent.click(button);

    expect(button).toHaveAttribute('aria-current', 'true');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('supports disabled selectable rows', () => {
    const onSelect = vi.fn();

    render(
      <SelectableRow
        title="Claude Code"
        disabled
        ariaLabel="Claude Code"
        onSelect={onSelect}
      />,
    );

    const button = screen.getByRole('button', { name: 'Claude Code' });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('accepts consuming app class overrides', () => {
    render(
      <SelectableRow
        className="threadRow"
        buttonClassName="threadButton"
        selectedClassName="selected"
        iconClassName="threadIcon"
        bodyClassName="threadBody"
        titleClassName="threadTitle"
        metaClassName="threadMeta"
        actionsClassName="threadActions"
        title="Thread"
        meta="1h ago"
        icon={<span>icon</span>}
        actions={<span>Actions</span>}
        ariaLabel="Open thread"
        selected
      />,
    );

    expect(screen.getByRole('button', { name: 'Open thread' }).closest('.threadRow')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open thread' })).toHaveClass('threadButton', 'selected');
    expect(screen.getByText('Thread')).toHaveClass('threadTitle');
    expect(screen.getByText('1h ago')).toHaveClass('threadMeta');
    expect(screen.getByText('Actions').parentElement).toHaveClass('threadActions');
  });
});
