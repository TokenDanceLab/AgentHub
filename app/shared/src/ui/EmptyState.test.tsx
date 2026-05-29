import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './EmptyState';

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

  it('allows mobile title level and external classes', () => {
    const { container } = render(
      <EmptyState title="Mobile empty" titleLevel={1} className="mobileEmptyView" actionClassName="mobileEmptyAction" />,
    );

    expect(screen.getByRole('heading', { level: 1, name: 'Mobile empty' })).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('mobileEmptyView');
  });
});
