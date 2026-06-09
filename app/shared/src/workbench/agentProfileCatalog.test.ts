import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILE_CATALOG,
  WORKBENCH_AGENT_MARKET_FIXTURES,
  WORKBENCH_AGENT_PROFILE_FIXTURES,
  agentProfileCatalogToConfig,
} from './agentProfileCatalog';

describe('agentProfileCatalog', () => {
  it('declares the AgentProfile configuration fields required by the G2a/G2b fixture contract', () => {
    expect(AGENT_PROFILE_CATALOG.length).toBeGreaterThanOrEqual(4);

    for (const profile of AGENT_PROFILE_CATALOG) {
      expect(profile).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        avatarRef: expect.stringMatching(/^agenthub:avatar\//),
        runtime: {
          runtimeId: expect.any(String),
          provider: expect.any(String),
          model: expect.any(String),
          adapterMode: expect.any(String),
        },
        configuration: {
          skills: expect.any(Array),
          mcpServers: expect.any(Array),
          toolAllowlist: expect.any(Array),
          approval: {
            mode: expect.any(String),
            riskRules: expect.any(Array),
          },
          memory: {
            sources: expect.any(Array),
            retention: expect.any(String),
            summary: expect.any(String),
          },
          targetPreferences: expect.any(Array),
        },
      });
      expect(profile.configuration.skills.length).toBeGreaterThan(0);
      expect(profile.configuration.toolAllowlist.length).toBeGreaterThan(0);
      expect(profile.configuration.memory.sources.length).toBeGreaterThan(0);
      expect(profile.configuration.targetPreferences.length).toBeGreaterThan(0);
    }
  });

  it('projects fixture profiles to Agent Builder and market rows without losing config summaries', () => {
    const builder = AGENT_PROFILE_CATALOG.find((profile) => profile.id === 'builder-agent');
    expect(builder).toBeDefined();

    const config = agentProfileCatalogToConfig(builder!);
    expect(config).toMatchObject({
      id: 'builder-agent',
      runtimeId: 'claude-code',
      provider: 'TokenDance Gateway',
      model: 'DeepSeek-V4-Pro',
      approvalMode: 'workspace-write',
      memoryRetention: 'project-policy',
    });
    expect(config.skills).toContain('Write File');
    expect(config.mcpServers).toContain('filesystem');
    expect(config.toolAllowlist).toContain('Shell');
    expect(config.memorySources).toContain('agents-md');
    expect(config.targetPreferences).toContain('local-edge');

    expect(WORKBENCH_AGENT_PROFILE_FIXTURES.find((profile) => profile.id === 'builder-agent')).toEqual(config);
    expect(WORKBENCH_AGENT_MARKET_FIXTURES.find((profile) => profile.name === 'Builder')).toMatchObject({
      runtime: 'Claude Code',
      provider: 'TokenDance Gateway',
      model: 'DeepSeek-V4-Pro',
      memorySummary: expect.stringContaining('AGENTS.md'),
      approvalSummary: expect.stringContaining('确认'),
    });
  });
});
