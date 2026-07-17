import { describe, expect, it } from 'vitest';
import {
  normalizeSpecId,
  toApprovalPolicySpec,
  toMCPServerSpec,
  toMemoryPolicySpec,
  toTargetPreferenceSpec,
  toToolSpecId,
  toolPermissionsFromAllowlist,
  uniqueSorted,
} from './agentProfileCatalogHelpers';
import type { AgentConfig } from './pages/AgentsPage';

describe('agentProfileCatalogHelpers', () => {
  it('normalizes free-form labels into stable fixture ids', () => {
    expect(normalizeSpecId('Write File')).toBe('write_file');
    expect(normalizeSpecId('  Git Diff  ')).toBe('git_diff');
    expect(normalizeSpecId('@@@')).toBe('fixture');
    expect(toToolSpecId('Browser Screenshot')).toBe('browser_screenshot');
  });

  it('builds allowlist tool permissions and unique sorted option lists', () => {
    expect(toolPermissionsFromAllowlist(['Read File', 'Shell'])).toEqual({
      'Read File': '允许',
      Shell: '允许',
    });
    expect(uniqueSorted(['Shell', 'Read File', 'Shell', 'Git Diff'])).toEqual([
      'Git Diff',
      'Read File',
      'Shell',
    ]);
  });

  it('projects agent config slices into AgentSpec fixture policy shapes', () => {
    const agent: AgentConfig = {
      id: 'builder-agent',
      name: 'Builder',
      role: '代码实现',
      engine: 'Claude Code',
      model: 'DeepSeek-V4-Pro',
      mode: 'Plan -> Code',
      approval: '写文件和 Shell 默认进入确认队列',
      approvalMode: 'workspace-write',
      approvalRiskRules: [
        { match: 'write workspace files', decision: 'require-approval' },
        { match: 'read workspace files', decision: 'allow' },
      ],
      scope: '当前项目',
      state: 'running',
      skills: ['Read File'],
      mcpServers: ['filesystem'],
      toolAllowlist: ['Read File', 'Write File'],
      memorySources: ['agents-md', 'project-memory'],
      memoryRetention: 'project-policy',
      memorySummary: '读取 AGENTS.md',
      targetPreferences: ['local-edge', 'remote-edge'],
      tools: {
        'Read File': '允许',
        'Write File': '需确认',
      },
    };

    expect(toMCPServerSpec('github')).toEqual({
      id: 'github',
      transport: 'stdio',
      command: 'mcp-server-github',
    });
    expect(toMemoryPolicySpec(agent)).toEqual({
      mode: 'project',
      retention: 'project-policy',
    });
    expect(toApprovalPolicySpec(agent)).toEqual({
      mode: 'workspace-write',
      requireApprovalFor: ['write_file', 'write_workspace_files'],
    });
    expect(toTargetPreferenceSpec(agent)).toEqual({
      mode: 'local-edge',
      health: 'fixture-ready',
    });

    const idleAgent: AgentConfig = {
      ...agent,
      state: 'idle',
      memorySources: [],
      memoryRetention: 'disabled',
      tools: {},
      approvalRiskRules: [],
    };
    // exactOptionalPropertyTypes: omit optional fields rather than assigning undefined
    delete (idleAgent as { targetPreferences?: string[] }).targetPreferences;
    expect(toMemoryPolicySpec(idleAgent)).toEqual({
      mode: 'none',
      retention: 'disabled',
    });
    expect(toApprovalPolicySpec(idleAgent)).toEqual({
      mode: 'workspace-write',
    });
    expect(toTargetPreferenceSpec(idleAgent)).toEqual({
      mode: 'local-edge',
      health: 'fixture-pending',
    });
  });
});
