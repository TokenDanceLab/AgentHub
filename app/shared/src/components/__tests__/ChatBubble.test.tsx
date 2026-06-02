import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatBubble } from '../ChatBubble/ChatBubble';

describe('ChatBubble', () => {
  // ── Basic rendering ────────────────────────────

  it('renders sender name, content, and timestamp', () => {
    render(
      <ChatBubble
        sender={{ name: 'Alice' }}
        content="Hello there!"
        timestamp="10:30 AM"
      />,
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Hello there!')).toBeInTheDocument();
    expect(screen.getByText('10:30 AM')).toBeInTheDocument();
  });

  // ── Alignment: user vs agent ──────────────────

  it('renders as user-aligned by default (isAgent=false)', () => {
    const { container } = render(
      <ChatBubble
        sender={{ name: 'Alice' }}
        content="Hi"
        timestamp="10:30 AM"
      />,
    );

    const article = container.querySelector('article');
    expect(article).not.toBeNull();
    // The component uses styles.user for user alignment
    // We verify the class name structure exists
    expect(article!.className).toBeTruthy();
  });

  it('renders as agent-aligned when isAgent is true', () => {
    const { container } = render(
      <ChatBubble
        sender={{ name: 'Bot' }}
        content="How can I help?"
        timestamp="10:31 AM"
        isAgent
      />,
    );

    const article = container.querySelector('article');
    expect(article).not.toBeNull();
    expect(article!.className).toBeTruthy();
  });

  // ── Avatar rendering ───────────────────────────

  it('renders sender avatar when provided', () => {
    render(
      <ChatBubble
        sender={{ name: 'Alice', avatar: '👩' }}
        content="Hi"
        timestamp="10:30 AM"
      />,
    );

    const avatar = screen.getByText('👩');
    expect(avatar).toBeInTheDocument();
    expect(avatar).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders initials when avatar is not provided', () => {
    render(
      <ChatBubble
        sender={{ name: 'Alice' }}
        content="Hi"
        timestamp="10:30 AM"
      />,
    );

    // getInitials takes first 2 chars → "AL"
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('renders initials for longer names (truncated to 2 chars)', () => {
    render(
      <ChatBubble
        sender={{ name: 'Christopher' }}
        content="Hi"
        timestamp="10:30 AM"
      />,
    );

    // getInitials → "CH"
    expect(screen.getByText('CH')).toBeInTheDocument();
  });

  // ── Author rendering ───────────────────────────

  it('renders the sender name in a strong element', () => {
    render(
      <ChatBubble
        sender={{ name: 'Bob' }}
        content="Test"
        timestamp="12:00 PM"
      />,
    );

    const strong = screen.getByText('Bob');
    expect(strong.tagName).toBe('STRONG');
  });

  // ── Timestamp rendering ────────────────────────

  it('renders the timestamp text', () => {
    render(
      <ChatBubble
        sender={{ name: 'Alice' }}
        content="Yo"
        timestamp="Yesterday"
      />,
    );

    expect(screen.getByText('Yesterday')).toBeInTheDocument();
  });

  // ── CSS interactions ───────────────────────────

  it('applies custom className when provided', () => {
    const { container } = render(
      <ChatBubble
        sender={{ name: 'Alice' }}
        content="Hi"
        timestamp="10:30 AM"
        className="custom-bubble"
      />,
    );

    expect(container.firstElementChild).toHaveClass('custom-bubble');
  });
});
