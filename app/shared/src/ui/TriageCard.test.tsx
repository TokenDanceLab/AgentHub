import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TriageCard } from './TriageCard';

describe('TriageCard', () => {
  it('renders eyebrow, title and meta', () => {
    render(
      <TriageCard
        eyebrow="Continue handoff"
        title="Review approval copy on mobile"
        meta="May 27"
        ariaLabel="Continue handoff Review approval copy on mobile"
      />,
    );

    expect(screen.getByRole('button', { name: 'Continue handoff Review approval copy on mobile' })).toBeInTheDocument();
    expect(screen.getByText('Continue handoff')).toBeInTheDocument();
    expect(screen.getByText('May 27')).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(
      <TriageCard
        eyebrow="Next review"
        title="Run run_mobi"
        ariaLabel="Open run review"
        onClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open run review' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts mobile class overrides', () => {
    render(
      <TriageCard
        eyebrow="Next review"
        title="Run run_mobi"
        className="mobileRunTriageCard"
        iconClassName="mobileRunTriageIcon"
        bodyClassName="mobileRunTriageBody"
        actionClassName="mobileRunTriageAction"
        icon={<span>icon</span>}
        actionIcon={<span>arrow</span>}
        ariaLabel="Open mobile triage"
      />,
    );

    expect(screen.getByRole('button', { name: 'Open mobile triage' })).toHaveClass('mobileRunTriageCard');
    expect(screen.getByText('icon').parentElement).toHaveClass('mobileRunTriageIcon');
    expect(screen.getByText('arrow').parentElement).toHaveClass('mobileRunTriageAction');
  });
});
