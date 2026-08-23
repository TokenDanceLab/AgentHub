import type {
  AgentConfig,
  MarketTemplate,
  ModelRoute,
  ToolMatrixAgent,
} from './pages/AgentsPage';
import {
  WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES,
} from './mockData';
import { workbenchAgentColor, workbenchProfileInitials } from './profileRegistry';

export interface AgentsPageDerivedModel {
  confirmCount: number;
  defaultModelLabel: string;
  installedCount: number;
  marketFeatured: MarketTemplate[];
  marketTemplates: MarketTemplate[];
  modelRoutes: ModelRoute[];
  recentShortcuts: string[];
  runnableCount: number;
  toolMatrixAgents: ToolMatrixAgent[];
}

export function countConfirmTools(
  agentConfigs: AgentConfig[],
  resolvedTools: string[],
): number {
  return agentConfigs.reduce(
    (total, agent) => total + resolvedTools.filter((tool) => agent.tools[tool] === '需确认').length,
    0,
  );
}

export function buildModelRoutes(agentConfigs: AgentConfig[]): ModelRoute[] {
  return agentConfigs.map((agent) => ({
    agentId: agent.id,
    agentName: agent.name,
    agentInitials: workbenchProfileInitials(agent.name),
    agentColor: workbenchAgentColor(agent),
    role: agent.role,
    mode: agent.mode,
    model: agent.model,
  }));
}

export function buildToolMatrixAgents(agentConfigs: AgentConfig[]): ToolMatrixAgent[] {
  return agentConfigs.map((agent) => ({
    id: agent.id,
    name: agent.name,
    initials: workbenchProfileInitials(agent.name),
    color: workbenchAgentColor(agent),
    permissions: agent.tools,
  }));
}

export function buildAgentRecentShortcuts(
  agentsProvided: boolean,
  agentConfigs: AgentConfig[],
  realDataMode: boolean = false,
): string[] {
  if (!agentsProvided) {
    return realDataMode ? [] : ['Builder 权限更新', 'Browser QA 已安装', 'DeepSeek-V4-Pro 路由'];
  }
  return agentConfigs.slice(0, 3).map((agent) => `${agent.name} 已同步`);
}

export function splitAgentMarketTemplates(
  templates: MarketTemplate[] = WORKBENCH_MOCK_AGENT_MARKET_TEMPLATES,
  realDataMode: boolean = false,
): { marketFeatured: MarketTemplate[]; marketTemplates: MarketTemplate[] } {
  if (realDataMode) {
    return { marketFeatured: [], marketTemplates: [] };
  }
  return {
    marketFeatured: templates.slice(0, 3),
    marketTemplates: templates.slice(3),
  };
}

/** Pure derived AgentsPage fields assembled from route state. */
export function buildAgentsPageDerivedModel(
  agentConfigs: AgentConfig[],
  resolvedTools: string[],
  agentsProvided: boolean,
  realDataMode: boolean = false,
): AgentsPageDerivedModel {
  const market = splitAgentMarketTemplates(undefined, realDataMode);
  return {
    confirmCount: countConfirmTools(agentConfigs, resolvedTools),
    defaultModelLabel: agentConfigs[0]?.model ?? '未配置模型',
    installedCount: agentConfigs.length,
    marketFeatured: market.marketFeatured,
    marketTemplates: market.marketTemplates,
    modelRoutes: buildModelRoutes(agentConfigs),
    recentShortcuts: buildAgentRecentShortcuts(agentsProvided, agentConfigs, realDataMode),
    runnableCount: agentConfigs.filter(
      (agent) => agent.state === 'running' || agent.state === 'ready',
    ).length,
    toolMatrixAgents: buildToolMatrixAgents(agentConfigs),
  };
}
