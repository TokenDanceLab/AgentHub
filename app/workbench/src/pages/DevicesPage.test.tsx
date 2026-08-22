import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  DevicesPage,
  formatDevicesLastSeen,
  resolveDevicesHealthBucket,
  summarizeDevices,
  type DevicesPageTarget,
} from './DevicesPage';

/* ═══════════════════════════════════════════════════════════════════════
   DevicesPage — device / execution-target management (#1819).
   Test i18n echoes chatview keys by default, so assertions match raw keys.
   ═══════════════════════════════════════════════════════════════════════ */

function target(
  partial: Partial<DevicesPageTarget> & Pick<DevicesPageTarget, 'id'>
): DevicesPageTarget {
  return {
    name: partial.id,
    targetType: 'local_edge',
    healthState: 'healthy',
    isOnline: true,
    ...partial,
  };
}

describe('DevicesPage', () => {
  it('renders sign-in guidance when the shell is not Hub-connected', () => {
    render(<DevicesPage targets={undefined} />);

    expect(screen.getByText('devices.signedOut.title')).toBeInTheDocument();
    expect(screen.getByText('devices.signedOut.body')).toBeInTheDocument();
  });

  it('renders the empty state when the Hub has no registered targets', () => {
    render(<DevicesPage targets={[]} />);

    expect(screen.getByText('devices.empty.title')).toBeInTheDocument();
  });

  it('renders the error state with a retry action', () => {
    const onRetry = vi.fn();
    render(<DevicesPage error="hub unreachable" onRetry={onRetry} targets={[]} />);

    expect(screen.getByText('devices.error.title')).toBeInTheDocument();
    expect(screen.getByText('hub unreachable')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('devices-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('lists targets with health badges, summary, and ping actions', () => {
    const onPingTarget = vi.fn();
    render(
      <DevicesPage
        onPingTarget={onPingTarget}
        targets={[
          target({
            id: 'edge-1',
            name: 'Alpha Desktop',
            endpoint: '127.0.0.1:8443',
            lastSeenAt: '2026-08-23T08:00:00.000Z',
          }),
          target({ id: 'edge-2', name: 'Beta Box', healthState: 'offline', isOnline: false }),
        ]}
      />
    );

    expect(screen.getByTestId('devices-summary')).toBeInTheDocument();
    expect(screen.getByTestId('devices-row-edge-1')).toBeInTheDocument();
    expect(screen.getByTestId('devices-row-edge-2')).toHaveAttribute('data-health', 'offline');
    expect(screen.getByTestId('devices-health-edge-1')).toHaveTextContent('devices.health.healthy');
    expect(screen.getByTestId('devices-health-edge-2')).toHaveTextContent('devices.health.offline');

    fireEvent.click(screen.getByTestId('devices-ping-edge-1'));
    expect(onPingTarget).toHaveBeenCalledWith('edge-1');
  });

  it('shows the busy state only for the target being pinged', () => {
    render(
      <DevicesPage
        onPingTarget={vi.fn()}
        pingingTargetId="edge-1"
        targets={[target({ id: 'edge-1' }), target({ id: 'edge-2' })]}
      />
    );

    expect(screen.getByTestId('devices-ping-edge-1')).toBeDisabled();
    expect(screen.getByTestId('devices-ping-edge-1')).toHaveTextContent('devices.pinging');
    expect(screen.getByTestId('devices-ping-edge-2')).not.toBeDisabled();
  });

  it('shows repair guidance only for actionable health states', () => {
    render(
      <DevicesPage
        targets={[
          target({ healthState: 'mismatch', id: 'edge-mismatch', isOnline: false }),
          target({ healthState: 'stale', id: 'edge-stale', isOnline: false }),
          target({ healthState: 'healthy', id: 'edge-ok' }),
        ]}
      />
    );

    expect(screen.getByTestId('devices-repair-edge-mismatch')).toHaveTextContent(
      'devices.repair.mismatch'
    );
    expect(screen.getByTestId('devices-repair-edge-stale')).toHaveTextContent(
      'devices.repair.stale'
    );
    expect(screen.queryByTestId('devices-repair-edge-ok')).not.toBeInTheDocument();
  });
});

describe('devices helpers', () => {
  it('normalizes unknown health states into the unknown bucket', () => {
    expect(resolveDevicesHealthBucket('registered')).toBe('unknown');
    expect(resolveDevicesHealthBucket('healthy')).toBe('healthy');
    expect(resolveDevicesHealthBucket('mismatch')).toBe('mismatch');
  });

  it('summarizes online and healthy counters', () => {
    const summary = summarizeDevices([
      target({ healthState: 'healthy', id: 'a' }),
      target({ healthState: 'online', id: 'b' }),
      target({ healthState: 'offline', id: 'c', isOnline: false }),
    ]);
    expect(summary).toEqual({ total: 3, online: 2, healthy: 2 });
  });

  it('formats last-seen timestamps defensively', () => {
    expect(formatDevicesLastSeen(undefined)).toBeUndefined();
    expect(formatDevicesLastSeen('not-a-date')).toBe('not-a-date');
    expect(formatDevicesLastSeen('2026-08-23T08:00:00.000Z')).not.toBe('2026-08-23T08:00:00.000Z');
  });
});
