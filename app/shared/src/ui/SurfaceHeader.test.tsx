import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SurfaceHeader } from './SurfaceHeader';

describe('SurfaceHeader', () => {
  it('renders eyebrow, title and status label', () => {
    render(
      <SurfaceHeader
        eyebrow="AgentHub"
        title="Runs"
        status={{ label: 'Connected', tone: 'online' }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Runs' })).toBeInTheDocument();
    expect(screen.getByText('AgentHub')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('accepts mobile class overrides', () => {
    render(
      <SurfaceHeader
        eyebrow="Queue"
        title="Threads"
        className="mobileHeader"
        eyebrowClassName="mobileEyebrow"
        statusClassName="mobileStatusBadge"
        statusDotClassName="mobileStatusDot"
        status={{ label: 'Reachable', tone: 'pending' }}
      />,
    );

    expect(screen.getByRole('banner')).toHaveClass('mobileHeader');
    expect(screen.getByText('Queue')).toHaveClass('mobileEyebrow');
    expect(screen.getByText('Reachable').parentElement).toHaveClass('mobileStatusBadge');
  });
});
