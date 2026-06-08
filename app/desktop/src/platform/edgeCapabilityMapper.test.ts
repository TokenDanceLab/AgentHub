import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@shared/types';
import {
  mapEdgeAgentsToWorkbenchAgents,
  mapLocalEdgeExecutionTarget,
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
});
