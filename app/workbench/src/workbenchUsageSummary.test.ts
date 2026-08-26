// sumUsageTeamTokens (#1990, UX F14): the status-strip chip's data source.
// Asserts the honesty contract — no recorded counters means `undefined`
// (chip hidden), never a fake 0; pre-counter runs contribute nothing.
import { describe, expect, it } from 'vitest';
import { sumUsageTeamTokens } from './workbenchUsageSummary';
import type { TokenUsagePageTeam } from './pages/TokenUsagePage';

function team(runs: Array<{ tokenUsageTotal?: number }>): TokenUsagePageTeam {
  return {
    id: 'team-1',
    name: 'Team',
    runs: runs.map((run, index) => ({
      id: `run-${index}`,
      status: 'completed',
      ...(run.tokenUsageTotal !== undefined ? { tokenUsageTotal: run.tokenUsageTotal } : {}),
    })),
  };
}

describe('sumUsageTeamTokens (#1990)', () => {
  it('returns undefined without teams (shell not Hub-connected)', () => {
    expect(sumUsageTeamTokens(undefined)).toBeUndefined();
    expect(sumUsageTeamTokens([])).toBeUndefined();
  });

  it('returns undefined when no run carries a counter (honest absence, not 0)', () => {
    expect(sumUsageTeamTokens([team([{}, {}])])).toBeUndefined();
  });

  it('sums recorded counters across teams and runs', () => {
    const teams = [
      team([{ tokenUsageTotal: 1200 }, {}]),
      team([{ tokenUsageTotal: 300 }, { tokenUsageTotal: 50 }]),
    ];
    expect(sumUsageTeamTokens(teams)).toBe(1550);
  });

  it('counts an explicit zero as recorded (real zero beats hidden chip)', () => {
    expect(sumUsageTeamTokens([team([{ tokenUsageTotal: 0 }])])).toBe(0);
  });
});
