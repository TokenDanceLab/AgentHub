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

  it('renders leading content and actions', () => {
    render(
      <ActivityCard
        className="mobileRunBlock"
        leading="1"
        leadingClassName="mobileRunBlockIndex"
        icon={<span>file</span>}
        iconClassName="mobileRunBlockIcon"
        bodyClassName="mobileRunBlockBody"
        actionsClassName="mobileResourceActions"
        label="Artifact"
        actions={<button type="button">Copy</button>}
      >
        dist/report.html
      </ActivityCard>,
    );

    const card = screen.getByText('Artifact').closest('article');

    expect(card?.querySelector('.mobileRunBlockIndex')).toHaveTextContent('1');
    expect(card?.querySelector('.mobileRunBlockIcon')).toHaveTextContent('file');
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('supports body and trailing state rows without an icon column', () => {
    render(
      <ActivityCard
        className="mobileSurfaceRegistryRow"
        bodyClassName="mobileSurfaceRegistryBody"
        actionsClassName="mobileSurfaceRegistryActions"
        label="Account"
        actions={<span className="mobileSurfaceRegistryState">Ready</span>}
      >
        TokenDance ID session surface
      </ActivityCard>,
    );

    const card = screen.getByText('Account').closest('article');

    expect(card).toHaveAttribute('data-has-actions', 'true');
    expect(card).not.toHaveAttribute('data-has-icon');
    expect(card?.querySelector('.mobileSurfaceRegistryState')).toHaveTextContent('Ready');
  });
});
