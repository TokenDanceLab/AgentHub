import type {
  AgentConfig,
  AgentState,
  MarketTemplate,
  ModelHealth,
  ModelInfo,
  PolicyRule,
  ToolPermission,
} from './pages/AgentsPage';
import {
  buildAgentHubAgentSpecV1,
  type AgentHubAgentSpecDraftV1,
  type AgentHubAgentSpecMCPServerV1,
  type AgentHubAgentSpecMemoryPolicyV1,
  type AgentHubAgentSpecV1,
} from '../agentSpec';

export type AgentProfileVisibility = 'private' | 'team' | 'marketplace' | 'fixture';
export type AgentRuntimeId = 'codex' | 'claude-code' | 'opencode' | 'browser-worker';
export type AgentApprovalMode = 'read-only' | 'workspace-write' | 'approval-required' | 'blocked';
export type AgentMemorySource = 'agents-md' | 'project-memory' | 'thread-context' | 'artifact-summary' | 'fixture';
export type AgentTargetPreference = 'local-edge' | 'remote-edge' | 'cloud-edge' | 'hub-relay' | 'fixture';

export interface AgentProfileCatalogItem {
  id: string;
  name: string;
  role: string;
  description: string;
  visibility: AgentProfileVisibility;
  source: 'fixture' | 'hub-agent-profile' | 'marketplace-draft';
  category: string;
  avatarRef: string;
  avatarColor: string;
  runtime: {
    runtimeId: AgentRuntimeId;
    label: string;
    provider: string;
    model: string;
    reasoning: string;
    adapterMode: 'cli' | 'sdk' | 'daemon' | 'fixture';
  };
  configuration: {
    mode: string;
    scope: string;
    state: AgentState;
    skills: string[];
    mcpServers: string[];
    toolAllowlist: string[];
    approval: {
      mode: AgentApprovalMode;
      summary: string;
      riskRules: Array<{ match: string; decision: 'allow' | 'require-approval' | 'deny' }>;
    };
    memory: {
      sources: AgentMemorySource[];
      retention: 'thread-only' | 'project-policy' | 'no-persist-fixture';
      summary: string;
    };
    targetPreferences: AgentTargetPreference[];
  };
  market: {
    featured: boolean;
    detail: string;
    installLabel: string;
  };
}

