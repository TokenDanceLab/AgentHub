vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) => {
      if (!vars) return key;
      const varStr = Object.entries(vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `${key}(${varStr})`;
    },
    i18n: { language: 'en' },
  }),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import IMMessageView, { type IMMessage } from '@/components/IMMessageView';

// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

// ── Helpers ─────────────────────────────────────

function makeMsg(overrides: Partial<IMMessage> = {}): IMMessage {
  return {
    id: 'msg-1',
    sessionId: 'sess-1',
    senderId: 'user-a',
    senderName: 'Alice',
    content: 'Hello world',
    timestamp: new Date().toISOString(),
    isAgent: false,
    ...overrides,
  };
}

function makeAgentMsg(overrides: Partial<IMMessage> = {}): IMMessage {
  return makeMsg({
    id: 'agent-msg-1',
    senderId: 'agent-1',
    senderName: 'Claude',
    isAgent: true,
    content: 'I can help with that.',
    ...overrides,
  });
}

// ── Tests ───────────────────────────────────────

describe('IMMessageView', () => {
  it('renders messages with correct alignment: self right, other left', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'me', content: 'Hello' }),
      makeMsg({ id: 'm2', senderId: 'other', content: 'Hi there' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Both messages rendered
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  it('agent messages show sender name with AI tag', () => {
    const messages: IMMessage[] = [
      makeAgentMsg({ senderName: 'Claude', content: 'Processing...' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Agent name visible
    expect(screen.getByText('Claude')).toBeInTheDocument();
    // AI tag
    expect(screen.getByText('im.message.agentLabel')).toBeInTheDocument();
  });

  it('authority color bands render correctly', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'other', authority: 'owner', content: 'Owner msg' }),
      makeMsg({ id: 'm2', senderId: 'other', authority: 'admin', content: 'Admin msg' }),
      makeMsg({ id: 'm3', senderId: 'other', authority: 'member', content: 'Member msg' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // All messages rendered
    expect(screen.getByText('Owner msg')).toBeInTheDocument();
    expect(screen.getByText('Admin msg')).toBeInTheDocument();
    expect(screen.getByText('Member msg')).toBeInTheDocument();
  });

  it('shows sender avatar for non-self messages', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'other', senderName: 'Bob', content: 'Hey' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Avatar shows initial
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('does NOT show sender row for self messages', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'me', senderName: 'Me', content: 'My message' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Sender name "Me" should NOT appear as a label (self messages skip sender row)
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('shows empty state when no messages', () => {
    render(
      <IMMessageView
        messages={[]}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    expect(screen.getByText('im.message.empty')).toBeInTheDocument();
  });

  it('shows pending message with loading indicator', () => {
    render(
      <IMMessageView
        messages={[]}
        currentUserId="me"
        onSend={vi.fn()}
        pendingMessage="Sending..."
      />,
    );

    expect(screen.getByText('Sending...')).toBeInTheDocument();
    expect(screen.getByText('im.message.loading')).toBeInTheDocument();
  });

  it('shows send failed indicator for failed messages', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'me', content: 'Failed message', sendFailed: true }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Send failed text visible
    expect(screen.getByText('im.message.sendFailed')).toBeInTheDocument();
  });

  it('shows retry button on hover for failed messages', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'me', content: 'Failed msg', sendFailed: true }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
        onRecall={vi.fn()}
      />,
    );

    // Hover the message wrapper
    const bubbleWrappers = document.querySelectorAll('[class*="bubbleWrapper"]');
    expect(bubbleWrappers.length).toBeGreaterThan(0);

    fireEvent.mouseEnter(bubbleWrappers[0]!);

    // Retry button should appear
    expect(screen.getByTitle('im.message.retry')).toBeInTheDocument();
  });

  it('timestamp shows on hover', () => {
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'other', content: 'Hello' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    const bubbleWrappers = document.querySelectorAll('[class*="bubbleWrapper"]');
    expect(bubbleWrappers.length).toBeGreaterThan(0);

    // Before hover, timestamp hidden
    expect(screen.queryByText('Just now')).not.toBeInTheDocument();

    // Hover
    fireEvent.mouseEnter(bubbleWrappers[0]!);

    // Timestamp appears
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('renders markdown content in messages', () => {
    const messages: IMMessage[] = [
      makeMsg({
        id: 'm1',
        senderId: 'other',
        content: '**bold** and *italic*',
      }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    // Markdown rendered
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('italic')).toBeInTheDocument();
  });

  it('renders attachment links when provided', () => {
    const messages: IMMessage[] = [
      makeMsg({
        id: 'm1',
        senderId: 'other',
        content: 'Check this file',
        attachments: [{ id: 'att1', name: 'report.pdf', url: 'https://example.com/report.pdf' }],
      }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
      />,
    );

    const link = screen.getByText('report.pdf');
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com/report.pdf');
  });

  it('recall callback fires on recall button click', () => {
    const onRecall = vi.fn();
    const messages: IMMessage[] = [
      makeMsg({ id: 'm1', senderId: 'other', content: 'Hello' }),
    ];

    render(
      <IMMessageView
        messages={messages}
        currentUserId="me"
        onSend={vi.fn()}
        onRecall={onRecall}
      />,
    );

    const bubbleWrappers = document.querySelectorAll('[class*="bubbleWrapper"]');
    fireEvent.mouseEnter(bubbleWrappers[0]!);

    const recallBtn = screen.getByTitle('im.message.recall');
    fireEvent.click(recallBtn);

    expect(onRecall).toHaveBeenCalledWith('m1');
  });
});
