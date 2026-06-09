import { describe, expect, it } from 'vitest';
import { formatLocalEdgeDiagnosticText } from './useDesktopCommands';
import type { DesktopEdgeDispatchReadiness } from '@/platform/edgeCapabilityMapper';
import type { DesktopLocalEdgeDiagnostics } from '@/platform/desktopPlatform';

const diagnostics: DesktopLocalEdgeDiagnostics = {
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
      '--runner-profile',
      'claude-code',
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
    stdout: ['edge ready'],
    stderr: [],
  },
};

const dispatchReadiness: DesktopEdgeDispatchReadiness = {
  dispatchReady: false,
  disabledReason: 'local-edge-target-degraded',
  dispatchTarget: null,
  targetBinding: {
    expectedTargetId: 'local-edge',
    observedTargetId: 'hub-target-local-1',
    expectedEdgeDeviceId: 'desktop-device-1',
    observedEdgeDeviceId: 'desktop-device-1',
    status: 'mismatch',
  },
  route: 'local-edge-api',
  targetType: 'local_edge',
  targetId: 'hub-target-local-1',
  targetName: 'Current Desktop Local Edge',
  deviceId: 'desktop-device-1',
  localEdgeStatus: 'healthy',
  hubTargetHealthState: 'degraded',
  hubTargetOnline: true,
  healthUrl: 'http://127.0.0.1:3210/v1/health',
  preflightStatus: 'ready',
  preflightBlocker: null,
  storeDbPolicy: '<app-data>/agenthub-edge.sqlite',
  logPaths: {
    directory: '<app-data>/edge-logs',
    stdout: '<app-data>/edge-logs/local-edge.stdout.log',
    stderr: '<app-data>/edge-logs/local-edge.stderr.log',
  },
  directCliSpawn: false,
};

describe('formatLocalEdgeDiagnosticText', () => {
  it('includes dispatch disabled reason, target metadata, and redacted host readiness details', () => {
    const text = formatLocalEdgeDiagnosticText(diagnostics, dispatchReadiness);

    expect(text).toContain('Local Edge host');
    expect(text).toContain('dispatch ready: false');
    expect(text).toContain('dispatch disabled reason: local-edge-target-degraded');
    expect(text).toContain('target id: hub-target-local-1');
    expect(text).toContain('device id: desktop-device-1');
    expect(text).toContain('health: http://127.0.0.1:3210/v1/health');
    expect(text).toContain('preflight: ready');
    expect(text).toContain('store backend: sqlite');
    expect(text).toContain('store: <app-data>/agenthub-edge.sqlite');
    expect(text).toContain('store readiness manifest: agenthub-edge-sqlite-readiness-v1');
    expect(text).toContain('expected store migration: 4');
    expect(text).toContain('logs: <app-data>/edge-logs');
    expect(text).toContain('stdout: <app-data>/edge-logs/local-edge.stdout.log');
    expect(text).toContain('stderr: <app-data>/edge-logs/local-edge.stderr.log');
    expect(text).not.toMatch(/sidecar_args|command|cliPath|AGENTHUB_EDGE_AUTH_TOKEN|bearer|access_token/i);
  });
});
