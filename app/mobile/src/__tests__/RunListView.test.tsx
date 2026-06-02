import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RunListView } from '../views/RunListView';
import type { Run } from '@agenthub/shared';

// ── Mock shared API ──
vi.mock('@agenthub/shared', () => ({
  listRuns: vi.fn(),
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
        <div key={item.id} data-testid={`run-${item.id}`} onClick={item.onClick}>
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
        'queue.runs.title': 'Runs',
        'queue.runs.eyebrow': 'Execution monitor',
        'queue.runs.overviewTitle': 'Recent activity',
        'queue.runs.loadingTitle': 'Loading runs',
        'queue.runs.loadingDescription': 'Syncing the latest Hub execution state.',
        'queue.runs.emptyTitle': 'No recent runs',
        'queue.runs.emptyDescription': 'Runs started from Desktop, Web, or Hub will appear here for mobile review.',
        'queue.runs.recoveryTitle': 'Run queue could not sync',
        'queue.runs.recoveryReachable': 'Hub health is reachable, but workflow endpoints did not return run JSON.',
        'queue.runs.recoveryOffline': 'The last execution state is unavailable.',
        'queue.runs.recoveryEyebrowReachable': 'Workflow recovery',
        'queue.runs.recoveryEyebrowOffline': 'Execution recovery',
        'queue.runs.nextReview': 'Next review',
        'queue.runs.filters': 'Run filters',
        'queue.runs.refresh': 'Refresh runs',
        'queue.runs.metricActive': 'Active',
        'queue.runs.metricReview': 'Review',
        'queue.runs.runLabel': 'Run {{runId}}',
        'queue.runs.signalOnline': 'Hub execution API online',
        'queue.runs.signalPending': 'Hub reachable; run sync pending',
        'queue.runs.signalOffline': 'Hub health unavailable',
        'queue.status.connected': 'Connected',
        'queue.status.reachable': 'Reachable',
        'queue.status.offline': 'Offline',
        'queue.statusLabels.queued': 'Queued',
        'queue.statusLabels.starting': 'Starting',
        'queue.statusLabels.running': 'Running',
        'queue.statusLabels.review': 'Review',
        'queue.statusLabels.done': 'Done',
        'queue.statusLabels.error': 'Error',
        'queue.statusLabels.cancelled': 'Cancelled',
        'queue.statusLabels.pending': 'Pending',
        'queue.common.all': 'All',
        'queue.common.review': 'Review',
        'queue.common.active': 'Active',
        'queue.common.closed': 'Closed',
        'queue.common.total': 'Total',
        'queue.common.account': 'Account',
        'queue.common.showAll': 'Show all',
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

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: 'run-001',
    threadId: 'thread-1',
    status: 'running',
    createdAt: '2025-01-01T00:00:00Z',
    startedAt: '2025-01-01T12:00:00Z',
    ...overrides,
  } as Run;
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

describe('RunListView', () => {
  const defaultProps = {
    onRunSelect: vi.fn(),
    onOpenAccount: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the surface header with title', () => {
    renderWithProviders(<RunListView {...defaultProps} />);
    expect(screen.getByTestId('surface-header')).toBeInTheDocument();
    expect(screen.getByText('Runs')).toBeInTheDocument();
  });

  it('shows loading state when runs are loading', () => {
    renderWithProviders(<RunListView {...defaultProps} />);
    expect(screen.getByText('Loading runs')).toBeInTheDocument();
  });

  it('renders filter segmented control with all four tabs', () => {
    renderWithProviders(<RunListView {...defaultProps} />);
    expect(screen.getByTestId('segmented-control')).toBeInTheDocument();
    expect(screen.getByTestId('segment-all')).toBeInTheDocument();
    expect(screen.getByTestId('segment-review')).toBeInTheDocument();
    expect(screen.getByTestId('segment-active')).toBeInTheDocument();
    expect(screen.getByTestId('segment-closed')).toBeInTheDocument();
  });

  it('renders metric grid with active, review, and total counts', () => {
    renderWithProviders(<RunListView {...defaultProps} />);
    expect(screen.getByTestId('metric-grid')).toBeInTheDocument();
    expect(screen.getByTestId('metric-active')).toBeInTheDocument();
    expect(screen.getByTestId('metric-review')).toBeInTheDocument();
    expect(screen.getByTestId('metric-total')).toBeInTheDocument();
  });
});
