import type { WorkbenchAgent } from '@shared/platform';
import type { AgentConfig, ToolPermission } from './pages/AgentsPage';
import { WORKBENCH_MOCK_AGENT_TOOL_OPTIONS } from './mockData';

export function createMarketInstalledAgent(
  name: string,
  description: string,
  category: string,
  index: number,
): AgentConfig {
  const normalizedName = name.trim() || `市场 Agent ${index}`;
  const runtime = normalizedName.toLowerCase().includes('browser') ? 'claude-code' : 'codex';
  const model = runtime === 'claude-code' ? 'anthropic / sonnet' : 'openai / gpt-5-codex';
  return {
    id: `installed-market-${index}`,
    name: normalizedName,
    role: description.trim() || 'Agent 市场安装模板',
    icon: runtime,
    engine: runtime,
    model,
    mode: category === '测试' ? 'Review' : 'Reasoning medium',
    approval: category === '安全' ? 'on-request' : 'ask-before-write',
    scope: category === '测试' ? 'read-only' : 'workspace-write',
    targetPreference: 'local_edge · fixture-local-edge',
    state: 'ready',
    skills: [category, 'Agent Market', 'Install Fixture'].filter(Boolean),
    tools: {
      'Read File': '允许',
      'Git Diff': '允许',
      'Write File': category === '文档' ? '需确认' : '禁止',
      Shell: '需确认',
      'Browser Screenshot': category === '测试' ? '允许' : '需确认',
    },
  };
}

export function workbenchAgentStateToAgentState(status: WorkbenchAgent['status']): AgentConfig['state'] {
  switch (status) {
    case 'available':
      return 'ready';
    case 'configuring':
      return 'waiting';
    case 'unavailable':
    default:
      return 'idle';
  }
}

export function toolPermissionFromAgent(agent: WorkbenchAgent): Record<string, ToolPermission> {
  const allowedTools = new Set(agent.toolAllowlist ?? []);
  if (allowedTools.size === 0) return {};
  return Object.fromEntries(
    WORKBENCH_MOCK_AGENT_TOOL_OPTIONS.map((tool) => [
      tool,
      allowedTools.has(tool) ? '允许' : '需确认',
    ]),
  ) as Record<string, ToolPermission>;
}

export function formatAgentTargetPreference(value: string[] | Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.find((item) => item.trim())?.trim();
  const targetId = typeof value.target_id === 'string' ? value.target_id.trim() : '';
  const targetType = typeof value.target_type === 'string' ? value.target_type.trim() : '';
  const workDir = typeof value.work_dir === 'string' ? value.work_dir.trim() : '';
  const primary = targetId || targetType || workDir;
  if (!primary) return undefined;
  if (targetId && targetType) return `${targetType} · ${targetId}`;
  return primary;
}

export function workbenchAgentToAgentConfig(agent: WorkbenchAgent): AgentConfig {
  const runtimeLabel = agent.runtimeId?.trim() || 'Hub 配置档案';
  const providerLabel = agent.provider?.trim();
  const modelLabel = [providerLabel, agent.model?.trim()].filter(Boolean).join(' / ') || '未配置模型';
  const targetPreference = formatAgentTargetPreference(agent.targetPreferences);
  return {
    id: agent.id,
    name: agent.name,
    role: agent.description?.trim() || 'Hub 配置档案',
    ...(agent.icon ? { icon: agent.icon } : {}),
    engine: runtimeLabel,
    runtimeId: agent.runtimeId,
    provider: agent.provider,
    model: modelLabel,
    mode: agent.reasoningEffort ? `推理 ${agent.reasoningEffort}` : 'Hub 只读透传',
    approval: agent.approvalPolicy?.trim() || agent.permissionMode?.trim() || 'Hub 默认策略',
    approvalMode: agent.permissionMode,
    scope: agent.permissionMode?.trim() || 'Hub 所有者范围',
    ...(targetPreference ? { targetPreference } : {}),
    state: workbenchAgentStateToAgentState(agent.status),
    skills: agent.skills ?? [],
    mcpServers: agent.mcpServers ?? [],
    toolAllowlist: agent.toolAllowlist ?? [],
    memorySources: agent.memorySources ?? [],
    memoryRetention: agent.memoryRetention,
    memorySummary: agent.memorySummary,
    targetPreferences: Array.isArray(agent.targetPreferences) ? agent.targetPreferences : [],
    avatarRef: agent.avatarRef,
    avatarColor: agent.avatarColor,
    tools: toolPermissionFromAgent(agent),
  };
}
