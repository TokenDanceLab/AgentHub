import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import {
  DevicesPage,
  formatDevicesLastSeen,
  resolveDevicesHealthBucket,
  summarizeDevices,
  type DevicesPageTarget,
} from './DevicesPage';

/* ═══════════════════════════════════════════════════════════════════════
   DevicesPage — device / execution-target management (#1819).

   Opts into the real zh chatview bundle (registered by the shared test
   i18n instance) so assertions verify actual localized copy instead of the
   key-echo fallback; state distinctions use test ids and ARIA roles.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

function target(partial: Partial<DevicesPageTarget> & Pick<DevicesPageTarget, 'id'>): DevicesPageTarget {
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

    expect(screen.getByTestId('devices-page')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('登录后可查看设备');
  });

  it('renders the empty state when the Hub has no registered targets', () => {
    render(<DevicesPage targets={[]} />);

    expect(screen.getByRole('status')).toHaveTextContent('还没有已注册的设备');
  });

  it('renders the error state with a retry action', () => {
    const onRetry = vi.fn();
    render(<DevicesPage error="hub unreachable" onRetry={onRetry} targets={[]} />);

    expect(screen.getByRole('alert')).toHaveTextContent('设备列表加载失败');
    // The error text is test-provided input flowing through the error state —
    // asserting it pins the data path, not application copy.
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
          target({ id: 'edge-1', name: 'Alpha Desktop', endpoint: '127.0.0.1:8443', lastSeenAt: '2026-08-23T08:00:00.000Z' }),
          target({ id: 'edge-2', name: 'Beta Box', healthState: 'offline', isOnline: false }),
        ]}
      />,
    );

    expect(screen.getByTestId('devices-summary')).toHaveTextContent('1/2 在线');
    expect(screen.getByTestId('devices-row-edge-1')).toBeInTheDocument();
    expect(screen.getByTestId('devices-row-edge-2')).toHaveAttribute('data-health', 'offline');
    expect(screen.getByTestId('devices-health-edge-1')).toHaveTextContent('健康');
    expect(screen.getByTestId('devices-health-edge-2')).toHaveTextContent('离线');

    fireEvent.click(screen.getByTestId('devices-ping-edge-1'));
    expect(onPingTarget).toHaveBeenCalledWith('edge-1');
  });

  it('shows the busy state only for the target being pinged', () => {
    render(
      <DevicesPage
        onPingTarget={vi.fn()}
        pingingTargetId="edge-1"
        targets={[target({ id: 'edge-1' }), target({ id: 'edge-2' })]}
      />,
    );

    expect(screen.getByTestId('devices-ping-edge-1')).toBeDisabled();
    expect(screen.getByTestId('devices-ping-edge-1')).toHaveTextContent('检测中…');
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
      />,
    );

    expect(screen.getByTestId('devices-repair-edge-mismatch')).toHaveTextContent('重新注册');
    expect(screen.getByTestId('devices-repair-edge-stale')).toHaveTextContent('心跳已过期');
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
