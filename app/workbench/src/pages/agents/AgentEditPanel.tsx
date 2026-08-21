import React from 'react';
import { DesignNavIcon } from '../../designIcons';
import { buildAgentCapabilityContractFromConfig, buildAgentCapabilitySummary } from '../../agentCapabilities';
import { StatusNotice } from '@shared/ui';
import styles from '../AgentsPage.module.css';
import { AgentCapabilityStrip, AgentDetailHead, AgentEditActions, AgentEditGrid, AgentMcpMemorySection, AgentMiniLog, AgentRuntimeLine, AgentSkillChipGrid, AgentToolPermissions } from './AgentEditItemParts';
import { buildStatusNoticeClassName } from './AgentEditHelpers';
import type { AgentConfig, AgentRecentEvent, ToolPermission } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Agent edit panel shell — residual thin after extracting sub-parts
   to AgentEditItemParts + AgentEditHelpers (#695).

   #1280: default product detail is one primary frosted card. Capability
   strip + edit grid already carry readiness / policy fields, so the
   duplicate AgentConfigSummary block is omitted from this view.
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
  agent, actionError, saveStateLabel, isDirty, isSaving, isDeleting, isBusy,
  allSkills, allTools, onAgentSave, onAgentDuplicate, onAgentDelete,
  onAgentProfileOpen, onAgentSkillToggle, onToolPermissionSet, onFieldChange,
  recentEvents,
}) => {
  const capabilitySummary = buildAgentCapabilitySummary(
    buildAgentCapabilityContractFromConfig(agent),
  );

  return (
    <aside className={styles['agent-detail']}>
      <AgentDetailHead
        agent={agent} saveStateLabel={saveStateLabel}
        isDirty={isDirty} onAgentProfileOpen={onAgentProfileOpen}
      />
      <AgentRuntimeLine agent={agent} />
      <AgentCapabilityStrip agent={agent} capabilitySummary={capabilitySummary} />
      <AgentEditGrid agent={agent} onFieldChange={onFieldChange} />
      <AgentMcpMemorySection agent={agent} />
      <AgentSkillChipGrid
        agent={agent} allSkills={allSkills}
        onAgentSkillToggle={onAgentSkillToggle}
      />
      <AgentToolPermissions
        agent={agent} allTools={allTools}
        onToolPermissionSet={onToolPermissionSet}
      />
      <AgentMiniLog recentEvents={recentEvents} />
      {actionError ? (
        <StatusNotice
          {...buildStatusNoticeClassName(styles)}
          icon={<DesignNavIcon name="error404" size={14} />}
          role="alert"
        >
          {actionError}
        </StatusNotice>
      ) : null}
      <AgentEditActions
        isBusy={isBusy} isSaving={isSaving} isDeleting={isDeleting}
        onAgentSave={onAgentSave} onAgentDuplicate={onAgentDuplicate}
        onAgentDelete={onAgentDelete}
      />
    </aside>
  );
};
