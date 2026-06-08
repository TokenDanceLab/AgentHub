import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  DESIGN_NAV_ICON_SIZE,
  type DesignNavIconName,
} from '../designIcons';
import { resolveWorkbenchProfile } from '../profileRegistry';
import { RuntimeBrandIcon } from '../RuntimeBrandIcon';
import { Select } from '../../ui';
import styles from './AgentsPage.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   AgentsPage — AgentHub v4
   6 sub-views: 已安装 / Agent 市场 / 运行策略 / 工具权限 / 模型配置 / 审计日志
   Pure presentational — no data fetching, render from props.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── Public enums / literals ── */

export type AgentsPaneId =
  | 'installed'
  | 'market'
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

/* ── Data shapes ── */

export interface AgentConfig {
  id: string;
  name: string;
  role: string;
  engine: string;
  model: string;
  mode: string;
  approval: string;
  scope: string;
  state: AgentState;
  skills: string[];
  tools: Record<string, ToolPermission>;
}

export interface MarketTemplate {
  name: string;
  description: string;
  category: string;
  detail: string;
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

  /* ── Recent change shortcuts in nav ── */
  recentShortcuts?: string[];
}

/* ═══════════════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════════════ */

function permissionClass(value: string): string {
  if (value === '允许' || value === '默认允许') return 'allow';
  if (value === '禁止') return 'deny';
  return 'confirm';
}

function riskClass(level: RiskLevel): string {
  if (level === '高风险') return 'risk-high';
  if (level === '低风险') return 'risk-low';
  return 'risk-mid';
}

function marketInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2);
}

