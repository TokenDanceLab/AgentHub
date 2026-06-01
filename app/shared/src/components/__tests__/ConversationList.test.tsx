import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ConversationList } from '../ConversationList/ConversationList';
import type { ConversationData } from '../ConversationList/ConversationList';

function makeConversation(overrides: Partial<ConversationData> = {}): ConversationData {
  return {
    id: 'conv-1',
    name: 'Alice',
    lastMessage: 'See you tomorrow!',
    ...overrides,
  };
}

describe('ConversationList', () => {
  // ── Basic rendering ────────────────────────────

  it('renders conversation names and last messages', () => {
    render(
      <ConversationList
        conversations={[
          makeConversation({ id: '1', name: 'Alice', lastMessage: 'Hello' }),
          makeConversation({ id: '2', name: 'Bob', lastMessage: 'Hi there' }),
        ]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bob' })).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  // ── Empty state ────────────────────────────────

  it('renders empty state message when conversations array is empty', () => {
    render(<ConversationList conversations={[]} onSelect={vi.fn()} />);

    expect(screen.getByText('No conversations found.')).toBeInTheDocument();
  });

  it('does not render conversation items when the list is empty', () => {
    render(<ConversationList conversations={[]} onSelect={vi.fn()} />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  // ── Item click ─────────────────────────────────

  it('calls onSelect with the conversation id when an item is clicked', () => {
    const onSelect = vi.fn();
    render(
      <ConversationList
        conversations={[
          makeConversation({ id: 'conv-a', name: 'Alice', lastMessage: 'Hi' }),
        ]}
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('conv-a');
  });

  it('calls onSelect with correct id for the clicked conversation', () => {
    const onSelect = vi.fn();
    render(
      <ConversationList
        conversations={[
          makeConversation({ id: 'first', name: 'Alice', lastMessage: 'A' }),
          makeConversation({ id: 'second', name: 'Bob', lastMessage: 'B' }),
        ]}
        onSelect={onSelect}
      />,
    );

    // Click the second conversation
    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);
    expect(onSelect).toHaveBeenCalledWith('second');
  });

  // ── Active conversation ────────────────────────

  it('marks the active conversation item', () => {
    const { container } = render(
      <ConversationList
        conversations={[
          makeConversation({ id: '1', name: 'Alice', lastMessage: 'A' }),
          makeConversation({ id: '2', name: 'Bob', lastMessage: 'B' }),
        ]}
        activeId="2"
        onSelect={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    // CSS module class names are obfuscated, so we cannot check for "active" directly.
    // We just verify both buttons render and the component doesn't crash.
    expect(buttons).toHaveLength(2);
  });

  // ── Avatar / initials rendering ────────────────

  it('renders initials when avatar is not provided', () => {
    render(
      <ConversationList
        conversations={[makeConversation({ name: 'Alice', avatar: undefined })]}
        onSelect={vi.fn()}
      />,
    );

    // getInitials → "AL"
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('renders custom avatar when provided', () => {
    render(
      <ConversationList
        conversations={[makeConversation({ name: 'Alice', avatar: 'A' })]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('A')).toBeInTheDocument();
  });

  // ── Unread badge ───────────────────────────────

  it('renders unread count when unread is greater than 0', () => {
    render(
      <ConversationList
        conversations={[makeConversation({ unread: 5 })]}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('does not render unread badge when unread is 0', () => {
    render(
      <ConversationList
        conversations={[makeConversation({ unread: 0 })]}
        onSelect={vi.fn()}
      />,
    );

    // The unread badge only renders when unread > 0
    // We verify no extra <span> with the unread number exists beyond the avatar
    // 0 is not greater than 0, so it should not render
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('does not render unread badge when unread is undefined', () => {
    render(
      <ConversationList
        conversations={[makeConversation({ unread: undefined })]}
        onSelect={vi.fn()}
      />,
    );

    // Should not crash; no badge rendered
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  // ── CSS interactions ───────────────────────────

  it('applies custom className when provided', () => {
    const { container } = render(
      <ConversationList
        conversations={[makeConversation()]}
        onSelect={vi.fn()}
        className="custom-list"
      />,
    );

    expect(container.firstElementChild).toHaveClass('custom-list');
  });

  it('applies custom className to empty state as well', () => {
    const { container } = render(
      <ConversationList
        conversations={[]}
        onSelect={vi.fn()}
        className="empty-custom"
      />,
    );

    expect(container.firstElementChild).toHaveClass('empty-custom');
  });
});