export const AGENT_PROFILE_CATALOG: AgentProfileCatalogItem[] = [
  {
    id: 'builder-agent',
    name: 'Builder',
    role: '代码实现',
    description: '把需求拆成小步实现，输出 diff、测试证据和交接摘要。',
    visibility: 'fixture',
    source: 'fixture',
    category: '研发',
    avatarRef: 'agenthub:avatar/builder',
    avatarColor: 'var(--role-builder)',
    runtime: {
      runtimeId: 'claude-code',
      label: 'Claude Code',
      provider: 'TokenDance Gateway',
      model: 'DeepSeek-V4-Pro',
      reasoning: 'high',
      adapterMode: 'cli',
    },
    configuration: {
      mode: 'Plan -> Code',
      scope: '当前项目',
      state: 'running',
      skills: ['Read File', 'Write File', 'Shell', 'Git Diff'],
      mcpServers: ['filesystem', 'github'],
      toolAllowlist: ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot'],
      approval: {
        mode: 'workspace-write',
        summary: '写文件和 Shell 默认进入确认队列',
        riskRules: [
          { match: 'read workspace files', decision: 'allow' },
          { match: 'write workspace files', decision: 'require-approval' },
          { match: 'production deploy', decision: 'deny' },
        ],
      },
      memory: {
        sources: ['agents-md', 'project-memory', 'thread-context'],
        retention: 'project-policy',
        summary: '读取 AGENTS.md、项目记忆和当前 Thread 上下文',
      },
      targetPreferences: ['local-edge', 'remote-edge'],
    },
    market: {
      featured: true,
      detail: '适合 48h 内可验收的小切片、focused tests 和代码交接。',
      installLabel: '安装 Builder',
    },
  },
  {
    id: 'reviewer-agent',
    name: 'Reviewer',
    role: '审查与验收',
    description: '从风险、回归、测试缺口和合同边界审查 Agent 输出。',
    visibility: 'fixture',
    source: 'fixture',
    category: '测试',
    avatarRef: 'agenthub:avatar/reviewer',
    avatarColor: 'var(--role-reviewer)',
    runtime: {
      runtimeId: 'claude-code',
      label: 'Claude Code',
      provider: 'TokenDance Gateway',
      model: 'DeepSeek-V4-Pro',
      reasoning: 'high',
      adapterMode: 'cli',
    },
    configuration: {
      mode: 'Review',
      scope: '当前项目',
      state: 'ready',
      skills: ['Read File', 'Git Diff', 'Browser Screenshot'],
      mcpServers: ['github'],
      toolAllowlist: ['Read File', 'Git Diff', 'Browser Screenshot'],
      approval: {
        mode: 'read-only',
        summary: '只读默认允许，写入和执行命令禁止',
        riskRules: [
          { match: 'read workspace files', decision: 'allow' },
          { match: 'write workspace files', decision: 'deny' },
          { match: 'execute command', decision: 'require-approval' },
        ],
      },
      memory: {
        sources: ['agents-md', 'thread-context', 'artifact-summary'],
        retention: 'thread-only',
        summary: '只保留本轮审查 Thread 和产物摘要',
      },
      targetPreferences: ['local-edge', 'hub-relay'],
    },
    market: {
      featured: true,
      detail: '适合 PR 前 focused review、diff 风险列表和验收证据检查。',
      installLabel: '安装 Reviewer',
    },
  },
  {
    id: 'researcher-agent',
    name: 'Researcher',
    role: '资料研究',
    description: '整理外部资料、引用和文档库线索，不直接执行写入。',
    visibility: 'fixture',
    source: 'fixture',
    category: '文档',
    avatarRef: 'agenthub:avatar/researcher',
    avatarColor: 'var(--role-researcher)',
    runtime: {
      runtimeId: 'codex',
      label: 'Codex',
      provider: 'OpenAI Compatible API',
      model: 'gpt-5-codex',
      reasoning: 'medium',
      adapterMode: 'cli',
    },
    configuration: {
      mode: 'Research',
      scope: '文档库',
      state: 'idle',
      skills: ['Web 摘要', '文档库', '引用整理'],
      mcpServers: ['browser-search'],
      toolAllowlist: ['Read File', 'Browser Screenshot'],
      approval: {
        mode: 'approval-required',
        summary: '外部访问和资料写入前确认',
        riskRules: [
          { match: 'read docs', decision: 'allow' },
          { match: 'external fetch', decision: 'require-approval' },
          { match: 'write files', decision: 'require-approval' },
        ],
      },
      memory: {
        sources: ['project-memory', 'thread-context', 'artifact-summary'],
        retention: 'project-policy',
        summary: '优先项目记忆、Thread 结论和引用摘要',
      },
      targetPreferences: ['hub-relay', 'fixture'],
    },
    market: {
      featured: false,
      detail: '适合竞品调研、引用整理、会议结论和知识库索引。',
      installLabel: '安装 Researcher',
    },
  },
  {
    id: 'deployer-agent',
    name: 'Deployer',
    role: '预览与发布',
    description: '整理发布检查、预览证据、产物归档和回滚清单。',
    visibility: 'fixture',
    source: 'fixture',
    category: '发布',
    avatarRef: 'agenthub:avatar/deployer',
    avatarColor: 'var(--role-deployer)',
    runtime: {
      runtimeId: 'opencode',
      label: 'OpenCode',
      provider: 'TokenDance Gateway',
      model: 'DeepSeek-V4-Pro',
      reasoning: 'medium',
      adapterMode: 'cli',
    },
    configuration: {
      mode: 'Deploy',
      scope: '当前项目',
      state: 'waiting',
      skills: ['Shell', '构建', '预览', '产物归档'],
      mcpServers: ['filesystem'],
      toolAllowlist: ['Read File', 'Write File', 'Shell', 'Git Diff', 'Browser Screenshot'],
      approval: {
        mode: 'approval-required',
        summary: '构建可确认执行，生产发布默认禁止',
        riskRules: [
          { match: 'build preview', decision: 'require-approval' },
          { match: 'archive artifacts', decision: 'require-approval' },
          { match: 'production deploy', decision: 'deny' },
        ],
      },
      memory: {
        sources: ['agents-md', 'artifact-summary', 'fixture'],
        retention: 'thread-only',
        summary: '本轮产物摘要和发布检查，不持久保存密钥',
      },
      targetPreferences: ['local-edge', 'cloud-edge'],
    },
    market: {
      featured: false,
      detail: '适合上线前检查、预览 URL、归档包和回滚摘要。',
      installLabel: '安装 Deployer',
    },
  },
];