/* ═══════════════════════════════════════════════════════════════════════
   AgentsPage
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentsPage: React.FC<AgentsPageProps> = (props) => {
  const {
    activePane,
    onPaneChange,
    searchQuery = '',
    onSearchChange,
    recentShortcuts = [],
  } = props;

  const navItems: { id: AgentsPaneId; label: string; icon: DesignNavIconName }[] = [
    { id: 'installed', label: '已安装', icon: 'package' },
    { id: 'market', label: 'Agent 市场', icon: 'store' },
    { id: 'policy', label: '运行策略', icon: 'policy' },
    { id: 'tools', label: '工具权限', icon: 'tools' },
    { id: 'models', label: '模型配置', icon: 'model' },
    { id: 'audit', label: '审计日志', icon: 'audit' },
  ];

  const renderPane = () => {
    switch (activePane) {
      case 'installed':
        return <AgentInstalledView {...props} />;
      case 'market':
        return <AgentMarketView {...props} />;
      case 'policy':
        return <AgentPolicyView {...props} />;
      case 'tools':
        return <AgentToolsView {...props} />;
      case 'models':
        return <AgentModelsView {...props} />;
      case 'audit':
        return <AgentAuditView {...props} />;
      default:
        return <AgentInstalledView {...props} />;
    }
  };

  return (
    <section className={`${styles['agents-page']} workbench agents-page`}>
      <aside className={`${styles['workbench-nav']} workbench-nav`}>
        <div className={`${styles['workbench-title']} workbench-title`}>Agent</div>
        <input
          className={`${styles['workbench-search']} workbench-search`}
          placeholder="搜索 Agent、模型或权限"
          value={searchQuery}
          onChange={(e) => onSearchChange?.(e.target.value)}
        />
        <div className={styles['nav-caption']}>配置中心</div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`${styles['nav-row']} ${activePane === item.id ? styles.active : ''}`}
            type="button"
            onClick={() => onPaneChange(item.id)}
          >
            <span className={styles['nav-glyph']}>
              <DesignNavIcon
                name={item.icon}
                size={DESIGN_NAV_GLYPH_SIZE}
                strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
              />
            </span>
            {item.label}
          </button>
        ))}
        <div className={styles['nav-caption']}>最近变更</div>
        {recentShortcuts.map((item, i) => (
          <div key={i} className={styles['doc-shortcut']}>
            {item}
          </div>
        ))}
      </aside>

      {renderPane()}
    </section>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   1. 已安装 (Installed)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentInstalledView: React.FC<AgentsPageProps> = (props) => {
  const {
    installedCount,
    runnableCount,
    confirmCount,
    defaultModelLabel,
    agents,
    agentsLoading = false,
    agentsError,
    agentActionError,
    onAgentsRetry,
    selectedAgentId,
    onAgentSelect,
    onAgentProfileOpen,
    saveStateLabel = '已同步',
    isDirty = false,
    allSkills = [],
    allTools = [],
    onAgentSave,
    onAgentDuplicate,
    onAgentDelete,
    onAgentAdd,
    savingAgentId,
    deletingAgentId,
    onAgentSkillToggle,
    onToolPermissionSet,
    onAgentFieldChange,
    recentEvents = [],
  } = props;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];
  const selectedAgentBusy = Boolean(selectedAgent && (savingAgentId === selectedAgent.id || deletingAgentId === selectedAgent.id));

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>Agent管理</h1>
          <p className={styles['head-subcopy']}>
            查看 Agent 基础配置、skills 和工具权限；写入能力按 Hub / Edge 合同逐步接入。
          </p>
        </div>
        <button
          className={`${styles['outline-action']} outline-action`}
          type="button"
          onClick={onAgentAdd}
        >
          <DesignNavIcon name="plus" size={15} />
          添加 Agent
        </button>
      </div>

      {/* Summary strip */}
      <div className={styles['agent-summary-strip']}>
        <AgentStat label="已安装" value={installedCount} meta="active templates" />
        <AgentStat label="可运行" value={runnableCount} meta="running / ready" />
        <AgentStat label="需确认权限" value={confirmCount} meta="tool gates" />
        <AgentStat label="默认模型" value={defaultModelLabel} meta="routing" />
      </div>

      {/* Layout: list + edit panel */}
      <div className={styles['agent-layout']}>
        <section className={styles['agent-section']}>
          <div className={styles['section-title-row']}>
            <h2>已安装 Agent</h2>
            <span>{agentsLoading ? '同步中' : `${agents.length} active`}</span>
          </div>
          {agentsError && (
            <div className={styles['agent-inline-state']} role="alert">
              <span>{agentsError}</span>
              <button type="button" onClick={onAgentsRetry}>重试</button>
            </div>
          )}
          <div className={styles['agent-config-list']}>
            {agents.length === 0 && !agentsLoading && (
              <div className={styles['agent-empty-state']} role="status">
                <strong>暂无 Agent Profile</strong>
                <span>当前 Hub 账号还没有已安装 Agent。</span>
                <button type="button" onClick={onAgentAdd}>添加 Agent</button>
              </div>
            )}
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`${styles['agent-config-row']} agent-config-row ${agent.id === selectedAgentId ? styles.selected : ''}`}
                type="button"
                disabled={deletingAgentId === agent.id}
                onClick={() => onAgentSelect?.(agent.id)}
              >
                <AgentAvatar agent={agent} onAgentProfileOpen={onAgentProfileOpen} />
                <div>
                  <strong>{agent.name}</strong>
                  <span>
                    {agent.role} · {agent.engine}
                  </span>
                  <small>
                    {agent.skills.join(' · ') || '未配置 skill'}
                  </small>
                </div>
                <em>{agent.model}</em>
                <span className={`${styles.state} ${stateClass(agent.state)}`} />
              </button>
            ))}
          </div>
        </section>

        {selectedAgent && (
          <AgentEditPanel
            agent={selectedAgent}
            actionError={agentActionError}
            saveStateLabel={saveStateLabel}
            isDirty={isDirty}
            isDeleting={deletingAgentId === selectedAgent.id}
            isSaving={savingAgentId === selectedAgent.id}
            isBusy={selectedAgentBusy}
            allSkills={allSkills}
            allTools={allTools}
            onAgentSave={onAgentSave}
            onAgentDuplicate={onAgentDuplicate}
            onAgentDelete={onAgentDelete}
            onAgentSkillToggle={onAgentSkillToggle}
            onAgentProfileOpen={onAgentProfileOpen}
            onToolPermissionSet={onToolPermissionSet}
            onFieldChange={onAgentFieldChange}
            recentEvents={recentEvents}
          />
        )}
      </div>
    </main>
  );
};

/* ── AgentStat ── */

