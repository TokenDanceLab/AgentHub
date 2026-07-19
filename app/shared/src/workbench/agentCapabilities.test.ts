import { describe, expect, it } from 'vitest';
import {
  buildAgentCapabilityContractFromConfig,
  buildAgentCapabilitySummary,
  validateAgentCapabilityContract,
} from './agentCapabilities';
import { WORKBENCH_AGENT_PROFILE_FIXTURES } from './agentProfileCatalog';

describe('agentCapabilities', () => {
  it('projects the Builder fixture into the visible Agent configuration readiness contract', () => {
    const builder = WORKBENCH_AGENT_PROFILE_FIXTURES.find((agent) => agent.id === 'builder-agent');
    expect(builder).toBeDefined();

    const contract = buildAgentCapabilityContractFromConfig(builder!);
    const summary = buildAgentCapabilitySummary(contract);

    expect(contract).toMatchObject({
      agentsMd: { id: 'agents-md', status: 'enabled' },
      avatar: { id: 'agenthub:avatar/builder', status: 'enabled' },
      memoryPolicy: {
        sources: ['agents-md', 'project-memory', 'thread-context'],
        retention: 'project-policy',
      },
      mcpServers: [
        { id: 'filesystem', status: 'enabled' },
        { id: 'github', status: 'enabled' },
      ],
      skills: expect.arrayContaining([
        { id: 'Read File', label: 'Read File', status: 'enabled' },
      ]),
      toolAllowlist: expect.arrayContaining(['Shell']),
    });
    expect(summary).toMatchObject({
      agentsMd: '工作区说明已配置',
      memory: expect.any(String),
      mcp: '2/2 MCP 已启用',
      readiness: 'ready',
      issues: [],
    });
    expect(validateAgentCapabilityContract(contract).valid).toBe(true);
  });

  it('marks Hub profiles without AGENTS.md, avatar, memory, or tools as partial instead of silently ready', () => {
    const contract = buildAgentCapabilityContractFromConfig({
      id: 'hub-agent',
      name: 'Hub Agent',
      role: 'Hub profile',
      engine: 'codex',
      model: 'gpt-5-codex',
      mode: 'Reasoning high',
      approval: 'default',
      scope: 'default',
      state: 'ready',
      skills: [],
      tools: {},
    });

    const summary = buildAgentCapabilitySummary(contract);

    expect(summary.readiness).toBe('partial');
    expect(summary.issues).toEqual([
      'agents-md:agents-md',
      'avatar:agenthub:avatar/hub-agent',
      'memory:disabled',
      'tools:empty',
    ]);
    expect(validateAgentCapabilityContract(contract).valid).toBe(false);
  });
});
