import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MessageBubble } from './MessageBubble';

describe('MessageBubble', () => {
  it('renders author, timestamp, content and actions', () => {
    render(
      <MessageBubble author="User" timestamp="09:20" actions={<button type="button">Copy</button>}>
        Keep Web and Mobile aligned.
      </MessageBubble>,
    );

    expect(screen.getByText('User')).toBeInTheDocument();
    expect(screen.getByText('09:20')).toBeInTheDocument();
    expect(screen.getByText('Keep Web and Mobile aligned.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('accepts consuming app class overrides and end alignment', () => {
    render(
      <MessageBubble
        className="mobileMessageRow"
        bubbleClassName="mobileUserMsg"
        metaClassName="mobileMessageMeta"
        contentClassName="mobileMessageContent"
        actionsClassName="mobileMessageActions"
        author="User"
        timestamp="Sent"
        align="end"
        actions={<span>Action</span>}
      >
        Reply
      </MessageBubble>,
    );

    const row = screen.getByText('Reply').closest('article');
    expect(row).toHaveClass('mobileMessageRow');
    expect(row).toHaveAttribute('data-align', 'end');
    expect(screen.getByText('Reply').parentElement).toHaveClass('mobileUserMsg');
    expect(screen.getByText('Action').parentElement).toHaveClass('mobileMessageActions');
  });
});
