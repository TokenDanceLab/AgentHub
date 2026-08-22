import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  TokenUsagePage,
  formatTokenCount,
  formatUsageTimestamp,
  sumRecordedTokens,
  type TokenUsagePageTeam,
} from './TokenUsagePage';

/* ═══════════════════════════════════════════════════════════════════════
   TokenUsagePage — token / cost consumption board (#1819).
   Test i18n echoes chatview keys by default, so assertions match raw keys.
   ═══════════════════════════════════════════════════════════════════════ */

const teams: TokenUsagePageTeam[] = [
  {
    id: 'team-1',
    name: 'Release Crew',
    runs: [
      {
        id: 'run-1',
        status: 'completed',
        createdAt: '2026-08-22T09:00:00.000Z',
        tokenUsageTotal: 128_400,
        triggerMessage: 'ship the release',
      },
      // Pre-0066 run: counter never recorded — must render as em dash, not 0.
      { id: 'run-2', status: 'failed', createdAt: '2026-08-01T09:00:00.000Z' },
    ],
  },
  { id: 'team-2', name: 'Empty Team', runs: [] },
];

describe('TokenUsagePage', () => {
  it('renders sign-in guidance when the shell is not Hub-connected', () => {
    render(<TokenUsagePage teams={undefined} />);

    expect(screen.getByText('usage.signedOut.title')).toBeInTheDocument();
    expect(screen.getByText('usage.signedOut.body')).toBeInTheDocument();
  });

  it('renders the empty state when the user has no teams', () => {
    render(<TokenUsagePage teams={[]} />);

    expect(screen.getByText('usage.empty.title')).toBeInTheDocument();
  });

  it('renders the error state with retry', () => {
    const onRetry = vi.fn();
    render(<TokenUsagePage error="boom" onRetry={onRetry} teams={[]} />);

    expect(screen.getByText('usage.error.title')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('usage-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('summarizes recorded tokens per team and overall', () => {
    render(<TokenUsagePage teams={teams} />);

    expect(screen.getByTestId('usage-team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('usage-team-team-2')).toBeInTheDocument();
    // Total tile shows only recorded counters (128_400 → 128.4k).
    expect(screen.getByTestId('usage-total')).toHaveTextContent('128.4k');
    expect(screen.getByTestId('usage-run-tokens-run-1')).toHaveTextContent('128,400');
    // Unrecorded counter renders an honest em dash.
    expect(screen.getByTestId('usage-run-tokens-run-2')).toHaveTextContent('—');
    // The backfill footnote keeps the dash honest.
    expect(screen.getByText('usage.footnote')).toBeInTheDocument();
  });
});

describe('usage helpers', () => {
  it('sums only recorded token counters', () => {
    expect(sumRecordedTokens(teams)).toBe(128_400);
    expect(sumRecordedTokens([])).toBe(0);
  });

  it('compacts token counts for tiles', () => {
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(12_345)).toBe('12.3k');
    expect(formatTokenCount(2_500_000)).toBe('2.50M');
  });

  it('formats timestamps defensively', () => {
    expect(formatUsageTimestamp(undefined)).toBe('—');
    expect(formatUsageTimestamp('bad')).toBe('bad');
    expect(formatUsageTimestamp('2026-08-22T09:00:00.000Z')).not.toBe('2026-08-22T09:00:00.000Z');
  });
});
