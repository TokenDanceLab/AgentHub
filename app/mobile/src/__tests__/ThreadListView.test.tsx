import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThreadListView } from '../views/ThreadListView';
import type { Thread } from '@agenthub/shared';

// ── Mock shared API ──
vi.mock('@agenthub/shared', () => ({
  listThreads: vi.fn(),
}));

// ── Mock shared components ──
vi.mock('@agenthub/shared/components', () => ({
  StatusBadge: ({ label, status }: { label: string; status: string }) => (
    <span data-testid="status-badge" data-status={status}>{label}</span>
  ),
  getStatusVariantClassName: (variant: string) => variant,
}));

// ── Mock shared UI ──
vi.mock('@agenthub/shared/ui', () => ({
  SurfaceHeader: ({ title, eyebrow }: { title?: string; eyebrow?: string }) => (
    <header data-testid="surface-header">
      <span>{eyebrow}</span>
      <h1>{title}</h1>
    </header>
  ),
  SectionHeader: ({ title }: { title?: string }) => (
    <div data-testid="section-header"><h2>{title}</h2></div>
  ),
  EmptyState: ({ title, description, action }: { title?: string; description?: string; action?: { label: string; onClick: () => void } }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
      {action && <button onClick={action.onClick}>{action.label}</button>}
    </div>
  ),
  MetricGrid: ({ items }: { items?: Array<{ id: string; value: unknown; label: string }> }) => (
    <div data-testid="metric-grid">
      {items?.map((item) => (
        <span key={item.id} data-testid={`metric-${item.id}`}>{item.label}: {String(item.value)}</span>
      ))}
    </div>
  ),
  StatusNotice: ({ children }: Record<string, unknown>) => (
    <div data-testid="status-notice">{children as React.ReactNode}</div>
  ),
  SegmentedControl: ({ value, onChange, options }: { value?: string; onChange?: (v: string) => void; options?: Array<{ value: string; label: string }> }) => (
    <div data-testid="segmented-control" data-value={value}>
      {options?.map((opt) => (
        <button key={opt.value} data-testid={`segment-${opt.value}`} onClick={() => onChange?.(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  ),
  ActionList: ({ items }: { items?: Array<{ id: string; title: string; onClick?: () => void }> }) => (
    <div data-testid="action-list">
      {items?.map((item) => (
        <div key={item.id} data-testid={`thread-${item.id}`} onClick={item.onClick}>
          {item.title}
        </div>
      ))}
    </div>
  ),
  TriageCard: ({ title }: { title?: string }) => (
    <div data-testid="triage-card">{title}</div>
  ),
  RecoveryPanel: ({ title, primaryAction }: Record<string, unknown>) => (
    <div data-testid="recovery-panel">
      <span>{title as string}</span>
      <button onClick={() => (primaryAction as Record<string, () => void>)?.onClick?.()}>Retry</button>
    </div>
  ),
}));

// ── Mock i18n ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'queue.threads.title': 'Threads',
        'queue.threads.eyebrow': 'Command center',
        'queue.threads.overviewTitle': 'Thread handoff',
        'queue.threads.loadingTitle': 'Loading threads',
        'queue.threads.loadingDescription': 'Syncing the latest Hub workspace state.',
        'queue.threads.emptyTitle': 'No threads yet',
        'queue.threads.emptyDescription': 'Start a thread from Desktop or Web, then continue it here.',
        'queue.threads.localWorkspace': 'Local workspace',
        'queue.threads.hubReady': 'OK',
        'queue.threads.hubDown': 'Down',
        'queue.threads.signalOnline': 'Hub API online',
        'queue.threads.signalPending': 'Hub reachable; workflow sync pending',
        'queue.threads.signalOffline': 'Hub health unavailable',
        'queue.threads.recoveryTitle': 'Threads could not sync',
        'queue.threads.recoveryReachable': 'Hub health is reachable, but workflow endpoints did not return thread JSON.',
        'queue.threads.recoveryOffline': 'Hub did not return the handoff queue.',
        'queue.threads.recoveryEyebrowReachable': 'Workflow recovery',
        'queue.threads.recoveryEyebrowOffline': 'Connection recovery',
        'queue.threads.filters': 'Thread filters',
        'queue.threads.filterArchived': 'Archive',
        'queue.threads.refresh': 'Refresh threads',
        'queue.threads.continueHandoff': 'Continue handoff',
        'queue.status.connected': 'Connected',
        'queue.status.reachable': 'Reachable',
        'queue.status.offline': 'Offline',
        'queue.statusLabels.online': 'Online',
        'queue.statusLabels.offline': 'Offline',
        'queue.common.all': 'All',
        'queue.common.active': 'Active',
        'queue.common.archived': 'Archived',
        'queue.common.account': 'Account',
        'queue.common.showAll': 'Show all',
        'queue.common.total': 'Total',
        'queue.common.lastAttempt': 'Last attempt {{time}}',
        'common.appName': 'AgentHub Mobile',
      };
      return map[key] ?? key;
    },
    i18n: { resolvedLanguage: 'en', language: 'en' },
  }),
}));

// ── Mock i18n module ──
vi.mock('../i18n', () => ({
  i18n: { resolvedLanguage: 'en', language: 'en' },
}));

// ── Mock native health ──
vi.mock('../native/hubHealth', () => ({
  getMobileHubHealth: vi.fn(() => Promise.resolve({ status: 'ok' })),
}));

// ── Mock MobileRecoveryPanel ──
vi.mock('../components/MobileRecoveryPanel', () => ({
  MobileRecoveryPanel: ({ title, description, onRetry, isRetrying }: Record<string, unknown>) => (
    <div data-testid="mobile-recovery-panel">
      <h3>{title as string}</h3>
      <p>{description as string}</p>
      <button data-testid="recovery-retry" onClick={() => (onRetry as () => void)()} disabled={isRetrying as boolean}>
        Retry
      </button>
    </div>
  ),
}));

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: 'thread-1',
    projectId: 'project-1',
    title: 'Test Thread',
    status: 'active',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T12:00:00Z',
    ...overrides,
  } as Thread;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('ThreadListView', () => {
  const defaultProps = {
    onThreadSelect: vi.fn(),
    onOpenAccount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the surface header with title', () => {
    renderWithProviders(<ThreadListView {...defaultProps} />);
    expect(screen.getByTestId('surface-header')).toBeInTheDocument();
    expect(screen.getByText('Threads')).toBeInTheDocument();
  });

  it('shows loading state when threads are loading', () => {
    renderWithProviders(<ThreadListView {...defaultProps} />);
    // useQuery starts in loading state by default (no data, no error)
    expect(screen.getByText('Loading threads')).toBeInTheDocument();
  });

  it('renders filter segmented control', () => {
    renderWithProviders(<ThreadListView {...defaultProps} />);
    expect(screen.getByTestId('segmented-control')).toBeInTheDocument();
    expect(screen.getByTestId('segment-all')).toBeInTheDocument();
    expect(screen.getByTestId('segment-active')).toBeInTheDocument();
    expect(screen.getByTestId('segment-archived')).toBeInTheDocument();
  });

  it('renders metric grid with counts', () => {
    renderWithProviders(<ThreadListView {...defaultProps} />);
    expect(screen.getByTestId('metric-grid')).toBeInTheDocument();
    expect(screen.getByTestId('metric-active')).toBeInTheDocument();
    expect(screen.getByTestId('metric-archived')).toBeInTheDocument();
  });
});
