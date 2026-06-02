import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SectionHeader } from './SectionHeader';

describe('SectionHeader', () => {
  it('renders eyebrow and title', () => {
    render(<SectionHeader eyebrow="Queue" title="Threads overview" />);

    expect(screen.getByText('Queue')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Threads overview' })).toBeInTheDocument();
  });

  it('renders an action button', () => {
    const onClick = vi.fn();
    render(
      <SectionHeader
        title="Runs overview"
        action={{ ariaLabel: 'Refresh runs', icon: <span>refresh</span>, onClick, busy: true }}
      />,
    );

    const button = screen.getByRole('button', { name: 'Refresh runs' });
    expect(button).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts mobile class overrides', () => {
    render(
      <SectionHeader
        eyebrow="Runs"
        title="Queue overview"
        className="mobileOverviewTitleRow"
        eyebrowClassName="mobileEyebrow"
        actionClassName="mobileIconButton"
        action={{ ariaLabel: 'Refresh', icon: <span>refresh</span> }}
      />,
    );

    expect(screen.getByText('Runs')).toHaveClass('mobileEyebrow');
    expect(screen.getByRole('button', { name: 'Refresh' })).toHaveClass('mobileIconButton');
  });
});
