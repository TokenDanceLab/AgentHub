import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecoveryPanel } from './RecoveryPanel';

describe('RecoveryPanel', () => {
  it('renders recovery copy and meta', () => {
    render(
      <RecoveryPanel
        icon={<span>!</span>}
        eyebrow="Workflow recovery"
        title="Threads could not sync"
        description="Retry after the API is ready."
        meta="Last attempt 09:00"
        primaryAction={{ label: 'Retry', onClick: vi.fn() }}
      />,
    );

    expect(screen.getByRole('alert', { name: 'Threads could not sync' })).toBeInTheDocument();
    expect(screen.getByText('Workflow recovery')).toBeInTheDocument();
    expect(screen.getByText('Retry after the API is ready.')).toBeInTheDocument();
    expect(screen.getByText('Last attempt 09:00')).toBeInTheDocument();
  });

  it('fires primary and secondary actions', () => {
    const onRetry = vi.fn();
    const onAccount = vi.fn();
    render(
      <RecoveryPanel
        icon={<span>!</span>}
        title="Runs could not sync"
        description="Retry before approving."
        primaryAction={{ label: 'Retry', onClick: onRetry }}
        secondaryAction={{ label: 'Account', onClick: onAccount }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onAccount).toHaveBeenCalledTimes(1);
  });

  it('shows the busy label and disables the busy action', () => {
    render(
      <RecoveryPanel
        icon={<span>!</span>}
        title="Timeline recovery"
        description="Retry timeline sync."
        primaryAction={{ label: 'Retry', busyLabel: 'Retrying', busy: true, onClick: vi.fn() }}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retrying' })).toBeDisabled();
  });

  it('accepts mobile class overrides', () => {
    const { container } = render(
      <RecoveryPanel
        icon={<span>!</span>}
        title="Mobile recovery"
        description="Retry from a phone."
        className="mobileRecoveryPanel"
        actionClassName="mobileActionButton"
        primaryAction={{ label: 'Retry', onClick: vi.fn() }}
      />,
    );

    expect(container.firstElementChild?.className).toContain('mobileRecoveryPanel');
    expect(screen.getByRole('button', { name: 'Retry' }).className).toContain('mobileActionButton');
  });
});
