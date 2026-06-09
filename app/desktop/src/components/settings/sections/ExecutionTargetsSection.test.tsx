import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import ExecutionTargetsSection from './ExecutionTargetsSection';
import type { DesktopExecutionTarget } from '@/platform/edgeCapabilityMapper';
import type { ExecutionTargetInventoryItem } from '@/api/executionTargetQueries';
import { localCliDiscoveryFixture } from '../cliDiscovery';
import type { DesktopLocalEdgeDiagnostics } from '@/platform/desktopPlatform';

vi.mock('@shared/workbench', () => ({
  RuntimeBrandIcon: ({ name }: { name?: string }) => <span data-testid="runtime-brand-icon">{name}</span>,
}));

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
        'settings.localEdgeTargetReadinessSignedOut': 'Sign in to TokenDance ID so Hub can register this Desktop as a remote-control target.',
        'settings.localEdgeTargetReadinessLoading': 'Checking Hub for the registered local_edge execution target for this Desktop device.',
        'settings.localEdgeTargetReadinessError': 'Desktop could not read Hub execution targets. Local runs still use Local Edge, but Hub remote control cannot be confirmed.',
        'settings.localEdgeTargetReadinessRegistered': 'Hub can route to {{name}} ({{targetId}}) for this Desktop device.',
        'settings.localEdgeTargetReadinessNoDevice': 'Desktop has not created a stable device ID yet; sign in and let device registration run first.',
        'settings.localEdgeTargetReadinessOffline': 'Start Local Edge before testing Hub-driven remote control for this Desktop target.',
        'settings.localEdgeTargetReadinessMissing': 'Local Edge is healthy, but Hub has not registered a local_edge target for this Desktop device yet.',
        'settings.localEdgeTargetReadinessHubOffline': 'Hub has this Desktop target, but it is currently offline or stale.',
        'settings.localEdgeTargetReadinessHubDegraded': 'Hub has this Desktop target, but its health is degraded.',
        'settings.localEdgeTargetReadinessHubUnknown': 'Hub has this Desktop target, but its health is not confirmed yet.',
        'settings.localEdgeTargetReadinessPaginationLimited': 'Hub target inventory is still paginated; Desktop cannot confirm whether this device target exists yet.',
        'settings.localEdgeTargetRegisterAction': 'Register Local Edge target',
        'settings.localEdgeTargetUpdateAction': 'Sync Local Edge target',
        'settings.localEdgeTargetSyncing': 'Syncing Local Edge target...',
        'settings.localEdgeTargetSyncError': 'Hub target sync failed: {{error}}',
        'settings.localCliDiscovery': 'Local CLI discovery',
        'settings.localCliDiscoveryDesc': 'No-spend runtime discovery for Desktop diagnostics. It does not execute runs, prompt-bearing commands, model calls, or secrets.',
        'settings.localCliReadinessManifest': 'Readiness manifest',
        'settings.localCliReadinessScript': 'Readiness script',
        'settings.localCliNoSpend': 'no-spend',
        'settings.localCliInstalled': 'installed',
        'settings.localCliMissing': 'missing',
        'settings.localCliVersion': 'version',
        'settings.localCliPath': 'path',
        'settings.desktopHostReadiness': 'Tauri package readiness',
        'settings.desktopHostReadinessDesc': 'Packaged Desktop preflight for the Local Edge sidecar, SQLite app-data store, and launch smoke. It never exposes process spawn commands or raw CLI args.',
        'settings.desktopHostStatus': 'status',
        'settings.desktopHostRunning': 'running',
        'settings.desktopHostStopped': 'stopped',
        'settings.desktopHostSidecar': 'sidecar',
        'settings.desktopHostSidecarAvailable': 'available',
        'settings.desktopHostSidecarMissing': 'missing',
        'settings.desktopHostFallback': 'fallback executable',
        'settings.desktopHostAuthToken': 'auth token',
        'settings.desktopHostReady': 'ready',
        'settings.desktopHostBlocked': 'blocked',
        'settings.desktopHostStore': 'store',
        'settings.desktopHostHealth': 'health',
        'settings.desktopHostLogs': 'logs',
        'settings.desktopHostSidecarSmoke': 'sidecar launch smoke',
        'settings.desktopHostNoDirectCliSpawn': 'direct CLI spawn: disabled',
      };
      return text[key]
        ?.replace('{{name}}', String(values?.name))
        .replace('{{targetId}}', String(values?.targetId))
        .replace('{{error}}', String(values?.error))
        ?? key;
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

const registeredTarget: ExecutionTargetInventoryItem = {
  id: 'local-target-current',
  device_id: 'desktop-device-0001',
  name: 'Current Desktop Local Edge',
  target_type: 'local_edge',
  workspace_allowlist: [],
  trust_level: 'local',
  health_state: 'healthy',
  is_online: true,
};

