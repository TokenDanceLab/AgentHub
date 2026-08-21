import { describe, expect, it } from 'vitest';
import type { WorkbenchAgent } from '@shared/platform';
import {
  formatAgentTargetPreference,
  workbenchAgentStateToAgentState,
  workbenchAgentToAgentConfig,
} from './workbenchAgentMapping';

function baseAgent(overrides: Partial<WorkbenchAgent> = {}): WorkbenchAgent {
  return {
    id: 'agent-1',
    name: 'Builder',
    status: 'available',
    ...overrides,
  } as WorkbenchAgent;
}

describe('workbenchAgentMapping', () => {
  it('maps workbench agent status to AgentsPage state', () => {
    expect(workbenchAgentStateToAgentState('available')).toBe('ready');
    expect(workbenchAgentStateToAgentState('configuring')).toBe('waiting');
    expect(workbenchAgentStateToAgentState('unavailable')).toBe('idle');
  });

  it('formats target preference from array and object forms', () => {
    expect(formatAgentTargetPreference([' local_edge ', 'other'])).toBe('local_edge');
    expect(formatAgentTargetPreference({ target_type: 'local_edge', target_id: 'edge-1' })).toBe('local_edge · edge-1');
    expect(formatAgentTargetPreference({ work_dir: '/tmp/ws' })).toBe('/tmp/ws');
    expect(formatAgentTargetPreference(undefined)).toBeUndefined();
  });

  it('maps workbench agent fields into AgentConfig', () => {
    const config = workbenchAgentToAgentConfig(baseAgent({
      description: 'Hub profile',
      runtimeId: 'codex',
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'high',
      approvalPolicy: 'ask-before-write',
      permissionMode: 'workspace-write',
      skills: ['docs'],
      toolAllowlist: ['Read File'],
      targetPreferences: { target_type: 'local_edge', target_id: 'fixture' },
    }));

    expect(config.id).toBe('agent-1');
    expect(config.name).toBe('Builder');
    expect(config.role).toBe('Hub profile');
    expect(config.engine).toBe('codex');
    expect(config.model).toBe('openai / gpt-5');
    expect(config.mode).toBe('推理 high');
    expect(config.approval).toBe('ask-before-write');
    expect(config.scope).toBe('workspace-write');
    expect(config.targetPreference).toBe('local_edge · fixture');
    expect(config.state).toBe('ready');
    expect(config.skills).toEqual(['docs']);
  });

  it('keeps role free of Runtime/Model stuffing (#1285)', () => {
    const config = workbenchAgentToAgentConfig(baseAgent({
      description: '审查高风险补丁',
      runtimeId: 'codex',
      provider: 'openai',
      model: 'gpt-5.5',
    }));

    expect(config.role).toBe('审查高风险补丁');
    expect(config.role).not.toMatch(/\bRuntime\s*:/i);
    expect(config.role).not.toMatch(/\bModel\s*:/i);
    expect(config.engine).toBe('codex');
    expect(config.model).toBe('openai / gpt-5.5');
  });
});
