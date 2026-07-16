/* ═══════════════════════════════════════════════════════════════════════
   Agents page public types — extracted for Phase 16 strangler slice #552.
   ═══════════════════════════════════════════════════════════════════════ */

export type AgentsPaneId =
  | 'installed'
  | 'market'
  | 'skillMarket'
  | 'mcpMarket'
  | 'policy'
  | 'tools'
  | 'models'
  | 'audit';

export type AgentState = 'running' | 'ready' | 'idle' | 'waiting';

export type ToolPermission = '允许' | '需确认' | '禁止';

export type RiskLevel = '低风险' | '中风险' | '高风险';

export type ModelState = '默认' | '备选' | '实验';

export type AuditResult = '允许' | '需确认' | '禁止';

export type MarketCategory = '推荐' | '研发' | '文档' | '测试' | '安全' | '发布';

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  icon?: string | undefined;
  engine: string;
  runtimeId?: string | undefined;
  provider?: string | undefined;
  model: string;
  mode: string;
  approval: string;
  approvalMode?: string | undefined;
  approvalRiskRules?: Array<{ match: string; decision: string }> | undefined;
  scope: string;
  targetPreference?: string | undefined;
  state: AgentState;
  skills: string[];
  mcpServers?: string[] | undefined;
  toolAllowlist?: string[] | undefined;
  memorySources?: string[] | undefined;
  memoryRetention?: string | undefined;
  memorySummary?: string | undefined;
  targetPreferences?: string[] | undefined;
  avatarRef?: string | undefined;
  avatarColor?: string | undefined;
  tools: Record<string, ToolPermission>;
}

export interface MarketTemplate {
  name: string;
  description: string;
  category: string;
  detail: string;
  runtime?: string | undefined;
  runtimeId?: string | undefined;
  provider?: string | undefined;
  model?: string | undefined;
  avatarRef?: string | undefined;
  avatarColor?: string | undefined;
  skills?: string[] | undefined;
  mcpServers?: string[] | undefined;
  toolAllowlist?: string[] | undefined;
  memorySummary?: string | undefined;
  approvalSummary?: string | undefined;
  targetPreferences?: string[] | undefined;
}

export interface PolicyRule {
  name: string;
  riskLevel: RiskLevel;
  action: string;
  description: string;
}

export interface ToolMatrixAgent {
  id: string;
  name: string;
  initials: string;
  color: string;
  permissions: Record<string, ToolPermission>;
}

export interface ModelInfo {
  name: string;
  state: ModelState;
  description: string;
  assignedAgents: string;
}

export interface ModelRoute {
  agentId: string;
  agentName: string;
  agentInitials: string;
  agentColor: string;
  role: string;
  mode: string;
  model: string;
}

export interface ModelHealth {
  name: string;
  status: string;
  meta: string;
}

export interface AuditEntry {
  time: string;
  agent: string;
  tool: string;
  result: AuditResult;
  target: string;
}

export interface AgentRecentEvent {
  time: string;
  text: string;
}

/* ── Skill Market ── */

export type SkillType = 'prompt' | 'tool' | 'workflow' | 'integration' | string;

export interface SkillMarketItem {
  id: string;
  name: string;
  description: string;
  skill_type: SkillType;
  version?: string;
  install_count?: number;
  is_public?: boolean;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
}

/* ── MCP Market ── */

export type MCPTransportType = 'stdio' | 'http' | 'sse' | string;

export interface MCPMarketItem {
  id: string;
  name: string;
  description: string;
  transport: MCPTransportType;
  command?: string;
  url?: string;
  install_count?: number;
  is_public?: boolean;
  owner_id?: string;
  created_at?: string;
  updated_at?: string;
}

/* ── cc-switch integration ── */

export interface CCSwitchStatusInfo {
  installed: boolean;
  routingActive: boolean;
  proxyPort?: number;
  activeAppTypes?: string[];
}

export interface CCSwitchProviderInfo {
  providerId: string;
  providerName: string;
  appType: string;
  isCurrent: boolean;
  isActive: boolean;
  modelAliases?: Record<string, string>;
}

/* ── Props ── */

export interface AgentsPageProps {
  /** Currently active sub-view pane */
  activePane: AgentsPaneId;
  /** Called when user clicks a nav item */
  onPaneChange: (pane: AgentsPaneId) => void;

  /** Search query in the left nav */
  searchQuery?: string;
  /** Called when search input changes */
  onSearchChange?: ((query: string) => void) | undefined;

  /** Summary stats */
  installedCount: number;
  runnableCount: number;
  confirmCount: number;
  defaultModelLabel: string;