const AgentStat: React.FC<{ label: string; value: string | number; meta: string }> = ({
  label,
  value,
  meta,
}) => (
  <article className={styles['agent-stat']}>
    <span>{label}</span>
    <strong>{value}</strong>
    <small>{meta}</small>
  </article>
);

/* ── Agent Edit Panel ── */

interface AgentEditPanelProps {
  agent: AgentConfig;
  actionError?: string | undefined;
  saveStateLabel: string;
  isDirty: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isBusy: boolean;
  allSkills: string[];
  allTools: string[];
  onAgentSave?: (() => void) | undefined;
  onAgentDuplicate?: (() => void) | undefined;
  onAgentDelete?: (() => void) | undefined;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
  onAgentSkillToggle?: ((skill: string) => void) | undefined;
  onToolPermissionSet?: ((tool: string, value: ToolPermission) => void) | undefined;
  onFieldChange?: ((field: string, value: string) => void) | undefined;
  recentEvents: AgentRecentEvent[];
}

const AgentEditPanel: React.FC<AgentEditPanelProps> = ({
  agent,
  actionError,
  saveStateLabel,
  isDirty,
  isSaving,
  isDeleting,
  isBusy,
  allSkills,
  allTools,
  onAgentSave,
  onAgentDuplicate,
  onAgentDelete,
  onAgentProfileOpen,
  onAgentSkillToggle,
  onToolPermissionSet,
  onFieldChange,
  recentEvents,
}) => (
  <aside className={styles['agent-detail']}>
    <div className={`${styles['detail-head']} ${styles.editable}`}>
      <AgentAvatar agent={agent} onAgentProfileOpen={onAgentProfileOpen} />
      <div>
        <h2>{agent.name}</h2>
        <span>{agent.role.trim() || 'Hub AgentProfile'} Agent</span>
      </div>
      <span
        className={`${styles['agent-save-state']} ${isDirty ? styles.dirty : ''}`}
      >
        {saveStateLabel}
      </span>
    </div>

    {/* Runtime line */}
    <div className={styles['agent-runtime-line']}>
      <span className={`${styles.state} ${stateClass(agent.state)}`} />
      <RuntimeBrandIcon kind="runtime" name={agent.engine} size="compact" framed={false} />
      <strong>{agent.engine}</strong>
      <em>{agent.model}</em>
    </div>

    {/* Edit grid */}
    <div className={styles['agent-edit-grid']}>
      <label>
        名称
        <input
          value={agent.name}
          onChange={(e) => onFieldChange?.('name', e.target.value)}
        />
      </label>
      <label>
        职责
        <input
          value={agent.role}
          onChange={(e) => onFieldChange?.('role', e.target.value)}
        />
      </label>
      <label>
        运行引擎
        <Select
          ariaLabel="运行引擎"
          className={styles['field-select'] ?? ''}
          value={agent.engine}
          options={['Claude Code', 'DeepSeek', 'Codex', 'Browser Worker'].map((opt) => [opt, opt])}
          onChange={(value) => onFieldChange?.('engine', value)}
        />
      </label>
      <label>
        默认模型
        <Select
          ariaLabel="默认模型"
          className={styles['field-select'] ?? ''}
          value={agent.model}
          options={['DeepSeek-V4-Pro', 'kimi-k2.6', 'glm-5.1', 'gpt-5-codex'].map((opt) => [opt, opt])}
          onChange={(value) => onFieldChange?.('model', value)}
        />
      </label>
      <label>
        运行模式
        <Select
          ariaLabel="运行模式"
          className={styles['field-select'] ?? ''}
          value={agent.mode}
          options={['Plan → Code', 'Review', 'Research', 'Deploy', 'Autonomous'].map((opt) => [opt, opt])}
          onChange={(value) => onFieldChange?.('mode', value)}
        />
      </label>
      <label>
        状态
        <Select
          ariaLabel="状态"
          className={styles['field-select'] ?? ''}
          value={agent.state}
          options={(['running', 'ready', 'idle', 'waiting'] as AgentState[]).map((opt) => [opt, opt])}
          onChange={(value) => onFieldChange?.('state', value)}
        />
      </label>
      <label>
        审批策略
        <input
          value={agent.approval}
          onChange={(e) => onFieldChange?.('approval', e.target.value)}
        />
      </label>
      <label>
        上下文范围
        <input
          value={agent.scope}
          onChange={(e) => onFieldChange?.('scope', e.target.value)}
        />
      </label>
    </div>

    {/* Skill editor */}
    <section className={styles['agent-skill-editor']}>
      <div className={styles['section-title-row']}>
        <h3>Skills</h3>
        <span>{agent.skills.length} enabled</span>
      </div>
      <div className={styles['skill-chip-grid']}>
        {allSkills.map((skill) => (
          <button
            key={skill}
            className={`${styles['skill-chip']} ${agent.skills.includes(skill) ? styles.active : ''}`}
            type="button"
            onClick={() => onAgentSkillToggle?.(skill)}
          >
            {skill}
          </button>
        ))}
      </div>
    </section>

    {/* Tool permissions */}
    <section className={styles['editable-tools']}>
      <div className={styles['section-title-row']}>
        <h3>工具权限</h3>
        <span>Allow / Confirm / Deny</span>
      </div>
      {allTools.map((tool) => (
        <div key={tool} className={`${styles['scope-row']} ${styles.editable}`}>
          <span>{tool}</span>
          <div className={styles['permission-segment']}>
            {(['允许', '需确认', '禁止'] as ToolPermission[]).map((option) => (
              <button
                key={option}
                className={`${(agent.tools[tool] || '需确认') === option ? styles.active : ''}`}
                type="button"
                onClick={() => onToolPermissionSet?.(tool, option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </section>

    {/* Mini log */}
    <section className={styles['agent-mini-log']}>
      <div className={styles['section-title-row']}>
        <h3>最近运行</h3>
        <span>{recentEvents.length} events</span>
      </div>
      {recentEvents.map((evt, i) => (
        <div key={i}>
          <time>{evt.time}</time>
          <span>{evt.text}</span>
        </div>
      ))}
    </section>
    {actionError && (
      <div className={`${styles['agent-inline-state']} ${styles.danger}`} role="alert">
        <span>{actionError}</span>
      </div>
    )}

    {/* Edit actions */}
    <div className={styles['agent-edit-actions']} aria-busy={isBusy ? 'true' : undefined}>
      <button
        className={`${styles.btn} ${styles['btn-p']}`}
        type="button"
        disabled={isBusy}
        onClick={onAgentSave}
      >
        {isSaving ? '保存中' : '保存配置'}
      </button>
      <button
        className={`${styles.btn} ${styles['btn-s']}`}
        type="button"
        disabled={isBusy}
        onClick={onAgentDuplicate}
      >
        复制 Agent
      </button>
      <button
        className={`${styles.btn} ${styles['btn-d']}`}
        type="button"
        disabled={isBusy}
        onClick={onAgentDelete}
      >
        {isDeleting ? '删除中' : '删除'}
      </button>
    </div>
  </aside>
);

/* ═══════════════════════════════════════════════════════════════════════
   2. Agent 市场 (Market)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentMarketView: React.FC<AgentsPageProps> = (props) => {
  const {
    marketTemplates = [],
    marketFeatured = [],
    activeMarketCategory = '推荐',
    onMarketCategoryChange,
    onMarketInstall,
    onMarketPreview,
    onMarketPublish,
    marketSearchQuery = '',
    onMarketSearchChange,
  } = props;

  const categories: MarketCategory[] = ['推荐', '研发', '文档', '测试', '安全', '发布'];

  return (
    <main className={`${styles['agent-main']} ${styles['agent-market-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>Agent 市场</h1>
          <p className={styles['head-subcopy']}>
            从 TokenDance 模板库安装可复用 Agent，不影响已安装配置。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onMarketPublish}>
          发布模板
        </button>
      </div>

      {/* Toolbar */}
      <div className={styles['market-toolbar']}>
        <input
          className={styles['market-search']}
          type="search"
          placeholder="搜索模板、能力或场景"
          value={marketSearchQuery}
          onChange={(e) => onMarketSearchChange?.(e.target.value)}
        />
        <div className={styles['market-cats']}>
          {categories.map((cat) => (
            <button
              key={cat}
              className={`${activeMarketCategory === cat ? styles.active : ''}`}
              type="button"
              onClick={() => onMarketCategoryChange?.(cat)}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Featured grid */}
      <section className={`${styles['agent-section']} ${styles['market-featured']}`}>
        <div className={styles['section-title-row']}>
          <h2>推荐模板</h2>
          <span>精选</span>
        </div>
        <div className={`${styles['market-grid']} ${styles.featured}`}>
          {marketFeatured.map((tmpl) => (
            <MarketCard
              key={tmpl.name}
              template={tmpl}
              onInstall={onMarketInstall}
              onPreview={onMarketPreview}
            />
          ))}
        </div>
      </section>

      {/* All templates list */}
      <section className={`${styles['agent-section']} ${styles['market-list-section']}`}>
        <div className={styles['section-title-row']}>
          <h2>全部模板</h2>
          <span>{marketTemplates.length} templates</span>
        </div>
        <div className={styles['market-list']}>
          {marketTemplates.map((tmpl) => (
            <button
              key={tmpl.name}
              className={styles['market-list-row']}
              type="button"
              onClick={() =>
                onMarketInstall?.(tmpl.name, tmpl.description, tmpl.category)
              }
            >
              <div className={styles['market-icon']}>
                {marketInitials(tmpl.name)}
              </div>
              <div>
                <strong>{tmpl.name}</strong>
                <span>{tmpl.description}</span>
              </div>
              <em>{tmpl.category}</em>
              <small>{tmpl.detail}</small>
              <b>安装</b>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
};

/* ── MarketCard ── */

const MarketCard: React.FC<{
  template: MarketTemplate;
  onInstall?: ((name: string, description: string, category: string) => void) | undefined;
  onPreview?: ((name: string) => void) | undefined;
}> = ({ template, onInstall, onPreview }) => (
  <article className={`${styles['market-card']} agent-card`} data-card-surface>
    <div className={styles['market-card-head']}>
      <div className={styles['market-icon']}>{marketInitials(template.name)}</div>
      <span>{template.category}</span>
    </div>
    <h3>{template.name}</h3>
    <p>{template.description}</p>
    <small>{template.detail}</small>
    <div>
      <button
        type="button"
        onClick={() =>
          onInstall?.(template.name, template.description, template.category)
        }
      >
        安装
      </button>
      <button type="button" onClick={() => onPreview?.(template.name)}>
        预览
      </button>
    </div>
  </article>
);

/* ═══════════════════════════════════════════════════════════════════════
   3. 运行策略 (Policy)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentPolicyView: React.FC<AgentsPageProps> = (props) => {
  const {
    policyRules = [],
    onPolicyAdd,
    approvalReadAuto = true,
    approvalWriteConfirm = true,
    approvalHighRiskDeny = true,
    approvalAuditEvents = false,
    onApprovalToggle,
  } = props;

  const checks = [
    { label: '只读动作自动通过', checked: approvalReadAuto },
    { label: '写入动作进入用户确认', checked: approvalWriteConfirm },
    { label: '高风险动作默认禁止', checked: approvalHighRiskDeny },
    { label: '每次运行记录审计事件', checked: approvalAuditEvents },
  ];

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>运行策略</h1>
          <p className={styles['head-subcopy']}>
            配置 Agent 执行边界、审批默认值和风险分级。这里展示前端 demo 的策略矩阵。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onPolicyAdd}>
          <DesignNavIcon name="plus" size={15} />
          新增策略
        </button>
      </div>

      <div className={styles['agent-policy-layout']}>
        <section className={styles['agent-section']}>
          <div className={styles['section-title-row']}>
            <h2>策略矩阵</h2>
            <span>{policyRules.length} rules</span>
          </div>
          <div className={styles['agent-rule-list']}>
            {policyRules.map((rule) => (
              <button
                key={rule.name}
                className={`${styles['agent-rule-row']} agent-card`}
                data-card-surface
                type="button"
              >
                <span className={styles['rule-icon']}>
                  <DesignNavIcon
                    name={rule.riskLevel === '高风险' ? 'policy' : 'tools'}
                    size={DESIGN_NAV_ICON_SIZE}
                  />
                </span>
                <div>
                  <strong>{rule.name}</strong>
                  <small>{rule.description}</small>
                </div>
                <em className={styles[riskClass(rule.riskLevel)]}>
                  {rule.riskLevel}
                </em>
                <b>{rule.action}</b>
              </button>
            ))}
          </div>
        </section>

        <section className={`${styles['agent-section']} ${styles['policy-side']}`}>
          <div className={styles['section-title-row']}>
            <h2>默认审批流</h2>
            <span>demo</span>
          </div>
          {checks.map((item, i) => (
            <label key={i} className={styles['policy-check']}>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => onApprovalToggle?.(i, e.target.checked)}
              />
              <span>{item.label}</span>
            </label>
          ))}
          <div className={styles['policy-note']}>
            <strong>策略命中顺序</strong>
            <p>
              先匹配工具风险，再匹配目标资源，最后落到 Agent 自身权限。所有拒绝项写入审计日志。
            </p>
          </div>
        </section>
      </div>
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   4. 工具权限 (Tools)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentToolsView: React.FC<AgentsPageProps> = (props) => {
  const {
    toolMatrixAgents = [],
    toolMatrixTools = [],
    onToolsAddAgent,
  } = props;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>工具权限</h1>
          <p className={styles['head-subcopy']}>
            按 Agent 查看工具授权。权限值可在“Agent 配置”页直接修改，这里做集中总览。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onToolsAddAgent}>
          <DesignNavIcon name="plus" size={15} />
          添加 Agent
        </button>
      </div>

      <section className={styles['agent-section']}>
        <div className={styles['section-title-row']}>
          <h2>权限总览</h2>
          <span>{toolMatrixAgents.length} agents</span>
        </div>
        <div className={styles['tool-matrix']}>
          {/* Head */}
          <div className={styles['tool-matrix-head']}>
            <span>Agent</span>
            {toolMatrixTools.map((tool) => (
              <span key={tool} className={styles['tool-head-cell']}>
                <RuntimeBrandIcon kind="tool" name={tool} size="compact" framed={false} />
                {tool}
              </span>
            ))}
          </div>
          {/* Rows */}
          {toolMatrixAgents.map((agent) => (
            <button
              key={agent.id}
              className={styles['tool-matrix-row']}
              type="button"
            >
              <span className={styles['tool-agent-cell']}>
                <span
                  className={styles['agent-symbol']}
                  style={{ background: agent.color }}
                >
                  {agent.initials}
                </span>
                <strong>{agent.name}</strong>
              </span>
              {toolMatrixTools.map((tool) => (
                <em
                  key={tool}
                  className={styles[permissionClass(agent.permissions[tool] || '需确认')]}
                >
                  {agent.permissions[tool] || '需确认'}
                </em>
              ))}
            </button>
          ))}
        </div>
      </section>

      <div className={styles['permission-legend']}>
        <span>
          <i className={styles.allow} />
          允许: 低风险直接执行
        </span>
        <span>
          <i className={styles.confirm} />
          需确认: 进入用户审批
        </span>
        <span>
          <i className={styles.deny} />
          禁止: 不下发工具调用
        </span>
      </div>
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   5. 模型配置 (Models)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentModelsView: React.FC<AgentsPageProps> = (props) => {
  const {
    models = [],
    modelRoutes = [],
    modelHealthRows = [],
    onModelAdd,
    onModelRouteClick,
  } = props;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>模型配置</h1>
          <p className={styles['head-subcopy']}>
            定义可选模型、默认用途和 Agent 分配。当前 demo 只修改前端展示状态。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onModelAdd}>
          <DesignNavIcon name="plus" size={15} />
          添加模型
        </button>
      </div>

      {/* Model grid */}
      <div className={styles['model-grid']}>
        {models.map((model) => (
          <article key={model.name} className={`${styles['model-card']} agent-card`} data-card-surface>
            <RuntimeBrandIcon kind="model" name={model.name} size="large" />
            <div>
              <h2>{model.name}</h2>
              <p>{model.description}</p>
              <small>{model.assignedAgents}</small>
            </div>
            <span className={styles['model-state']}>{model.state}</span>
          </article>
        ))}
      </div>

      {/* Route rules */}
      <section className={`${styles['agent-section']} ${styles['model-routing']}`}>
        <div className={styles['section-title-row']}>
          <h2>路由规则</h2>
          <span>priority</span>
        </div>
        {modelRoutes.map((route) => (
          <button
            key={route.agentId}
            className={styles['model-route-row']}
            type="button"
            onClick={() => onModelRouteClick?.(route.agentId)}
          >
            <span
              className={styles['agent-symbol']}
              style={{ background: route.agentColor }}
            >
              {route.agentInitials}
            </span>
            <div>
              <strong>{route.agentName}</strong>
              <small>
                {route.role} · {route.mode}
              </small>
            </div>
            <RuntimeBrandIcon kind="model" name={route.model} size="compact" framed={false} />
            <em>{route.model}</em>
          </button>
        ))}
      </section>

      {/* Model health */}
      <section className={`${styles['agent-section']} ${styles['model-health']}`}>
        <div className={styles['section-title-row']}>
          <h2>模型健康</h2>
          <span>mock</span>
        </div>
        {modelHealthRows.map((row) => (
          <div key={row.name} className={styles['model-health-row']}>
            <RuntimeBrandIcon kind="model" name={row.name} size="compact" framed={false} />
            <strong>{row.name}</strong>
            <span>{row.status}</span>
            <em>{row.meta}</em>
          </div>
        ))}
      </section>
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   6. 审计日志 (Audit)
   ═══════════════════════════════════════════════════════════════════════ */

const AgentAuditView: React.FC<AgentsPageProps> = (props) => {
  const {
    auditEntries = [],
    activeAuditFilter = '全部',
    onAuditFilterChange,
    onAuditExport,
  } = props;

  const filters = ['全部', '需确认', '禁止', '今天'];

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>审计日志</h1>
          <p className={styles['head-subcopy']}>
            记录 Agent 工具调用、审批结果和目标资源，用于 demo 中展示治理闭环。
          </p>
        </div>
        <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onAuditExport}>
          <DesignNavIcon name="download" size={15} />
          导出日志
        </button>
      </div>

      {/* Filter bar */}
      <div className={styles['audit-filter-bar']}>
        {filters.map((filter) => (
          <button
            key={filter}
            className={`${activeAuditFilter === filter ? styles.active : ''}`}
            type="button"
            onClick={() => onAuditFilterChange?.(filter)}
          >
            {filter}
          </button>
        ))}
      </div>

      {/* Audit section */}
      <section className={`${styles['agent-section']} ${styles['audit-section']}`}>
        <div className={styles['audit-head']}>
          <span>时间</span>
          <span>Agent</span>
          <span>工具</span>
          <span>结果</span>
          <span>目标</span>
        </div>
        {auditEntries.map((entry, i) => (
          <button
            key={`${entry.time}-${entry.agent}-${entry.tool}-${i}`}
            className={styles['audit-row']}
            type="button"
          >
            <time>{entry.time}</time>
            <strong>{entry.agent}</strong>
            <span>{entry.tool}</span>
            <em className={styles[permissionClass(entry.result)]}>
              {entry.result}
            </em>
            <small>{entry.target}</small>
          </button>
        ))}
      </section>
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   Shared helpers
   ═══════════════════════════════════════════════════════════════════════ */

const AgentAvatar: React.FC<{
  agent: AgentConfig;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
}> = ({ agent, onAgentProfileOpen }) => {
  const profile = resolveWorkbenchProfile(agent.id || agent.name, [agent]);

  return (
    <span
      aria-expanded={false}
      aria-haspopup="dialog"
      aria-label={`查看 ${profile.name} 资料`}
      className={styles['agent-avatar']}
      data-agent-profile={profile.name}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onAgentProfileOpen?.(agent, event.currentTarget);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        event.stopPropagation();
        onAgentProfileOpen?.(agent, event.currentTarget);
      }}
      role="button"
      style={{ background: profile.color }}
      tabIndex={0}
      title={`${profile.name} ${profile.label}`}
    >
      {profile.initials}
    </span>
  );
};

function stateClass(state: AgentState): string {
  if (state === 'running') return styles.running ?? '';
  if (state === 'ready') return styles.ready ?? '';
  if (state === 'waiting') return styles.waiting ?? '';
  return '';
}
