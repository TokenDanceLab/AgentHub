import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WorkbenchDevicesRouteView } from './WorkbenchDevicesRouteView';

/* ═══════════════════════════════════════════════════════════════════════
   WorkbenchDevicesRouteView — thin route shell (#1819). Asserts the
   prop pass-through contract: whatever the shell feeds in reaches
   DevicesPage intact (data, ping wiring, retry), so the route-level
   plumbing cannot silently regress.
   ═══════════════════════════════════════════════════════════════════════ */

describe('WorkbenchDevicesRouteView', () => {
  it('passes targets, ping, and retry through to DevicesPage', () => {
    const onPingTarget = vi.fn();
    const onRetry = vi.fn();
    render(
      <WorkbenchDevicesRouteView
        targets={[{ id: 'edge-1', name: 'Alpha', targetType: 'local_edge', healthState: 'healthy', isOnline: true }]}
        pingingTargetId={null}
        onPingTarget={onPingTarget}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByTestId('devices-page')).toBeInTheDocument();
    expect(screen.getByTestId('devices-row-edge-1')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('devices-ping-edge-1'));
    expect(onPingTarget).toHaveBeenCalledWith('edge-1');
  });

  it('passes the busy ping state through', () => {
    render(
      <WorkbenchDevicesRouteView
        targets={[{ id: 'edge-1', name: 'Alpha', targetType: 'local_edge', healthState: 'healthy', isOnline: true }]}
        pingingTargetId="edge-1"
        onPingTarget={vi.fn()}
      />,
    );

    expect(screen.getByTestId('devices-ping-edge-1')).toBeDisabled();
  });

  it('forwards the error state with a retry action', () => {
    const onRetry = vi.fn();
    render(<WorkbenchDevicesRouteView error="boom" onRetry={onRetry} targets={[]} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('devices-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
