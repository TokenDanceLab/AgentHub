import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { formatTokens } from '@shared/context/breakdown';
import {
  TokenUsagePage,
  formatUsageTimestamp,
  hasRecordedTokens,
  sumRecordedTokens,
  type TokenUsagePageTeam,
} from './TokenUsagePage';

/* ═══════════════════════════════════════════════════════════════════════
   TokenUsagePage — token / cost consumption board (#1819).

   Opts into the real zh chatview bundle so assertions verify actual
   localized copy; rows and counts use test ids; unrecorded counters render
   “—” and are asserted as such (never a fake 0).
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

const teams: TokenUsagePageTeam[] = [
  {
    id: 'team-1',
    name: 'Release Crew',
    runs: [
      { id: 'run-1', status: 'completed', createdAt: '2026-08-22T09:00:00.000Z', tokenUsageTotal: 128_400, triggerMessage: 'ship the release' },
      // Pre-0066 run: counter never recorded — must render as em dash, not 0.
      { id: 'run-2', status: 'failed', createdAt: '2026-08-01T09:00:00.000Z' },
    ],
  },
  { id: 'team-2', name: 'Empty Team', runs: [] },
];

describe('TokenUsagePage', () => {
  it('renders sign-in guidance when the shell is not Hub-connected', () => {
    render(<TokenUsagePage teams={undefined} />);

    expect(screen.getByTestId('usage-page')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('登录后可查看用量');
  });

  it('renders the empty state when the user has no teams', () => {
    render(<TokenUsagePage teams={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent('还没有用量数据');
  });

  it('renders the error state with retry', () => {
    const onRetry = vi.fn();
    render(<TokenUsagePage error="boom" onRetry={onRetry} teams={[]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('用量数据加载失败');
    fireEvent.click(screen.getByTestId('usage-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('summarizes recorded tokens per team and overall', () => {
    render(<TokenUsagePage teams={teams} />);

    expect(screen.getByTestId('usage-team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('usage-team-team-2')).toBeInTheDocument();
    // Total tile shows only recorded counters, formatted through the shared
    // token formatter (128_400 → 128.4K) — #2154 P3-3.
    expect(screen.getByTestId('usage-total')).toHaveTextContent('128.4K');
    expect(screen.getByTestId('usage-run-tokens-run-1')).toHaveTextContent('128,400');
    // Unrecorded counter renders an honest em dash.
    expect(screen.getByTestId('usage-run-tokens-run-2')).toHaveTextContent('—');
    // The backfill footnote keeps the dash honest.
    expect(screen.getByText(/计数自迁移 0066 起维护/)).toBeInTheDocument();
  });

  it('renders em dashes for aggregates with no recorded counters (#1856)', () => {
    render(
      <TokenUsagePage
        teams={[
          { id: 'team-old', name: 'Pre-0066 Team', runs: [{ id: 'run-9', status: 'completed' }] },
        ]}
      />,
    );

    // No run carries a counter — the total must not present a fake 0.
    expect(screen.getByTestId('usage-total')).toHaveTextContent('—');
    expect(screen.getByTestId('usage-team-team-old')).toHaveTextContent('—');
  });
});

describe('usage helpers', () => {
  it('sums only recorded token counters', () => {
    expect(sumRecordedTokens(teams)).toBe(128_400);
    expect(sumRecordedTokens([])).toBe(0);
  });

  it('detects whether any counter was recorded (#1856)', () => {
    expect(hasRecordedTokens(teams)).toBe(true);
    expect(hasRecordedTokens([])).toBe(false);
    expect(hasRecordedTokens([{ id: 't', name: 'T', runs: [{ id: 'r', status: 'failed' }] }])).toBe(false);
  });

  it('compacts token counts with the shared formatter (#2154 P3-3)', () => {
    // The page-local formatTokenCount is deleted: tiles and the status strip
    // must share one unit convention (uppercase K/M, one decimal).
    expect(formatTokens(999)).toBe('999');
    expect(formatTokens(12_345)).toBe('12.3K');
    expect(formatTokens(2_500_000)).toBe('2.5M');
  });

  it('formats timestamps defensively', () => {
    expect(formatUsageTimestamp(undefined)).toBe('—');
    expect(formatUsageTimestamp('bad')).toBe('bad');
    expect(formatUsageTimestamp('2026-08-22T09:00:00.000Z')).not.toBe('2026-08-22T09:00:00.000Z');
  });
});
