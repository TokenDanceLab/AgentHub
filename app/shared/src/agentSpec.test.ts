import { describe, expect, it } from 'vitest';
import { buildAgentHubAgentSpecV1 } from './agentSpec';

describe('AgentHubAgentSpec v1', () => {
  it('exports the Builder draft as a fixture-only AgentHubAgentSpec v1 contract', () => {
    const spec = buildAgentHubAgentSpecV1({
      id: 'fixture-builder',
      name: 'Fixture Builder',
      description: 'Builds fixture-only AgentHub demos.',
      avatar: { type: 'emoji', value: 'B' },
      runtimeProfile: 'codex-local-profile',
      runtimeId: 'codex',
      provider: 'tokendance-gateway',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      temperature: 0.5,
      maxOutputTokens: 8192,
      skills: ['agenthub-builder', 'code-review'],
      mcpServers: [{ id: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' }],
      toolAllowlist: ['read_file', 'write_file', 'grep'],
      memoryPolicy: { mode: 'project', retention: 'ephemeral-fixture' },
      approvalPolicy: { mode: 'workspace-write', requireApprovalFor: ['write_file'] },
      targetPreference: { mode: 'local-edge', targetId: 'local-edge-fixture', health: 'fixture-healthy' },
    });

    expect(spec).toEqual({
      schema_version: 'agenthub.agent_spec.v1',
      id: 'fixture-builder',
      name: 'Fixture Builder',
      description: 'Builds fixture-only AgentHub demos.',
      avatar: { type: 'emoji', value: 'B' },
      runtime: {
        id: 'codex',
        profile: 'codex-local-profile',
        provider: 'tokendance-gateway',
        model: 'deepseek-v4-flash',
        reasoning_effort: 'high',
        temperature: 0.5,
        max_output_tokens: 8192,
      },
      skills: ['agenthub-builder', 'code-review'],
      mcp_servers: [{ id: 'filesystem', transport: 'stdio', command: 'mcp-server-filesystem' }],
      tool_allowlist: ['read_file', 'write_file', 'grep'],
      memory_policy: { mode: 'project', retention: 'ephemeral-fixture' },
      approval_policy: { mode: 'workspace-write', require_approval_for: ['write_file'] },
      target_preference: { mode: 'local-edge', target_id: 'local-edge-fixture', health: 'fixture-healthy' },
      fixture: {
        mode: 'fixture-only',
        no_spend: true,
        live_runtime_allowed: false,
      },
    });
  });
});
