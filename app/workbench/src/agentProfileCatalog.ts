import type {
  MarketTemplate,
  ModelHealth,
  ModelInfo,
  PolicyRule,
  AgentConfig,
} from './pages/AgentsPage';
import { AGENT_PROFILE_CATALOG } from './agentProfileCatalogData';
import {
  agentProfileCatalogToConfig,
  agentProfileCatalogToMarketTemplate,
  uniqueSorted,
} from './agentProfileCatalogHelpers';

/* ═══════════════════════════════════════════════════════════════════════
   agentProfileCatalog — thin public facade for AgentProfile fixtures (#652).

   Types → agentProfileCatalogTypes
   Static rows → agentProfileCatalogData
   Pure mappers → agentProfileCatalogHelpers
   ═══════════════════════════════════════════════════════════════════════ */

export type {
  AgentApprovalMode,
  AgentMemorySource,
  AgentProfileCatalogItem,
  AgentProfileVisibility,
  AgentRuntimeId,
  AgentTargetPreference,
} from './agentProfileCatalogTypes';

export { AGENT_PROFILE_CATALOG } from './agentProfileCatalogData';
export {
  agentConfigToAgentSpecFixture,
  agentProfileCatalogToConfig,
  agentProfileCatalogToMarketTemplate,
  normalizeSpecId,
  toApprovalPolicySpec,
  toMCPServerSpec,
  toMemoryPolicySpec,
  toTargetPreferenceSpec,
  toToolSpecId,
  toolPermissionsFromAllowlist,
  uniqueSorted,
} from './agentProfileCatalogHelpers';

export const WORKBENCH_AGENT_PROFILE_FIXTURES: AgentConfig[] =
  AGENT_PROFILE_CATALOG.map(agentProfileCatalogToConfig);

export const WORKBENCH_AGENT_MARKET_FIXTURES: MarketTemplate[] =
  AGENT_PROFILE_CATALOG.map(agentProfileCatalogToMarketTemplate);

export const WORKBENCH_AGENT_SKILL_OPTIONS = uniqueSorted(
  AGENT_PROFILE_CATALOG.flatMap((item) => item.configuration.skills),
);

export const WORKBENCH_AGENT_TOOL_OPTIONS = uniqueSorted(
  AGENT_PROFILE_CATALOG.flatMap((item) => item.configuration.toolAllowlist),
);

export const WORKBENCH_AGENT_MCP_OPTIONS = uniqueSorted(
  AGENT_PROFILE_CATALOG.flatMap((item) => item.configuration.mcpServers),
);

export const WORKBENCH_AGENT_POLICY_RULES: PolicyRule[] = [
  { name: '读取 AGENTS.md / memory', riskLevel: '低风险', action: '默认允许', description: '只读上下文和项目规则，不包含密钥路径' },
  { name: '写入工作区文件', riskLevel: '中风险', action: '需要确认', description: 'Write File / apply_patch / 格式化输出' },
  { name: '执行 Shell 命令', riskLevel: '中风险', action: '需要确认', description: '构建、预览、轻量诊断允许进入确认队列' },
  { name: '生产部署动作', riskLevel: '高风险', action: '禁止', description: 'fixture 不连接真实部署面' },
];

export const WORKBENCH_AGENT_MODELS: ModelInfo[] = [
  { name: 'DeepSeek-V4-Pro', state: '默认', description: '长上下文推理与代码实现', assignedAgents: 'Builder, Reviewer, Deployer' },
  { name: 'gpt-5-codex', state: '备选', description: '复杂代码任务和工具编排', assignedAgents: 'Researcher' },
  { name: 'glm-5.1', state: '备选', description: '中文文档和知识整理', assignedAgents: 'Docs Librarian' },
  { name: 'kimi-k2.6', state: '实验', description: '前端视觉和多模态审查', assignedAgents: 'Browser QA' },
];

export const WORKBENCH_AGENT_MODEL_HEALTH: ModelHealth[] = [
  { name: 'DeepSeek-V4-Pro', status: '可用', meta: 'fixture only' },
  { name: 'gpt-5-codex', status: '可声明', meta: '不触发真实模型' },
  { name: 'TokenDance Gateway', status: '合同占位', meta: '由 Hub/Edge 后续接入' },
];
