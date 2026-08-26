/**
 * Usage-board token summary for the status-strip live chip (#1990, UX F14).
 *
 * Data source is the SAME real data the Usage board renders (#1819): the
 * migration-0066 `token_usage_total` counters carried by team runs through
 * the shell's `usageTeams` channel. No new endpoint, no invented
 * "current session" number — the chip's semantics match the board exactly.
 */

import type { TokenUsagePageTeam } from './pages/TokenUsagePage';

/**
 * Sum the recorded token counters across every team run.
 * Runs recorded before the counter existed carry no value and contribute
 * nothing; when NO run carries a counter the result is `undefined` —
 * honest absence, so the status chip stays hidden instead of showing 0.
 */
export function sumUsageTeamTokens(
  teams: TokenUsagePageTeam[] | undefined,
): number | undefined {
  if (!teams) return undefined;
  let total = 0;
  let recorded = false;
  for (const team of teams) {
    for (const run of team.runs) {
      if (typeof run.tokenUsageTotal === 'number') {
        total += run.tokenUsageTotal;
        recorded = true;
      }
    }
  }
  return recorded ? total : undefined;
}