const localEdgeDiagnostics: DesktopLocalEdgeDiagnostics = {
  readiness: {
    running: true,
    pid: 1234,
    port: 3210,
    sidecar_name: 'agenthub-edge',
    target_id: 'local-edge',
    route: 'local-edge-api',
    bind_addr: '127.0.0.1:3210',
    health_url: 'http://127.0.0.1:3210/v1/health',
    store_backend: 'sqlite',
    store_db_policy: '<app-data>/agenthub-edge.sqlite',
    store_readiness_manifest_schema: 'agenthub-edge-sqlite-readiness-v1',
    expected_store_migration_version: 4,
    log_paths: {
      directory: '<app-data>/edge-logs',
      stdout: '<app-data>/edge-logs/local-edge.stdout.log',
      stderr: '<app-data>/edge-logs/local-edge.stderr.log',
    },
    sidecar_args: [
      '--store-backend',
      'sqlite',
      '--store-db',
      '<app-data>/agenthub-edge.sqlite',
      '--addr',
      '127.0.0.1:3210',
    ],
    preflight: {
      sidecar_available: true,
      fallback_executable_available: false,
      auth_token_ready: true,
      status: 'ready',
      blocker: null,
    },
    direct_cli_spawn: false,
  },
  status: {
    running: true,
    pid: 1234,
    port: 3210,
    health_url: 'http://127.0.0.1:3210/v1/health',
    last_error: null,
    log_paths: {
      directory: '<app-data>/edge-logs',
      stdout: '<app-data>/edge-logs/local-edge.stdout.log',
      stderr: '<app-data>/edge-logs/local-edge.stderr.log',
    },
  },
  local_cli_discovery: localCliDiscoveryFixture,
  packaged_login: {
    loopback: {
      available: true,
      bind_host: '127.0.0.1',
      port: 49888,
      redirect_uri: 'http://127.0.0.1:49888/callback',
      error: null,
    },
    credential_store: {
      available: true,
      service: 'com.agenthub.desktop',
      error: null,
    },
    real_e2e: {
      status: 'proposal_only',
      reason: 'Real packaged login E2E requires approval.',
    },
  },
  log_tail: {
    stdout: ['fixture sidecar ready'],
    stderr: [],
  },
};

function renderSection(overrides: Partial<React.ComponentProps<typeof ExecutionTargetsSection>> = {}) {
  return render(
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
      localEdgeTargetSyncStatus="idle"
      cliDiscovery={localCliDiscoveryFixture}
      localEdgeDiagnostics={localEdgeDiagnostics}
      {...overrides}
    />,
  );
}

