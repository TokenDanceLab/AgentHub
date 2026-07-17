import React from 'react';
import { DesignNavIcon } from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import {
  buildAgentCapabilityContractFromConfig,
  buildAgentCapabilitySummary,
} from '../../agentCapabilities';
import { agentConfigToAgentSpecFixture } from '../../agentProfileCatalog';
import { formatAgentHubAgentSpecV1 } from '../../../agentSpec';
import { Select, StatusNotice } from '../../../ui';
import styles from '../AgentsPage.module.css';
import { ConfigSummaryRow, formatList } from './shared';
import {
  AgentAvatar,
  CapabilityBadge,
  stateClass,
} from './AgentInstalledParts';
import type {
  AgentConfig,
  AgentRecentEvent,
  AgentState,
  ToolPermission,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Agent edit panel + AgentSpec fixture preview.

   Extracted from AgentInstalledViews as Phase 22 residual thin #616.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export interface AgentEditPanelProps {
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

export const AgentEditPanel: React.FC<AgentEditPanelProps> = ({
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
}) => {
  const capabilitySummary = buildAgentCapabilitySummary(
    buildAgentCapabilityContractFromConfig(agent),
  );

  return (
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
      <RuntimeBrandIcon kind="runtime" name={agent.runtimeId ?? agent.engine} size="compact" framed={false} />
      <strong>{agent.engine}</strong>
      <em>{agent.provider ? `${agent.provider} / ${agent.model}` : agent.model}</em>
    </div>

    <div className={styles['agent-capability-strip']} aria-label={`${agent.name} capability readiness`}>
      <CapabilityBadge label="AGENTS.md" value={capabilitySummary.agentsMd} />
      <CapabilityBadge label="Skills" value={capabilitySummary.skills} />
      <CapabilityBadge label="MCP" value={capabilitySummary.mcp} />
      <CapabilityBadge label="Memory" value={capabilitySummary.memory} />
      <CapabilityBadge label="Tools" value={capabilitySummary.tools} />
      <CapabilityBadge label="Avatar" value={capabilitySummary.avatar} />
      <span className={`${styles['capability-readiness']} ${styles[capabilitySummary.readiness]}`}>
        {capabilitySummary.readiness}
      </span>
    </div>

    <div className={styles['agent-config-summary']} aria-label={`${agent.name} 配置摘要`}>
      <ConfigSummaryRow label="AGENTS.md" value={capabilitySummary.agentsMd} />
      <ConfigSummaryRow label="MCP" value={formatList(agent.mcpServers, '未绑定 MCP')} />
      <ConfigSummaryRow label="Memory" value={agent.memorySummary || formatList(agent.memorySources, '未声明 memory')} />
      <ConfigSummaryRow label="Approval" value={agent.approvalMode ? `${agent.approvalMode} · ${agent.approval}` : agent.approval} />
      <ConfigSummaryRow label="Target" value={agent.targetPreference || formatList(agent.targetPreferences, '未声明 target')} />
    </div>

    <AgentSpecFixturePanel agent={agent} />

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
        目标偏好
        <input
          value={agent.targetPreference ?? ''}
          onChange={(e) => onFieldChange?.('targetPreference', e.target.value)}
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

    <section className={styles['agent-skill-editor']}>
      <div className={styles['section-title-row']}>
        <h3>MCP / Memory</h3>
        <span>{agent.memoryRetention || 'policy pending'}</span>
      </div>
      <div className={styles['agent-token-grid']}>
        {(agent.mcpServers ?? []).map((server) => (
          <span key={`mcp-${server}`} className={styles['agent-token']}>
            <RuntimeBrandIcon kind="tool" name="MCP Server" size="compact" framed={false} decorative />
            {server}
          </span>
        ))}
        {(agent.memorySources ?? []).map((source) => (
          <span key={`memory-${source}`} className={styles['agent-token']}>
            <RuntimeBrandIcon kind="tool" name="Agent Profile" size="compact" framed={false} decorative />
            {source}
          </span>
        ))}
      </div>
    </section>

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
              <RuntimeBrandIcon kind="tool" name={skill} size="compact" framed={false} decorative />
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
    {actionError ? (
      <StatusNotice
        {...((styles.statusNotice || styles.statusNoticeDanger)
          ? {
              className: [styles.statusNotice, styles.statusNoticeDanger]
                .filter(Boolean)
                .join(' '),
            }
          : {})}
        icon={<DesignNavIcon name="error404" size={14} />}
        role="alert"
      >
        {actionError}
      </StatusNotice>
    ) : null}

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
};

const AgentSpecFixturePanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const spec = agentConfigToAgentSpecFixture(agent);
  const preview = formatAgentHubAgentSpecV1(spec);

  return (
    <section className={styles['agent-spec-fixture']} aria-label={`${agent.name} AgentSpec fixture`}>
      <div className={styles['section-title-row']}>
        <h3>AgentSpec fixture</h3>
        <span>no-spend</span>
      </div>
      <div className={styles['agent-spec-grid']}>
        <ConfigSummaryRow label="Runtime" value={`${spec.runtime.id} · ${spec.runtime.profile}`} />
        <ConfigSummaryRow label="Model" value={`${spec.runtime.provider} / ${spec.runtime.model}`} />
        <ConfigSummaryRow label="Tools" value={formatList(spec.tool_allowlist, '未声明 tool')} />
        <ConfigSummaryRow label="MCP" value={formatList(spec.mcp_servers.map((server) => server.id), '未绑定 MCP')} />
        <ConfigSummaryRow label="Memory" value={`${spec.memory_policy.mode} · ${spec.memory_policy.retention}`} />
        <ConfigSummaryRow label="Approval" value={[
          spec.approval_policy.mode,
          formatList(spec.approval_policy.require_approval_for, ''),
        ].filter(Boolean).join(' · ')} />
      </div>
      <pre className={styles['agent-spec-preview']}>{preview}</pre>
      <p className={styles['agent-spec-note']}>
        仅编译 fixture JSON，不导入 SDK、不启动 CLI、不调用模型。
      </p>
    </section>
  );
};
