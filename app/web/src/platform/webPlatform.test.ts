import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '@shared/types';
import { agentInfoToWorkbenchAgent, resolveWebWorkbenchAgents, webAgents } from './webPlatform';

describe('webPlatform workbench agent mapping', () => {
  it('maps Hub AgentInfo into shared workbench agents', () => {
    const agent: AgentInfo = {
      id: 'agent-profile-1',
      name: 'Hub Builder',
      description: 'Runtime: claude-code - Model: glm-5.1',
      profileId: 'agent-profile-1',
      runtimeId: 'claude-code',
      model: 'glm-5.1',
      status: 'available',
      capabilities: {
        streaming: true,
        toolCalls: true,
        fileChanges: true,
        thinkingVisible: true,
        multiTurn: true,
        mcpIntegration: true,
        permissionHooks: true,
        subAgentSpawn: true,
      },
    };

    expect(agentInfoToWorkbenchAgent(agent)).toEqual({
      id: 'agent-profile-1',
      name: 'Hub Builder',
      description: 'Runtime: claude-code - Model: glm-5.1',
      runtimeId: 'claude-code',
      model: 'glm-5.1',
      status: 'available',
    });
  });

  it('keeps preview fallback agents until Hub profiles are available', () => {
    expect(resolveWebWorkbenchAgents(undefined)).toBe(webAgents);
    expect(resolveWebWorkbenchAgents([])).toBe(webAgents);
  });
});