export function agentProfileCatalogToConfig(item: AgentProfileCatalogItem): AgentConfig {
  return {
    id: item.id,
    name: item.name,
    role: item.role,
    engine: item.runtime.label,
    runtimeId: item.runtime.runtimeId,
    provider: item.runtime.provider,
    model: item.runtime.model,
    mode: item.configuration.mode,
    approval: item.configuration.approval.summary,
    approvalMode: item.configuration.approval.mode,
    approvalRiskRules: item.configuration.approval.riskRules,
    scope: item.configuration.scope,
    state: item.configuration.state,
    skills: item.configuration.skills,
    mcpServers: item.configuration.mcpServers,
    toolAllowlist: item.configuration.toolAllowlist,
    memorySources: item.configuration.memory.sources,
    memoryRetention: item.configuration.memory.retention,
    memorySummary: item.configuration.memory.summary,
    targetPreferences: item.configuration.targetPreferences,
    avatarRef: item.avatarRef,
    avatarColor: item.avatarColor,
    tools: toolPermissionsFromAllowlist(item.configuration.toolAllowlist),
  };
}

export function agentProfileCatalogToMarketTemplate(item: AgentProfileCatalogItem): MarketTemplate {
  return {
    name: item.name,
    description: item.description,
    category: item.category,
    detail: item.market.detail,
    runtime: item.runtime.label,
    runtimeId: item.runtime.runtimeId,
    provider: item.runtime.provider,
    model: item.runtime.model,
    avatarRef: item.avatarRef,
    avatarColor: item.avatarColor,
    skills: item.configuration.skills,
    mcpServers: item.configuration.mcpServers,
    toolAllowlist: item.configuration.toolAllowlist,
    memorySummary: item.configuration.memory.summary,
    approvalSummary: item.configuration.approval.summary,
    targetPreferences: item.configuration.targetPreferences,
  };
}

export function agentConfigToAgentSpecFixture(agent: AgentConfig): AgentHubAgentSpecV1 {
  return buildAgentHubAgentSpecV1({
    id: agent.id,
    name: agent.name,
    description: agent.role,
    avatar: { type: 'icon', value: agent.avatarRef ?? `agenthub:avatar/${agent.id}` },
    runtimeId: agent.runtimeId ?? normalizeSpecId(agent.engine),
    runtimeProfile: agent.engine,
    provider: agent.provider ?? 'fixture-provider',
    model: agent.model,
    skills: agent.skills,
    mcpServers: (agent.mcpServers ?? []).map(toMCPServerSpec),
    toolAllowlist: (agent.toolAllowlist ?? Object.keys(agent.tools)).map(toToolSpecId),
    memoryPolicy: toMemoryPolicySpec(agent),
    approvalPolicy: toApprovalPolicySpec(agent),
    targetPreference: toTargetPreferenceSpec(agent),
  });
}

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

function toolPermissionsFromAllowlist(allowlist: string[]): Record<string, ToolPermission> {
  return Object.fromEntries(
    allowlist.map((tool) => [
      tool,
      '允许',
    ]),
  ) as Record<string, ToolPermission>;
}

function uniqueSorted(items: string[]): string[] {
  return Array.from(new Set(items)).sort((a, b) => a.localeCompare(b));
}

function toMCPServerSpec(id: string): AgentHubAgentSpecMCPServerV1 {
  return {
    id,
    transport: 'stdio',
    command: `mcp-server-${normalizeSpecId(id)}`,
  };
}

function toMemoryPolicySpec(agent: AgentConfig): AgentHubAgentSpecMemoryPolicyV1 {
  const retention = agent.memoryRetention ?? 'no-persist-fixture';
  const hasMemory = (agent.memorySources ?? []).length > 0 && retention !== 'disabled';
  return {
    mode: hasMemory && retention === 'project-policy' ? 'project' : hasMemory ? 'workspace' : 'none',
    retention,
  };
}

function toApprovalPolicySpec(agent: AgentConfig): AgentHubAgentSpecDraftV1['approvalPolicy'] {
  const requireApprovalFor = [
    ...Object.entries(agent.tools)
      .filter(([, permission]) => permission === '需确认')
      .map(([tool]) => toToolSpecId(tool)),
    ...(agent.approvalRiskRules ?? [])
      .filter((rule) => rule.decision === 'require-approval')
      .map((rule) => toToolSpecId(rule.match)),
  ];
  return {
    mode: agent.approvalMode ?? agent.approval,
    ...(requireApprovalFor.length > 0 ? { requireApprovalFor: uniqueSorted(requireApprovalFor) } : {}),
  };
}

function toTargetPreferenceSpec(agent: AgentConfig): AgentHubAgentSpecDraftV1['targetPreference'] {
  const [target] = agent.targetPreferences ?? [];
  return {
    mode: target ?? 'local-edge',
    health: agent.state === 'idle' || agent.state === 'waiting' ? 'fixture-pending' : 'fixture-ready',
  };
}

function toToolSpecId(value: string): string {
  return normalizeSpecId(value);
}

function normalizeSpecId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'fixture';
}
