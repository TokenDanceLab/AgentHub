import React from 'react';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import { agentConfigToAgentSpecFixture } from '../../agentProfileCatalog';
import { formatAgentHubAgentSpecV1 } from '@shared/agentSpec';
import { Button, Select } from '@shared/ui';
import styles from '../AgentsPage.module.css';
import { ConfigSummaryRow, formatList } from './shared';
import {
  AgentAvatar,
  CapabilityBadge,
  stateClass,
} from './AgentInstalledParts';
import {
  TOOL_PERMISSION_LABELS,
  defaultToolPermission,
  getEditFieldConfigs,
} from './AgentEditHelpers';
import type {
  AgentConfig,
  AgentRecentEvent,
  ToolPermission,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Agent edit panel presentational sub-parts.

   Extracted from AgentEditPanel as Phase 29 residual thin #695.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

/* ── AgentSpecFixturePanel ── */

export const AgentSpecFixturePanel: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
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

/* ── AgentEditGrid ── */

export const AgentEditGrid: React.FC<{
  agent: AgentConfig;
  onFieldChange?: ((field: string, value: string) => void) | undefined;
}> = ({ agent, onFieldChange }) => {
  const fieldConfigs = getEditFieldConfigs();
  return (
    <div className={styles['agent-edit-grid']}>
      {fieldConfigs.map((field) => (
        <label key={field.key}>
          {field.label}
          {field.type === 'select' ? (
            <Select
              ariaLabel={field.label}
              className={styles['field-select'] ?? ''}
              value={String(agent[field.key as keyof AgentConfig] ?? '')}
              options={field.options!}
              onChange={(value) => onFieldChange?.(field.key, value)}
            />
          ) : (
            <input
              value={String(agent[field.key as keyof AgentConfig] ?? '')}
              placeholder="未设置"
              onChange={(e) => onFieldChange?.(field.key, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
};

/* ── AgentMcpMemorySection ── */

export const AgentMcpMemorySection: React.FC<{ agent: AgentConfig }> = ({ agent }) => (
  <section className={styles['agent-skill-editor']}>
    <div className={styles['section-title-row']}>
      <h3>MCP / 记忆</h3>
      <span>{agent.memoryRetention || '策略待定'}</span>
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
);

/* ── AgentSkillChipGrid ── */

export const AgentSkillChipGrid: React.FC<{
  agent: AgentConfig;
  allSkills: string[];
  onAgentSkillToggle?: ((skill: string) => void) | undefined;
}> = ({ agent, allSkills, onAgentSkillToggle }) => (
  <section className={styles['agent-skill-editor']}>
    <div className={styles['section-title-row']}>
      <h3>技能</h3>
      <span>已启用 {agent.skills.length} 个</span>
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
);

/* ── AgentToolPermissions ── */

export const AgentToolPermissions: React.FC<{
  agent: AgentConfig;
  allTools: string[];
  onToolPermissionSet?: ((tool: string, value: ToolPermission) => void) | undefined;
}> = ({ agent, allTools, onToolPermissionSet }) => (
  <section className={styles['editable-tools']}>
    <div className={styles['section-title-row']}>
      <h3>工具权限</h3>
      <span>允许 / 需确认 / 禁止</span>
    </div>
    {allTools.map((tool) => (
      <div key={tool} className={`${styles['scope-row']} ${styles.editable}`}>
        <span>{tool}</span>
        <div className={styles['permission-segment']}>
          {TOOL_PERMISSION_LABELS.map((option) => (
            <button
              key={option}
              className={`${defaultToolPermission(agent.tools, tool) === option ? styles.active : ''}`}
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
);

/* ── AgentMiniLog ── */

export const AgentMiniLog: React.FC<{ recentEvents: AgentRecentEvent[] }> = ({ recentEvents }) => (
  <section className={styles['agent-mini-log']}>
    <div className={styles['section-title-row']}>
      <h3>最近运行</h3>
      <span>{recentEvents.length} 条</span>
    </div>
    {recentEvents.map((evt, i) => (
      <div key={i}>
        <time>{evt.time}</time>
        <span>{evt.text}</span>
      </div>
    ))}
  </section>
);

/* ── AgentDetailHead ── */

export const AgentDetailHead: React.FC<{
  agent: AgentConfig;
  saveStateLabel: string;
  isDirty: boolean;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
}> = ({ agent, saveStateLabel, isDirty, onAgentProfileOpen }) => (
  <div className={`${styles['detail-head']} ${styles.editable}`}>
    <AgentAvatar agent={agent} onAgentProfileOpen={onAgentProfileOpen} />
    <div>
      <h2>{agent.name}</h2>
      <span>{agent.role.trim() || 'Hub 配置档案'}</span>
    </div>
    <span className={`${styles['agent-save-state']} ${isDirty ? styles.dirty : ''}`}>
      {saveStateLabel}
    </span>
  </div>
);

/* ── AgentRuntimeLine ── */

export const AgentRuntimeLine: React.FC<{ agent: AgentConfig }> = ({ agent }) => (
  <div className={styles['agent-runtime-line']}>
    <span className={`${styles.state} ${stateClass(agent.state)}`} />
    <RuntimeBrandIcon kind="runtime" name={agent.runtimeId ?? agent.engine} size="compact" framed={false} />
    <strong>{agent.engine}</strong>
    <em>{agent.provider ? `${agent.provider} / ${agent.model}` : agent.model}</em>
  </div>
);

/* ── AgentCapabilityStrip ── */

interface CapabilitySummary {
  agentsMd: string;
  skills: string;
  mcp: string;
  memory: string;
  tools: string;
  avatar: string;
  readiness: string;
}

const READINESS_LABEL: Record<string, string> = {
  ready: '就绪',
  partial: '部分就绪',
  blocked: '受阻',
};

export const AgentCapabilityStrip: React.FC<{
  agent: AgentConfig;
  capabilitySummary: CapabilitySummary;
}> = ({ agent, capabilitySummary }) => (
  <div className={styles['agent-capability-strip']} aria-label={`${agent.name} 能力就绪状态`}>
    <CapabilityBadge label="工作区说明" value={capabilitySummary.agentsMd} />
    <CapabilityBadge label="技能" value={capabilitySummary.skills} />
    <CapabilityBadge label="MCP" value={capabilitySummary.mcp} />
    <CapabilityBadge label="记忆" value={capabilitySummary.memory} />
    <CapabilityBadge label="工具" value={capabilitySummary.tools} />
    <CapabilityBadge label="头像" value={capabilitySummary.avatar} />
    <span className={`${styles['capability-readiness']} ${styles[capabilitySummary.readiness]}`}>
      {READINESS_LABEL[capabilitySummary.readiness] ?? capabilitySummary.readiness}
    </span>
  </div>
);

/* ── AgentConfigSummary ── */

export const AgentConfigSummary: React.FC<{
  agent: AgentConfig;
  capabilitySummary: CapabilitySummary;
}> = ({ agent, capabilitySummary }) => (
  <div className={styles['agent-config-summary']} aria-label={`${agent.name} 配置摘要`}>
    <ConfigSummaryRow label="工作区说明" value={capabilitySummary.agentsMd} />
    <ConfigSummaryRow label="MCP" value={formatList(agent.mcpServers, '未绑定 MCP')} />
    <ConfigSummaryRow label="记忆" value={agent.memorySummary || formatList(agent.memorySources, '未声明记忆源')} />
    <ConfigSummaryRow label="审批" value={agent.approvalMode ? `${agent.approvalMode} · ${agent.approval}` : agent.approval} />
    <ConfigSummaryRow label="目标" value={agent.targetPreference || formatList(agent.targetPreferences, '未声明目标')} />
  </div>
);

/* ── AgentEditActions ── */

export const AgentEditActions: React.FC<{
  isBusy: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onAgentSave?: (() => void) | undefined;
  onAgentDuplicate?: (() => void) | undefined;
  onAgentDelete?: (() => void) | undefined;
}> = ({ isBusy, isSaving, isDeleting, onAgentSave, onAgentDuplicate, onAgentDelete }) => (
  <div className={styles['agent-edit-actions']} aria-busy={isBusy ? 'true' : undefined}>
    <Button
      variant="primary"
      type="button"
      disabled={isBusy}
      onClick={onAgentSave}
    >
      {isSaving ? '保存中' : '保存配置'}
    </Button>
    <Button
      variant="secondary"
      type="button"
      disabled={isBusy}
      onClick={onAgentDuplicate}
    >
      复制 Agent
    </Button>
    <Button
      variant="destructive"
      type="button"
      disabled={isBusy}
      onClick={onAgentDelete}
    >
      {isDeleting ? '删除中' : '删除'}
    </Button>
  </div>
);
