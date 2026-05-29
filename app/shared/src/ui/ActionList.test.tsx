import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionList } from './ActionList';

describe('ActionList', () => {
  it('renders item title, meta and trailing content', () => {
    render(
      <ActionList
        items={[
          {
            id: 'thread-1',
            title: 'Review approval copy',
            meta: ['agenthub-mobile', 'May 27'],
            trailing: <span>Online</span>,
            ariaLabel: 'Review approval copy on mobile',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Review approval copy on mobile' })).toBeInTheDocument();
    expect(screen.getByText('Online')).toBeInTheDocument();
  });

  it('fires item onClick', () => {
    const onClick = vi.fn();
    render(
      <ActionList
        items={[
          { id: 'run-1', title: 'Run run_mobi', onClick },
        ]}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Run run_mobi' }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('accepts mobile class overrides', () => {
    render(
      <ActionList
        className="mobileListStack"
        itemClassName="mobileThreadItem"
        iconClassName="mobileThreadIcon"
        bodyClassName="mobileListItemBody"
        titleClassName="mobileListItemTitle"
        metaStackClassName="mobileRunMetaStack"
        metaClassName="mobileListItemMeta"
        items={[
          {
            id: 'thread-2',
            title: 'Handoff notes',
            icon: <span>icon</span>,
            meta: ['agenthub-docs'],
            ariaLabel: 'Open handoff notes',
          },
        ]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Open handoff notes' }).closest('div')).toHaveClass('mobileListStack');
    expect(screen.getByRole('button', { name: 'Open handoff notes' })).toHaveClass('mobileThreadItem');
    expect(screen.getByText('Handoff notes')).toHaveClass('mobileListItemTitle');
  });
});
