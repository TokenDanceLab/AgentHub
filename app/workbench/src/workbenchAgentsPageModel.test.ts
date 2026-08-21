import { describe, expect, it } from 'vitest';
import type { AgentConfig } from './pages/AgentsPage';
import {
  buildAgentRecentShortcuts,
  buildAgentsPageDerivedModel,
  buildModelRoutes,
  buildToolMatrixAgents,
  countConfirmTools,
  splitAgentMarketTemplates,
} from './workbenchAgentsPageModel';

function agent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'a1',
    name: 'Builder',
    role: 'coder',
    engine: 'codex',
    model: 'openai / gpt-5',
    mode: 'Reasoning medium',
    approval: 'ask',
    scope: 'workspace-write',
    state: 'ready',
    skills: [],
    tools: {
      'Read File': '允许',
      Shell: '需确认',
    },
    ...overrides,
  };
}

describe('workbenchAgentsPageModel', () => {
  it('counts tools that require confirmation across agents', () => {
    const tools = ['Read File', 'Shell', 'Write File'];
    const agents = [
      agent(),
      agent({
        id: 'a2',
        tools: {
          'Read File': '需确认',
          Shell: '需确认',
          'Write File': '禁止',
        },
      }),
    ];
    expect(countConfirmTools(agents, tools)).toBe(3);
  });

  it('builds model routes and tool matrix rows', () => {
    const routes = buildModelRoutes([agent()]);
    expect(routes).toEqual([
      expect.objectContaining({
        agentId: 'a1',
        agentName: 'Builder',
        role: 'coder',
        mode: 'Reasoning medium',
        model: 'openai / gpt-5',
      }),
    ]);
    expect(routes[0]?.agentInitials).toBeTruthy();
    expect(routes[0]?.agentColor).toBeTruthy();

    const matrix = buildToolMatrixAgents([agent()]);
    expect(matrix[0]).toEqual(expect.objectContaining({
      id: 'a1',
      name: 'Builder',
      permissions: agent().tools,
    }));
  });

  it('builds recent shortcuts for mock vs real agents', () => {
    expect(buildAgentRecentShortcuts(false, [agent()])).toEqual([
      'Builder 权限更新',
      'Browser QA 已安装',
      'DeepSeek-V4-Pro 路由',
    ]);
    expect(buildAgentRecentShortcuts(true, [agent({ name: 'Reviewer' })])).toEqual([
      'Reviewer 已同步',
    ]);
  });

  it('splits market templates and assembles derived model', () => {
    const market = splitAgentMarketTemplates([
      { name: 'A', description: '', category: '', detail: '' },
      { name: 'B', description: '', category: '', detail: '' },
      { name: 'C', description: '', category: '', detail: '' },
      { name: 'D', description: '', category: '', detail: '' },
    ]);
    expect(market.marketFeatured.map((item) => item.name)).toEqual(['A', 'B', 'C']);
    expect(market.marketTemplates.map((item) => item.name)).toEqual(['D']);

    const model = buildAgentsPageDerivedModel(
      [
        agent({ state: 'running' }),
        agent({
          id: 'a2',
          state: 'idle',
          model: 'local',
          tools: { Shell: '允许' },
        }),
      ],
      ['Shell'],
      true,
    );
    expect(model.installedCount).toBe(2);
    expect(model.runnableCount).toBe(1);
    expect(model.defaultModelLabel).toBe('openai / gpt-5');
    expect(model.confirmCount).toBe(1);
    expect(model.recentShortcuts).toEqual(['Builder 已同步', 'Builder 已同步']);
    expect(model.modelRoutes).toHaveLength(2);
    expect(model.toolMatrixAgents).toHaveLength(2);
  });
});
