import React from 'react';
import { TokenUsagePage } from './pages/TokenUsagePage';
import type { TokenUsagePageTeam } from './pages/TokenUsagePage';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchUsageRouteView — thin route shell for the Token usage board (#1819).
   Pure pass-through: the shell composes real team-run token counters.
   ═══════════════════════════════════════════════════════════════════════ */

export interface WorkbenchUsageRouteViewProps {
  teams?: TokenUsagePageTeam[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
}

export function WorkbenchUsageRouteView({
  teams,
  loading,
  error,
  onRetry,
}: WorkbenchUsageRouteViewProps): React.ReactElement {
  return <TokenUsagePage teams={teams} loading={loading} error={error} onRetry={onRetry} />;
}
