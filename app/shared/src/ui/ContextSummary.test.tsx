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

  it('renders optional icon, description, and actions', () => {
    render(
      <ContextSummary
        icon={<span>workspace</span>}
        eyebrow="Surface"
        title="Workspace"
        description="Desktop-style command surface"
        actions={<button type="button">Open messages</button>}
        items={[{ id: 'agents', label: 'Agents', value: 3 }]}
      />,
    );

    expect(screen.getByText('workspace')).toBeInTheDocument();
    expect(screen.getByText('Desktop-style command surface')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open messages' })).toBeInTheDocument();
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

  it('accepts web shell class overrides', () => {
    render(
      <ContextSummary
        className="routeContextPanel"
        headerClassName="routeContextHeader"
        iconClassName="routeContextIcon"
        listClassName="routeContextGrid"
        itemClassName="routeMetric"
        actionsClassName="routeActionRow"
        icon={<span>folder</span>}
        eyebrow="Route"
        title="Project"
        description="Route context"
        actions={<button type="button">Settings</button>}
        items={[{ id: 'threads', label: 'Threads', value: 2 }]}
      />,
    );

    const summary = screen.getByRole('heading', { name: 'Project' }).closest('section');

    expect(summary).toHaveClass('routeContextPanel');
    expect(summary?.querySelector('.routeContextIcon')).toHaveTextContent('folder');
    expect(screen.getByText('Threads').closest('dl')).toHaveClass('routeContextGrid');
  });
});
