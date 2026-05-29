import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MetricGrid } from './MetricGrid';

describe('MetricGrid', () => {
  it('renders read-only metric tiles', () => {
    render(
      <MetricGrid
        items={[
          { id: 'active', value: 2, label: 'Active' },
          { id: 'archived', value: 1, label: 'Archived' },
          { id: 'hub', value: 'OK', label: 'Hub' },
        ]}
      />,
    );

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Archived')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renders interactive metric tiles', () => {
    const onClick = vi.fn();
    render(
      <MetricGrid
        items={[
          { id: 'review', value: 'Review', label: 'Review', onClick, ariaLabel: 'Jump to review' },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Jump to review' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts mobile class overrides', () => {
    render(
      <MetricGrid
        className="mobileMetricGrid"
        itemClassName="mobileMetricTile"
        interactiveItemClassName="mobileSummaryShortcut"
        items={[
          { id: 'review', value: 'Review', label: 'Review', onClick: vi.fn() },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Review Review' }).closest('div')).toHaveClass('mobileMetricGrid');
    expect(screen.getByRole('button', { name: 'Review Review' })).toHaveClass('mobileSummaryShortcut');
  });
});
