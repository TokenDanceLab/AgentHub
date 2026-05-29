import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActivityCard } from './ActivityCard';

describe('ActivityCard', () => {
  it('renders typed activity content', () => {
    render(
      <ActivityCard label="Approval" meta="09:22" icon={<span>check</span>}>
        Waiting for mobile approval.
      </ActivityCard>,
    );

    expect(screen.getByText('Approval')).toBeInTheDocument();
    expect(screen.getByText('09:22')).toBeInTheDocument();
    expect(screen.getByText('Waiting for mobile approval.')).toBeInTheDocument();
  });

  it('accepts mobile class overrides', () => {
    render(
      <ActivityCard
        className="mobileActivityCard"
        iconClassName="mobileActivityIcon"
        bodyClassName="mobileActivityBody"
        metaClassName="mobileActivityMeta"
        label="Diff"
        icon={<span>diff</span>}
      >
        3 files changed
      </ActivityCard>,
    );

    const card = screen.getByText('Diff').closest('article');

    expect(card).toHaveClass('mobileActivityCard');
    expect(card?.querySelector('.mobileActivityIcon')).toHaveTextContent('diff');
  });
});
