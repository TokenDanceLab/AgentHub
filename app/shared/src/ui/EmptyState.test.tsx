import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_STATE_KINDS, EmptyState, resolveEmptyStateCopy, type EmptyStateCopyMatrix } from './EmptyState';

describe('EmptyState', () => {
  it('renders title, description, and icon', () => {
    render(<EmptyState title="No thread" description="Pick a thread first" icon={<span>icon</span>} />);

    expect(screen.getByRole('heading', { name: 'No thread' })).toBeInTheDocument();
    expect(screen.getByText('Pick a thread first')).toBeInTheDocument();
    expect(screen.getByText('icon')).toBeInTheDocument();
  });

  it('fires the primary action', () => {
    const onClick = vi.fn();
    render(<EmptyState title="No thread" action={{ label: 'Browse threads', onClick }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Browse threads' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders suggestion chips', () => {
    render(
      <EmptyState
        title="Prompt"
        suggestions={[
          { label: 'Explain code', onClick: vi.fn() },
          { label: 'Fix bugs', onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Explain code' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fix bugs' })).toBeInTheDocument();
  });

  it('fires suggestion chip click', () => {
    const onExplain = vi.fn();
    const onFix = vi.fn();
    render(
      <EmptyState
        title="Prompt"
        suggestions={[
          { label: 'Explain code', onClick: onExplain },
          { label: 'Fix bugs', onClick: onFix },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Fix bugs' }));

    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onExplain).not.toHaveBeenCalled();
  });

  it('allows mobile title level and external classes', () => {
    const { container } = render(
      <EmptyState title="Mobile empty" titleLevel={1} className="mobileEmptyView" actionClassName="mobileEmptyAction" />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Mobile empty' })).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('mobileEmptyView');
  });

  it('renders shortcut badge on action', () => {
    render(
      <EmptyState
        title="Threads"
        action={{ label: 'New Thread', onClick: vi.fn(), shortcut: 'Ctrl+N' }}
      />,
    );

    const btn = screen.getByRole('button', { name: /New Thread/ });
    expect(btn).toBeInTheDocument();
    expect(btn.querySelector('kbd')).toBeInTheDocument();
    expect(btn.querySelector('kbd')?.textContent).toBe('Ctrl+N');
  });

  it.each(EMPTY_STATE_KINDS)('exposes the %s state to behavior and visual gates', (kind) => {
    render(<EmptyState kind={kind} title={`${kind} title`} description={`${kind} guidance`} />);

    const state = screen.getByLabelText(`${kind} title`);
    expect(state).toHaveAttribute('data-empty-kind', kind);
    expect(state).toHaveAttribute('role', kind === 'error' ? 'alert' : 'region');
  });

  it('selects scenario copy from a complete translation-ready matrix', () => {
    const matrix: EmptyStateCopyMatrix = {
      blank: { title: 'No agents yet', description: 'Install an agent to get started.' },
      search: { title: 'No search results', description: 'Try another keyword.' },
      filter: { title: 'No filtered results', description: 'Clear one or more filters.' },
      error: { title: 'Agents unavailable', description: 'Retry loading agents.' },
      noPermission: { title: 'No permission', description: 'Contact admin for access.' },
    };

    expect(resolveEmptyStateCopy(matrix, 'filter')).toEqual(matrix.filter);
    expect(resolveEmptyStateCopy(matrix, 'noPermission')).toEqual(matrix.noPermission);
  });
});
