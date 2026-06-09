import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@shared/types';
import {
  formatDesktopEdgeDispatchDiagnostics,
  mapEdgeAgentsToWorkbenchAgents,
  mapLocalEdgeExecutionTarget,
  resolveDesktopEdgeDispatchReadiness,
  type EdgeRuntimeInventorySnapshot,
} from './edgeCapabilityMapper';

const capabilities: AgentInfo['capabilities'] = {
  streaming: true,
  toolCalls: true,
  fileChanges: true,
  thinkingVisible: true,
  multiTurn: false,
  mcpIntegration: true,
  permissionHooks: true,
  subAgentSpawn: false,
};

const localEdgeTarget = {
  id: 'local-edge' as const,
  type: 'local_edge' as const,
  name: 'Local Edge' as const,
  status: 'healthy' as const,
  route: 'local-edge-api' as const,
  runnerCount: 1,
  onlineRunnerCount: 1,
  agentCount: 1,
  modelCount: 1,
  capabilityIds: ['streaming'],
};

const registeredLocalEdgeTarget = {
  id: 'hub-target-local-1',
  device_id: 'desktop-device-1',
  name: 'Current Desktop Local Edge',
  target_type: 'local_edge' as const,
  workspace_allowlist: [],
  trust_level: 'local' as const,
  health_state: 'healthy' as const,
  is_online: true,
};

const hostReadiness = {
  running: true,
  pid: 1234,
  port: 3210,
  sidecar_name: 'agenthub-edge' as const,
  target_id: 'local-edge' as const,
  route: 'local-edge-api' as const,
  bind_addr: '127.0.0.1:3210',
  health_url: 'http://127.0.0.1:3210/v1/health',
  store_db_policy: '<app-data>/agenthub-edge.sqlite' as const,
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
    status: 'ready' as const,
    blocker: null,
  },
  direct_cli_spawn: false as const,
};

