import React from 'react';
import { DevicesPage } from './pages/DevicesPage';
import type { DevicesPageTarget } from './pages/DevicesPage';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchDevicesRouteView — thin route shell for the Devices page (#1819).
   Pure pass-through: the shell owns the real Hub data + ping mutation.
   ═══════════════════════════════════════════════════════════════════════ */

export interface WorkbenchDevicesRouteViewProps {
  targets?: DevicesPageTarget[] | undefined;
  loading?: boolean | undefined;
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  pingingTargetId?: string | null | undefined;
  onPingTarget?: ((targetId: string) => void) | undefined;
}

export function WorkbenchDevicesRouteView({
  targets,
  loading,
  error,
  onRetry,
  pingingTargetId,
  onPingTarget,
}: WorkbenchDevicesRouteViewProps): React.ReactElement {
  return (
    <DevicesPage
      targets={targets}
      loading={loading}
      error={error}
      onRetry={onRetry}
      pingingTargetId={pingingTargetId}
      onPingTarget={onPingTarget}
    />
  );
}
