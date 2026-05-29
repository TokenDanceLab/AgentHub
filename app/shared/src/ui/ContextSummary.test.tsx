import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ContextSummary } from './ContextSummary';

describe('ContextSummary', () => {
  it('renders heading and definition list items', () => {
    render(
      <ContextSummary
        eyebrow="Thread context"
        title="Review approval copy on mobile"
        items={[
          { id: 'status', label: 'Status', value: 'online' },
          { id: 'messages', label: 'Messages', value: 4 },
        ]}
      />,
    );

    expect(screen.getByText('Thread context')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Review approval copy on mobile' })).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('online')).toBeInTheDocument();
  });

  it('accepts mobile class overrides', () => {
    render(
      <ContextSummary
        className="mobileChatContextPanel"
        eyebrowClassName="mobileEyebrow"
        ariaLabel="Chat context"
        eyebrow="Context"
        title="Thread"
        items={[{ id: 'updated', label: 'Updated', value: 'May 27' }]}
      />,
    );

    expect(screen.getByLabelText('Chat context')).toHaveClass('mobileChatContextPanel');
    expect(screen.getByText('Context')).toHaveClass('mobileEyebrow');
  });
});