  /** Installed agents */
  agents: AgentConfig[];
  /** Real data loading state */
  agentsLoading?: boolean | undefined;
  /** Real data load error */
  agentsError?: string | undefined;
  /** Last mutation error */
  agentActionError?: string | undefined;
  /** Retry loading agents */
  onAgentsRetry?: (() => void) | undefined;
  /** Currently selected agent id in the installed view */
  selectedAgentId?: string | undefined;
  /** Called when an agent config row is clicked */
  onAgentSelect?: ((agentId: string) => void) | undefined;
  /** Called when an Agent avatar is clicked */
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
  /** Save state label (e.g. "已同步", "未保存") */
  saveStateLabel?: string;
  /** Whether the edit panel has unsaved changes */
  isDirty?: boolean;

  /** All available skill options (chip grid) */
  allSkills?: string[];
  /** All available tool options */
  allTools?: string[];
  /** Agent save callback */
  onAgentSave?: (() => void) | undefined;
  /** Agent duplicate callback */
  onAgentDuplicate?: (() => void) | undefined;
  /** Agent delete callback */
  onAgentDelete?: (() => void) | undefined;
  /** Add agent callback */
  onAgentAdd?: (() => void) | undefined;
  /** Save in-flight agent id */
  savingAgentId?: string | undefined;
  /** Delete in-flight agent id */
  deletingAgentId?: string | undefined;
  /** Toggle agent skill */
  onAgentSkillToggle?: ((skill: string) => void) | undefined;
  /** Set tool permission */
  onToolPermissionSet?: ((tool: string, value: ToolPermission) => void) | undefined;
  /** Edit a field on the selected agent */
  onAgentFieldChange?: ((field: string, value: string) => void) | undefined;

  /** Recent events for the selected agent */
  recentEvents?: AgentRecentEvent[];

  /* ── Market view ── */
  marketTemplates?: MarketTemplate[];
  marketFeatured?: MarketTemplate[];
  activeMarketCategory?: MarketCategory;
  onMarketCategoryChange?: ((category: MarketCategory) => void) | undefined;
  onMarketInstall?: ((name: string, description: string, category: string) => void) | undefined;
  onMarketPreview?: ((name: string) => void) | undefined;
  onMarketPublish?: (() => void) | undefined;
  marketSearchQuery?: string;
  onMarketSearchChange?: ((query: string) => void) | undefined;

  /* ── Policy view ── */
  policyRules?: PolicyRule[];
  onPolicyAdd?: (() => void) | undefined;
  /** Default approval checkboxes */
  approvalReadAuto?: boolean;
  approvalWriteConfirm?: boolean;
  approvalHighRiskDeny?: boolean;
  approvalAuditEvents?: boolean;
  onApprovalToggle?: ((index: number, checked: boolean) => void) | undefined;

  /* ── Tools view ── */
  toolMatrixAgents?: ToolMatrixAgent[];
  toolMatrixTools?: string[];
  onToolsAddAgent?: (() => void) | undefined;

  /* ── Models view ── */
  models?: ModelInfo[];
  modelRoutes?: ModelRoute[];
  modelHealthRows?: ModelHealth[];
  onModelAdd?: (() => void) | undefined;
  onModelRouteClick?: ((agentId: string) => void) | undefined;

  /* ── Audit view ── */
  auditEntries?: AuditEntry[];
  activeAuditFilter?: string;
  onAuditFilterChange?: ((filter: string) => void) | undefined;
  onAuditExport?: (() => void) | undefined;

  /* ── Skill Market view ── */
  skillMarketItems?: SkillMarketItem[];
  skillMarketLoading?: boolean;
  skillMarketSearchQuery?: string;
  onSkillMarketSearchChange?: ((query: string) => void) | undefined;
  activeSkillTypeFilter?: string;
  onSkillTypeFilterChange?: ((skillType: string) => void) | undefined;
  onSkillInstall?: ((skill: SkillMarketItem) => void) | undefined;
  onSkillUninstall?: ((skillId: string) => void) | undefined;
  installedSkillIds?: string[];

  /* ── MCP Market view ── */
  mcpMarketItems?: MCPMarketItem[];
  mcpMarketLoading?: boolean;
  mcpMarketSearchQuery?: string;
  onMcpMarketSearchChange?: ((query: string) => void) | undefined;
  activeTransportFilter?: string;
  onTransportFilterChange?: ((transport: string) => void) | undefined;
  onMcpInstall?: ((mcp: MCPMarketItem) => void) | undefined;
  onMcpUninstall?: ((mcpId: string) => void) | undefined;
  installedMcpIds?: string[];

  /* ── cc-switch model proxy ── */
  ccSwitchStatus?: CCSwitchStatusInfo | undefined;
  ccSwitchProviders?: CCSwitchProviderInfo[] | undefined;

  /* ── Recent change shortcuts in nav ── */
  recentShortcuts?: string[];
}
