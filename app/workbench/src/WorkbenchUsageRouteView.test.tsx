import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchUsageRouteView } from './WorkbenchUsageRouteView';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchUsageRouteView — thin route shell (#1819). Asserts the
   prop pass-through contract: team aggregates, retry wiring, and the
   honest unrecorded-counter rendering reach TokenUsagePage intact.
   ═══════════════════════════════════════════════════════════════════════ */

describe('WorkbenchUsageRouteView', () => {
  it('passes team aggregates through to TokenUsagePage', () => {
    render(
      <WorkbenchUsageRouteView
        teams={[
          {
            id: 'team-1',
            name: 'Release Crew',
            runs: [{ id: 'run-1', status: 'completed', tokenUsageTotal: 500 }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId('usage-page')).toBeInTheDocument();
    expect(screen.getByTestId('usage-team-team-1')).toBeInTheDocument();
    expect(screen.getByTestId('usage-run-tokens-run-1')).toHaveTextContent('500');
  });

  it('forwards the error state with a retry action', () => {
    const onRetry = vi.fn();
    render(<WorkbenchUsageRouteView error="boom" onRetry={onRetry} teams={[]} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('usage-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
