import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { IMMessageView } from '@/components/IM';
import type { IMMessage } from '@/components/IM';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

function makeMsg(overrides: Partial<IMMessage> = {}): IMMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    senderId: 'user-1',
    senderName: 'Alice',
    senderType: 'user',
    authority: 'hub',
    content: 'Hello world',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('IMMessageView', () => {
  it('renders empty state when no messages', () => {
    render(<IMMessageView messages={[]} />);
    expect(screen.getByText('No messages yet')).toBeInTheDocument();
  });

  it('renders user message bubble', () => {
    const msg = makeMsg({ senderType: 'user', content: 'Hello!' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('Hello!')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
  });

  it('renders agent message bubble', () => {
    const msg = makeMsg({ senderType: 'agent', senderName: 'Claude', content: 'Processing...' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('Processing...')).toBeInTheDocument();
    expect(screen.getByText('Claude')).toBeInTheDocument();
  });

  it('shows hub authority badge (blue)', () => {
    const msg = makeMsg({ authority: 'hub' });
    render(<IMMessageView messages={[msg]} />);
    const badges = screen.getAllByText('hub');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows edge authority badge (green)', () => {
    const msg = makeMsg({ authority: 'edge' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('edge')).toBeInTheDocument();
  });

  it('shows hybrid authority badge (orange)', () => {
    const msg = makeMsg({ authority: 'hybrid' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('hybrid')).toBeInTheDocument();
  });

  it('renders markdown content via MarkdownRenderer', () => {
    const msg = makeMsg({ content: '**bold** and *italic*' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('displays recalled message content', () => {
    const msg = makeMsg({ content: '[Message recalled]' });
    render(<IMMessageView messages={[msg]} />);
    expect(screen.getByText('[Message recalled]')).toBeInTheDocument();
  });

  it('renders multiple messages in order', () => {
    const msgs = [
      makeMsg({ id: 'm1', content: 'First' }),
      makeMsg({ id: 'm2', content: 'Second' }),
      makeMsg({ id: 'm3', content: 'Third' }),
    ];
    render(<IMMessageView messages={msgs} />);
    const items = screen.getAllByRole('article');
    expect(items).toHaveLength(3);
  });

  it('identifies own messages by currentUserId', () => {
    const msgs = [
      makeMsg({ id: 'm1', senderId: 'me', content: 'My message' }),
      makeMsg({ id: 'm2', senderId: 'other', senderType: 'agent', content: 'Their message' }),
    ];
    render(<IMMessageView messages={msgs} currentUserId="me" />);
    expect(screen.getByText('My message')).toBeInTheDocument();
    expect(screen.getByText('Their message')).toBeInTheDocument();
  });

  it('falls back to senderType for own-message detection', () => {
    const msgs = [
      makeMsg({ id: 'm1', senderType: 'user', content: 'From user' }),
      makeMsg({ id: 'm2', senderType: 'agent', content: 'From agent' }),
    ];
    render(<IMMessageView messages={msgs} />);
    expect(screen.getByText('From user')).toBeInTheDocument();
    expect(screen.getByText('From agent')).toBeInTheDocument();
  });
});