describe('ExecutionTargetsSection', () => {
  it('surfaces the missing Hub local_edge registration preflight while Local Edge is healthy', () => {
    renderSection();

    expect(screen.getByText('Local Edge target readiness')).toBeInTheDocument();
    expect(screen.getByText('Local Edge is healthy, but Hub has not registered a local_edge target for this Desktop device yet.')).toBeInTheDocument();
  });

  it('requires a current desktop device id before rendering registered readiness', () => {
    renderSection({ deviceId: null, registeredLocalEdgeTarget: registeredTarget });

    expect(screen.getByText('Desktop has not created a stable device ID yet; sign in and let device registration run first.')).toBeInTheDocument();
    expect(screen.queryByText(/Hub can route/)).not.toBeInTheDocument();
  });

  it('requires Local Edge online before rendering registered readiness', () => {
    renderSection({ edgeOnline: false, health: { status: 'offline' }, registeredLocalEdgeTarget: registeredTarget });

    expect(screen.getByText('Start Local Edge before testing Hub-driven remote control for this Desktop target.')).toBeInTheDocument();
    expect(screen.queryByText(/Hub can route/)).not.toBeInTheDocument();
  });

  it('distinguishes an offline or stale Hub local edge target from ready', () => {
    renderSection({
      registeredLocalEdgeTarget: {
        ...registeredTarget,
        is_online: false,
        health_state: 'healthy',
      },
    });

    expect(screen.getByText('Hub has this Desktop target, but it is currently offline or stale.')).toBeInTheDocument();
    expect(screen.queryByText(/Hub can route/)).not.toBeInTheDocument();
  });

  it('distinguishes a degraded Hub local edge target from ready', () => {
    renderSection({
      registeredLocalEdgeTarget: {
        ...registeredTarget,
        health_state: 'degraded',
      },
    });

    expect(screen.getByText('Hub has this Desktop target, but its health is degraded.')).toBeInTheDocument();
    expect(screen.queryByText(/Hub can route/)).not.toBeInTheDocument();
  });

  it('distinguishes a signed-out readiness state', () => {
    renderSection({ hubSessionActive: false });

    expect(screen.getByText('Sign in to TokenDance ID so Hub can register this Desktop as a remote-control target.')).toBeInTheDocument();
  });

  it('distinguishes loading and error readiness states', () => {
    const { rerender } = render(
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
        hubTargetsLoading
      />,
    );

    expect(screen.getByText('Checking Hub for the registered local_edge execution target for this Desktop device.')).toBeInTheDocument();

    rerender(
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
        hubTargetsError
      />,
    );

    expect(screen.getByText('Desktop could not read Hub execution targets. Local runs still use Local Edge, but Hub remote control cannot be confirmed.')).toBeInTheDocument();
  });

  it('does not report missing while Hub target inventory is pagination-limited', () => {
    renderSection({ hubTargetsPaginationLimited: true });

    expect(screen.getByText('Hub target inventory is still paginated; Desktop cannot confirm whether this device target exists yet.')).toBeInTheDocument();
    expect(screen.queryByText('Local Edge is healthy, but Hub has not registered a local_edge target for this Desktop device yet.')).not.toBeInTheDocument();
  });

  it('offers a create action when Local Edge is online and Hub registration is missing', () => {
    const onSync = vi.fn();
    renderSection({ onSyncLocalEdgeTarget: onSync });

    fireEvent.click(screen.getByRole('button', { name: 'Register Local Edge target' }));

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('offers an update action for an already registered local_edge target', () => {
    const onSync = vi.fn();
    renderSection({ registeredLocalEdgeTarget: registeredTarget, onSyncLocalEdgeTarget: onSync });

    fireEvent.click(screen.getByRole('button', { name: 'Sync Local Edge target' }));

    expect(onSync).toHaveBeenCalledTimes(1);
  });

  it('shows sync progress and error states without changing Local Edge readiness copy', () => {
    const { rerender } = render(
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
        localEdgeTargetSyncStatus="syncing"
        onSyncLocalEdgeTarget={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Syncing Local Edge target...' })).toBeDisabled();

    rerender(
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
        localEdgeTargetSyncStatus="error"
        localEdgeTargetSyncError="HTTP 409"
        onSyncLocalEdgeTarget={vi.fn()}
      />,
    );

    expect(screen.getByText('Hub target sync failed: HTTP 409')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Local Edge target' })).toBeEnabled();
  });

  it('shows no-spend local CLI discovery with versions, paths, and readiness manifest in settings diagnostics', () => {
    renderSection();

    expect(screen.getByText('Local CLI discovery')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Readiness manifest: docs/audit/p0-edge-cli-real-readiness.md')).toBeInTheDocument();
    expect(screen.getByText((_, element) => element?.textContent === 'Readiness script: scripts/verify-edge-cli-real-readiness.ps1')).toBeInTheDocument();

    expect(screen.getByText('Codex CLI')).toBeInTheDocument();
    expect(screen.getByText('version: 0.27.0')).toBeInTheDocument();
    expect(screen.getByText('path: C:/Users/Ding/AppData/Roaming/npm/codex.cmd')).toBeInTheDocument();

    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('version: 2.1.4')).toBeInTheDocument();
    expect(screen.getByText('OpenCode')).toBeInTheDocument();
    expect(screen.getByText('version: 0.8.3')).toBeInTheDocument();

    expect(screen.getAllByText('no-spend')).toHaveLength(3);
    expect(screen.getAllByText('installed')).toHaveLength(3);
    expect(screen.getByText(/does not execute runs, prompt-bearing commands, model calls, or secrets/i)).toBeInTheDocument();
  });

  it('shows Tauri package readiness and sidecar launch smoke without process-spawn details', () => {
    renderSection();

    expect(screen.getByText('Tauri package readiness')).toBeInTheDocument();
    expect(screen.getByText(/Local Edge sidecar, SQLite app-data store, and launch smoke/i)).toBeInTheDocument();
    expect(screen.getByText('status: running')).toBeInTheDocument();
    expect(screen.getByText('sidecar: available')).toBeInTheDocument();
    expect(screen.getByText('fallback executable: missing')).toBeInTheDocument();
    expect(screen.getByText('auth token: ready')).toBeInTheDocument();
    expect(screen.getByText('store: sqlite <app-data>/agenthub-edge.sqlite')).toBeInTheDocument();
    expect(screen.getByText('health: http://127.0.0.1:3210/v1/health')).toBeInTheDocument();
    expect(screen.getByText('logs: <app-data>/edge-logs')).toBeInTheDocument();
    expect(screen.getByText('sidecar launch smoke: fixture sidecar ready')).toBeInTheDocument();
    expect(screen.getByText('direct CLI spawn: disabled')).toBeInTheDocument();

    const visibleText = document.body.textContent ?? '';
    expect(visibleText).not.toMatch(/sidecar_args|--store-db|cliPath|AGENTHUB_EDGE_AUTH_TOKEN|bearer|access_token/i);
  });
});
