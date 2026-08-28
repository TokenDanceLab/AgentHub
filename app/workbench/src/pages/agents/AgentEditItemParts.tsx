import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import { Button, Select } from '@shared/ui';
import styles from '../AgentsPage.module.css';
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
   Agent edit panel presentational sub-parts.

   Extracted from AgentEditPanel as Phase 29 residual thin #695.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════════════════════ */

/* ── AgentEditGrid ── */

export const AgentEditGrid: React.FC<{
  agent: AgentConfig;
  onFieldChange?: ((field: string, value: string) => void) | undefined;
}> = ({ agent, onFieldChange }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const fieldConfigs = getEditFieldConfigs(t);
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
              placeholder={t('agents.edit.notSet')}
              disabled={!onFieldChange}
              onChange={(e) => onFieldChange?.(field.key, e.target.value)}
            />
          )}
        </label>
      ))}
    </div>
  );
};

/* ── AgentMcpMemorySection ── */

export const AgentMcpMemorySection: React.FC<{ agent: AgentConfig }> = ({ agent }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={styles['agent-skill-editor']}>
      <div className={styles['section-title-row']}>
        <h3>{t('agents.edit.mcpMemoryTitle')}</h3>
        <span>{agent.memoryRetention || t('agents.edit.memoryPolicyPending')}</span>
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
};

/* ── AgentSkillChipGrid ── */

export const AgentSkillChipGrid: React.FC<{
  agent: AgentConfig;
  allSkills: string[];
  onAgentSkillToggle?: ((skill: string) => void) | undefined;
}> = ({ agent, allSkills, onAgentSkillToggle }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={styles['agent-skill-editor']}>
      <div className={styles['section-title-row']}>
        <h3>{t('agents.detail.skills')}</h3>
        <span>{t('agents.edit.skillsEnabled', { count: agent.skills.length })}</span>
      </div>
      <div className={styles['skill-chip-grid']}>
        {allSkills.map((skill) => (
          <button
            key={skill}
            className={`${styles['skill-chip']} ${agent.skills.includes(skill) ? styles.active : ''}`}
            type="button"
            disabled={!onAgentSkillToggle}
            title={!onAgentSkillToggle ? t('agents.edit.skillToggleUnavailable') : undefined}
            onClick={() => onAgentSkillToggle?.(skill)}
          >
            <RuntimeBrandIcon kind="tool" name={skill} size="compact" framed={false} decorative />
            {skill}
          </button>
        ))}
      </div>
    </section>
  );
};

/* ── AgentToolPermissions ── */

export const AgentToolPermissions: React.FC<{
  agent: AgentConfig;
  allTools: string[];
  onToolPermissionSet?: ((tool: string, value: ToolPermission) => void) | undefined;
}> = ({ agent, allTools, onToolPermissionSet }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={styles['editable-tools']}>
      <div className={styles['section-title-row']}>
        <h3>{t('agents.detail.tools')}</h3>
        {/* Legend mirrors the ToolPermission enum identifiers rendered below
            (data-plane direct display; cross-surface enum decision #2015). */}
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
                disabled={!onToolPermissionSet}
                title={!onToolPermissionSet ? t('agents.edit.toolPermissionUnavailable') : undefined}
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
};

/* ── AgentMiniLog ── */

export const AgentMiniLog: React.FC<{ recentEvents: AgentRecentEvent[] }> = ({ recentEvents }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <section className={styles['agent-mini-log']}>
      <div className={styles['section-title-row']}>
        <h3>{t('agents.detail.recentRuns')}</h3>
        <span>{t('agents.edit.eventCount', { count: recentEvents.length })}</span>
      </div>
      {recentEvents.map((evt, i) => (
        <div key={i}>
          <time>{evt.time}</time>
          <span>{evt.text}</span>
        </div>
      ))}
    </section>
  );
};

/* ── AgentDetailHead ── */

export const AgentDetailHead: React.FC<{
  agent: AgentConfig;
  saveStateLabel: string;
  isDirty: boolean;
  onAgentProfileOpen?: ((agent: AgentConfig, anchor: HTMLElement) => void) | undefined;
}> = ({ agent, saveStateLabel, isDirty, onAgentProfileOpen }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={`${styles['detail-head']} ${styles.editable}`}>
      <AgentAvatar agent={agent} onAgentProfileOpen={onAgentProfileOpen} />
      <div>
        <h2>{agent.name}</h2>
        <span>{agent.role.trim() || t('agents.edit.defaultRole')}</span>
      </div>
      <span className={`${styles['agent-save-state']} ${isDirty ? styles.dirty : ''}`}>
        {saveStateLabel}
      </span>
    </div>
  );
};

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

const READINESS_LABEL_KEY: Record<string, 'agents.edit.readiness.ready' | 'agents.edit.readiness.partial' | 'agents.edit.readiness.blocked'> = {
  ready: 'agents.edit.readiness.ready',
  partial: 'agents.edit.readiness.partial',
  blocked: 'agents.edit.readiness.blocked',
};

export const AgentCapabilityStrip: React.FC<{
  agent: AgentConfig;
  capabilitySummary: CapabilitySummary;
}> = ({ agent, capabilitySummary }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const readinessKey = READINESS_LABEL_KEY[capabilitySummary.readiness];
  return (
    <div className={styles['agent-capability-strip']} aria-label={t('agents.edit.capabilityAria', { name: agent.name })}>
      <CapabilityBadge label={t('agents.edit.capability.agentsMd')} value={capabilitySummary.agentsMd} />
      <CapabilityBadge label={t('agents.edit.capability.skills')} value={capabilitySummary.skills} />
      <CapabilityBadge label={t('agents.edit.capability.mcp')} value={capabilitySummary.mcp} />
      <CapabilityBadge label={t('agents.edit.capability.memory')} value={capabilitySummary.memory} />
      <CapabilityBadge label={t('agents.edit.capability.tools')} value={capabilitySummary.tools} />
      <CapabilityBadge label={t('agents.edit.capability.avatar')} value={capabilitySummary.avatar} />
      <span className={`${styles['capability-readiness']} ${styles[capabilitySummary.readiness]}`}>
        {readinessKey ? t(readinessKey) : capabilitySummary.readiness}
      </span>
    </div>
  );
};

/* ── AgentEditActions ── */

export const AgentEditActions: React.FC<{
  isBusy: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  onAgentSave?: (() => void) | undefined;
  onAgentDuplicate?: (() => void) | undefined;
  onAgentDelete?: (() => void) | undefined;
}> = ({ isBusy, isSaving, isDeleting, onAgentSave, onAgentDuplicate, onAgentDelete }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={styles['agent-edit-actions']} aria-busy={isBusy ? 'true' : undefined}>
      <Button
        variant="primary"
        type="button"
        disabled={isBusy || !onAgentSave}
        onClick={onAgentSave}
      >
        {isSaving ? t('agents.edit.saving') : t('agents.edit.save')}
      </Button>
      <Button
        variant="secondary"
        type="button"
        disabled={isBusy || !onAgentDuplicate}
        onClick={onAgentDuplicate}
      >
        {t('agents.edit.duplicate')}
      </Button>
      <Button
        variant="destructive"
        type="button"
        disabled={isBusy || !onAgentDelete}
        onClick={onAgentDelete}
      >
        {isDeleting ? t('agents.edit.deleting') : t('agents.edit.delete')}
      </Button>
    </div>
  );
};
