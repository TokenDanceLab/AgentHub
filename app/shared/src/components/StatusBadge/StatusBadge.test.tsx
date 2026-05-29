import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { getStatusVariantClassName, StatusBadge } from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the default shared status label', () => {
    render(<StatusBadge status="running" />);

    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  it('allows localized labels from consuming apps', () => {
    render(<StatusBadge status="review" label="待审批" />);

    expect(screen.getByText('待审批')).toBeInTheDocument();
  });

  it('keeps stable variant class suffixes for app-level styling', () => {
    expect(getStatusVariantClassName('in progress')).toBe('in-progress');
    expect(getStatusVariantClassName('online')).toBe('online');
  });
});