describe('edgeCapabilityMapper', () => {
  it('maps Edge agents and model catalog into shared workbench agents without Hub or Tauri details', () => {
    const agents = mapEdgeAgentsToWorkbenchAgents(
      [{
        id: 'codex-local',
        name: 'Codex Local',
        description: 'Local Codex adapter',
        runtimeId: 'codex',
        status: 'available',
        capabilities,
      }],
      {
        items: [{
          id: 'codex-gpt-5.1',
          value: 'gpt-5.1-codex',
          label: 'GPT-5.1 Codex',
          provider: 'tokendance-gateway',
          runtimeId: 'codex',
          sourceId: 'codex',
          sourceLabel: 'Codex',
          status: 'available',
          default: true,
        }],
        sources: [],
      },
    );

    expect(agents).toEqual([expect.objectContaining({
      id: 'codex-local',
      name: 'Codex Local',
      description: 'Local Codex adapter',
      status: 'available',
      runtimeId: 'codex',
      model: 'gpt-5.1-codex',
      provider: 'tokendance-gateway',
      skills: expect.arrayContaining(['streaming', 'tool-calls', 'file-changes', 'mcp', 'permission-hooks']),
    })]);
    expect(JSON.stringify(agents)).not.toMatch(/https?:|tauri|access_token|bearer/i);
  });

  it('summarizes the Local Edge execution target from Edge-only inventory', () => {
    const snapshot: EdgeRuntimeInventorySnapshot = {
      edgeOnline: true,
      healthStatus: 'healthy',
      runners: [
        { id: 'runner-1', status: 'online' },
        { id: 'runner-2', status: 'offline' },
      ],
      agents: [{
        id: 'codex-local',
        name: 'Codex Local',
        status: 'available',
        capabilities,
      }],
      modelCatalog: {
        items: [{
          id: 'codex-gpt-5.1',
          value: 'gpt-5.1-codex',
          label: 'GPT-5.1 Codex',
          sourceId: 'codex',
          sourceLabel: 'Codex',
          status: 'available',
        }],
        sources: [],
      },
    };

    expect(mapLocalEdgeExecutionTarget(snapshot)).toEqual(expect.objectContaining({
      id: 'local-edge',
      type: 'local_edge',
      name: 'Local Edge',
      status: 'healthy',
      route: 'local-edge-api',
      runnerCount: 2,
      onlineRunnerCount: 1,
      agentCount: 1,
      modelCount: 1,
    }));
  });

  it('marks dispatch ready only when Desktop device, Hub local_edge target, Local Edge health, and host preflight match', () => {
    const readiness = resolveDesktopEdgeDispatchReadiness({
      hubSessionActive: true,
      deviceId: 'desktop-device-1',
      edgeOnline: true,
      localEdgeTarget,
      registeredLocalEdgeTarget,
      hostReadiness,
    });

    expect(readiness).toEqual(expect.objectContaining({
      dispatchReady: true,
      disabledReason: null,
      dispatchTarget: {
        targetId: 'hub-target-local-1',
        deviceId: 'desktop-device-1',
      },
      targetId: 'hub-target-local-1',
      deviceId: 'desktop-device-1',
      healthUrl: 'http://127.0.0.1:3210/v1/health',
      preflightStatus: 'ready',
      storeDbPolicy: '<app-data>/agenthub-edge.sqlite',
    }));
    expect(JSON.stringify(readiness)).not.toMatch(/sidecar_args|command|cliPath|AGENTHUB_EDGE_AUTH_TOKEN|bearer|access_token/i);
  });

  it.each([
    ['signed-out', { hubSessionActive: false }],
    ['missing-device', { deviceId: null }],
    ['local-edge-offline', { edgeOnline: false }],
    ['missing-local-edge-target', { registeredLocalEdgeTarget: null }],
    ['local-edge-target-mismatch', { registeredLocalEdgeTarget: { ...registeredLocalEdgeTarget, device_id: 'other-device' } }],
    ['local-edge-target-degraded', { registeredLocalEdgeTarget: { ...registeredLocalEdgeTarget, health_state: 'degraded' as const } }],
    ['local-edge-target-unknown', { registeredLocalEdgeTarget: { ...registeredLocalEdgeTarget, health_state: 'unknown' as const } }],
    ['host-preflight-blocked', { hostReadiness: { ...hostReadiness, preflight: { ...hostReadiness.preflight, status: 'blocked' as const, blocker: 'sidecar missing' } } }],
  ])('disables dispatch with reason %s', (reason, overrides) => {
    const readiness = resolveDesktopEdgeDispatchReadiness({
      hubSessionActive: true,
      deviceId: 'desktop-device-1',
      edgeOnline: true,
      localEdgeTarget,
      registeredLocalEdgeTarget,
      hostReadiness,
      ...overrides,
    });

    expect(readiness.dispatchReady).toBe(false);
    expect(readiness.dispatchTarget).toBeNull();
    expect(readiness.disabledReason).toBe(reason);
  });

  it('formats redacted dispatch diagnostics with disabled reason and target metadata', () => {
    const readiness = resolveDesktopEdgeDispatchReadiness({
      hubSessionActive: true,
      deviceId: 'desktop-device-1',
      edgeOnline: true,
      localEdgeTarget,
      registeredLocalEdgeTarget: { ...registeredLocalEdgeTarget, is_online: false },
      hostReadiness,
    });

    const text = formatDesktopEdgeDispatchDiagnostics(readiness);

    expect(text).toContain('dispatch ready: false');
    expect(text).toContain('dispatch disabled reason: local-edge-target-offline');
    expect(text).toContain('target id: hub-target-local-1');
    expect(text).toContain('device id: desktop-device-1');
    expect(text).toContain('health: http://127.0.0.1:3210/v1/health');
    expect(text).toContain('preflight: ready');
    expect(text).toContain('store: <app-data>/agenthub-edge.sqlite');
    expect(text).toContain('logs: <app-data>/edge-logs');
    expect(text).not.toMatch(/sidecar_args|command|cliPath|AGENTHUB_EDGE_AUTH_TOKEN|bearer|access_token/i);
  });
});
