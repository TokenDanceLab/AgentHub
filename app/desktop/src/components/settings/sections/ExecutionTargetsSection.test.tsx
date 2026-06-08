import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ExecutionTargetsSection from './ExecutionTargetsSection';
import type { DesktopExecutionTarget } from '@/platform/edgeCapabilityMapper';

vi.mock('../cards/RunnerRow', () => ({
  default: () => <div data-testid="runner-row" />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const text: Record<string, string> = {
        'settings.executionTargets': 'Execution Targets',
        'settings.executionTargetsDesc': 'Choose where runs execute.',
        'settings.targetLocalEdge': 'Local Edge',
        'settings.targetLocalEdgeDesc': 'Runs execute on this machine through the local Edge server and CLI runtimes.',
        'settings.targetHubRelay': 'Hub Relay',
        'settings.targetHubRelayDesc': 'TokenDance Hub routes remote approvals, device sync, and cross-device dispatch.',
        'settings.targetHubSignedIn': 'TokenDance ID session active',
        'settings.targetHubSignInRequired': 'Sign in required',
        'settings.desktopDevice': 'Desktop device',
        'settings.desktopDeviceDesc': 'Stable local device id used for Hub device registration and remote task routing.',
        'settings.desktopDeviceMissingDesc': 'Device id is created during Hub login or device registration.',
        'settings.targetSsh': 'SSH / Tailscale',
        'settings.targetSshDesc': 'Reserve remote hosts.',
        'settings.targetCloudEdge': 'Cloud Edge',
        'settings.targetCloudEdgeDesc': 'Reserve managed cloud execution targets.',
        'settings.offline': 'Offline',
        'settings.notConfigured': 'Not configured',
        'settings.enabled': 'Enabled',
        'settings.statusPlanned': 'Planned',
        'settings.runnerInventory': 'Runtime inventory',
        'settings.runnerInventoryDesc': 'Edge is reachable, but no runtime inventory is currently exposed by health checks.',
        'settings.localEdgeInventorySummary': `${values?.runners}/${values?.totalRunners} runners`,
        'settings.localEdgeTargetReadiness': 'Local Edge target readiness',
        'settings.localEdgeTargetReadinessRegistered': 'Hub can route to {{name}} ({{targetId}}) for this Desktop device.',
        'settings.localEdgeTargetReadinessMissing': 'Local Edge is healthy, but Hub has not registered a local_edge target for this Desktop device yet.',
      };
      return text[key]?.replace('{{name}}', String(values?.name)).replace('{{targetId}}', String(values?.targetId)) ?? key;
    },
  }),
}));

const localEdgeTarget: DesktopExecutionTarget = {
  id: 'local-edge',
  type: 'local_edge',
  name: 'Local Edge',
  status: 'healthy',
  route: 'local-edge-api',
  runnerCount: 1,
  onlineRunnerCount: 1,
  agentCount: 1,
  modelCount: 1,
  capabilityIds: ['streaming'],
};

describe('ExecutionTargetsSection', () => {
  it('surfaces the missing Hub local_edge registration preflight while Local Edge is healthy', () => {
    render(
      <ExecutionTargetsSection
        edgeOnline
        health={{ status: 'healthy' }}
        hubSessionActive
        runnerSummary="1/1 available"
        runnerItems={[]}
        availableRunners={1}
        localEdgeTarget={localEdgeTarget}
        desktopDeviceStatus="desktop...0001"
        deviceId="desktop-device-0001"
        registeredLocalEdgeTarget={null}
      />,
    );

    expect(screen.getByText('Local Edge target readiness')).toBeInTheDocument();
    expect(screen.getByText('Local Edge is healthy, but Hub has not registered a local_edge target for this Desktop device yet.')).toBeInTheDocument();
  });
});
