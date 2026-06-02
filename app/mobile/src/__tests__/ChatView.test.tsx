import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ChatView } from '../views/ChatView';
import type { Thread, ThreadItem } from '@agenthub/shared';

Element.prototype.scrollIntoView = vi.fn();

// ── Mock shared API ──
vi.mock('@agenthub/shared', () => ({
  listThreadItems: vi.fn(),
  listRuns: vi.fn(),
  listApprovals: vi.fn(),
  createThreadMessage: vi.fn(),
  decideApproval: vi.fn(),
}));

// ── Mock shared UI ──
vi.mock('@agenthub/shared/ui', () => ({
  MessageBubble: ({ children, author, align }: Record<string, unknown>) => (
    <div data-testid="message-bubble" data-author={author} data-align={align}>
      {children as React.ReactNode}
    </div>
  ),
  ContextSummary: ({ items }: { items?: Array<{ id: string; label: string; value: unknown }> }) => (
    <div data-testid="context-summary">
      {items?.map((item) => (
        <span key={item.id} data-testid={`context-${item.id}`}>{String(item.value)}</span>
      ))}
    </div>
  ),
  EmptyState: ({ title, description }: { title?: string; description?: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
  ActivityCard: ({ children, label }: Record<string, unknown>) => (
    <div data-testid="activity-card" data-label={label as string}>{children as React.ReactNode}</div>
  ),
  StatusNotice: ({ children }: Record<string, unknown>) => (
    <div data-testid="status-notice">{children as React.ReactNode}</div>
  ),
  BottomSheet: ({ children }: Record<string, unknown>) => (
    <div data-testid="bottom-sheet">{children as React.ReactNode}</div>
  ),
  ActionList: () => <div data-testid="action-list" />,
}));

// ── Mock i18n ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.participants.user': 'You',
        'chat.participants.agent': 'Agent',
        'chat.actions.backToThreads': 'Back to threads',
        'chat.states.loadingTitle': 'Loading messages',
        'chat.states.loadingDescription': 'Replaying the thread from Hub.',
        'chat.states.emptyTitle': 'No messages in this thread',
        'chat.states.emptyDescription': 'Send the first handoff note or continue from Desktop after sync.',
        'chat.states.syncErrorTitle': 'Messages could not sync',
        'chat.states.syncErrorEyebrow': 'Timeline recovery',
        'chat.states.syncErrorDescription': 'Keep the thread selected and retry once the Hub session is available.',
        'chat.states.replyPaused': 'Reply paused until timeline sync returns.',
        'chat.context.eyebrow': 'Desktop-aligned context',
        'chat.context.fallbackProject': 'Workspace thread',
        'chat.context.fallbackTitle': 'Untitled thread',
        'chat.context.status': 'Status',
        'chat.context.messages': 'Messages',
        'chat.context.updated': 'Updated',
        'chat.composer.label': 'Mobile reply',
        'chat.composer.placeholder': 'Message AgentHub...',
        'chat.actions.send': 'Send',
        'chat.actions.sendMobileReply': 'Send mobile reply',
        'chat.actions.paused': 'Paused',
        'chat.actions.replyPaused': 'Reply paused',
        'chat.actions.copy': 'Copy',
        'chat.actions.copied': 'Copied',
        'chat.actions.copyUser': 'Copy user message',
        'chat.actions.copyAgent': 'Copy agent message',
        'chat.actions.sending': 'Sending',
        'common.actions.retry': 'Retry',
        'common.actions.retrying': 'Retrying',
      };
      return map[key] ?? key;
    },
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

// ── Mock hooks ──
vi.mock('../hooks/useSwipeableMessage', () => ({
  usePullDownGesture: () => ({ onTouchStart: vi.fn(), onTouchMove: vi.fn(), onTouchEnd: vi.fn() }),
}));

vi.mock('../hooks/SwipeableMessageRow', () => ({
  SwipeableMessageRow: ({ children }: Record<string, unknown>) => (
    <div data-testid="swipeable-row">{children as React.ReactNode}</div>
  ),
}));

vi.mock('../hooks/useKeyboardAvoidance', () => ({
  useKeyboardAvoidance: () => ({
    isKeyboardVisible: false,
    keyboardHeight: 0,
  }),
}));

// ── Mock clipboard ──
Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test Thread',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    ...overrides,
  } as Thread;
}

function makeThreadItem(overrides: Partial<ThreadItem> = {}): ThreadItem {
  return {
    id: 'item-1',
    threadId: 'thread-1',
    role: 'user',
    kind: 'message',
    content: 'Hello from mobile',
    createdAt: '2025-01-01T12:00:00Z',
    ...overrides,
  } as ThreadItem;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('ChatView', () => {
  const thread = makeThread();
  const defaultProps = { thread, onBack: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the header with thread title and back button', () => {
    renderWithProviders(<ChatView {...defaultProps} />);
    expect(screen.getByText('Test Thread')).toBeInTheDocument();
    expect(screen.getByLabelText('Back to threads')).toBeInTheDocument();
  });

  it('shows loading state when messages are loading', () => {
    // useQuery starts in loading state by default with no data
    renderWithProviders(<ChatView {...defaultProps} />);
    expect(screen.getByText('Loading messages')).toBeInTheDocument();
  });

  it('renders the composer with send button', () => {
    renderWithProviders(<ChatView {...defaultProps} />);
    expect(screen.getByLabelText('Mobile reply')).toBeInTheDocument();
    const sendBtn = screen.getByLabelText('Send mobile reply');
    expect(sendBtn).toBeInTheDocument();
    expect(sendBtn).toBeDisabled(); // empty input
  });

  it('calls onBack when back button is clicked', () => {
    const onBack = vi.fn();
    renderWithProviders(<ChatView thread={thread} onBack={onBack} />);
    fireEvent.click(screen.getByLabelText('Back to threads'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders the context summary with thread metadata', () => {
    renderWithProviders(<ChatView {...defaultProps} />);
    // ContextSummary is rendered
    expect(screen.getByTestId('context-summary')).toBeInTheDocument();
    expect(screen.getByTestId('context-status')).toBeInTheDocument();
    expect(screen.getByTestId('context-messages')).toBeInTheDocument();
  });
});
