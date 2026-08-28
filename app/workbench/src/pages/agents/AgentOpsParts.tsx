import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../AgentsPage.module.css';
import { auditEntryKey } from './AgentOpsHelpers';
import {
  AuditEntryRow,
  AuditFilterChip,
  CcSwitchCurrentProviders,
  CcSwitchStatusBadge,
  CcSwitchStatusGrid,
  ModelCard,
  ModelHealthRow,
  ModelRouteRow,
  PolicyApprovalCheck,
  PolicyRuleRow,
  ToolMatrixAgentRow,
  ToolMatrixHead,
} from './AgentOpsItemParts';
import type {
  AuditEntry,
  CCSwitchProviderInfo,
  CCSwitchStatusInfo,
  ModelHealth,
  ModelInfo,
  ModelRoute,
  PolicyRule,
  ToolMatrixAgent,
} from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Shared ops-view presentational subpanels.

   Extracted from AgentOpsViews as Phase 23 residual thin #629.
   Further residual thin: helpers + item parts (#684).
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const PolicyMatrixSection: React.FC<{
  policyRules: PolicyRule[];
}> = ({ policyRules }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.policy.matrixTitle')}</h2>
      <span>{policyRules.length} rules</span>
    </div>
    <div className={styles['agent-rule-list']}>
      {policyRules.map((rule) => (
        <PolicyRuleRow key={rule.name} rule={rule} />
      ))}
    </div>
  </section>
  );
};

export const PolicyApprovalSection: React.FC<{
  checks: Array<{ label: string; checked: boolean }>;
  onApprovalToggle?: ((index: number, checked: boolean) => void) | undefined;
}> = ({ checks, onApprovalToggle }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={`${styles['agent-section']} ${styles['policy-side']}`}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.policy.approvalTitle')}</h2>
      <span>demo</span>
    </div>
    {checks.map((item, i) => (
      <PolicyApprovalCheck
        key={i}
        label={item.label}
        checked={item.checked}
        index={i}
        onApprovalToggle={onApprovalToggle}
      />
    ))}
    <div className={styles['policy-note']}>
      <strong>{t('agents.ops.policy.hitOrderTitle')}</strong>
      <p>
        {t('agents.ops.policy.hitOrderDescription')}
      </p>
    </div>
  </section>
  );
};

export const ToolPermissionMatrix: React.FC<{
  toolMatrixAgents: ToolMatrixAgent[];
  toolMatrixTools: string[];
}> = ({ toolMatrixAgents, toolMatrixTools }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.tools.overviewTitle')}</h2>
      <span>{toolMatrixAgents.length} agents</span>
    </div>
    <div className={styles['tool-matrix']}>
      <ToolMatrixHead tools={toolMatrixTools} />
      {toolMatrixAgents.map((agent) => (
        <ToolMatrixAgentRow
          key={agent.id}
          agent={agent}
          tools={toolMatrixTools}
        />
      ))}
    </div>
  </section>
  );
};

export const ToolPermissionLegend: React.FC = () => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <div className={styles['permission-legend']}>
    <span>
      <i className={styles.allow} />
      {t('agents.ops.tools.legendAllow')}
    </span>
    <span>
      <i className={styles.confirm} />
      {t('agents.ops.tools.legendConfirm')}
    </span>
    <span>
      <i className={styles.deny} />
      {t('agents.ops.tools.legendDeny')}
    </span>
  </div>
  );
};

export const CcSwitchStatusSection: React.FC<{
  ccSwitchStatus: CCSwitchStatusInfo;
  ccSwitchProviders?: CCSwitchProviderInfo[] | undefined;
}> = ({ ccSwitchStatus, ccSwitchProviders = [] }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={styles['ccswitch-section']}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.ccSwitch.title')}</h2>
      <CcSwitchStatusBadge routingActive={ccSwitchStatus.routingActive} />
    </div>
    <CcSwitchStatusGrid status={ccSwitchStatus} />
    <CcSwitchCurrentProviders providers={ccSwitchProviders} />
  </section>
  );
};

export const ModelCardsGrid: React.FC<{
  models: ModelInfo[];
}> = ({ models }) => (
  <div className={styles['model-grid']}>
    {models.map((model) => (
      <ModelCard key={model.name} model={model} />
    ))}
  </div>
);

export const ModelRoutingSection: React.FC<{
  modelRoutes: ModelRoute[];
  onModelRouteClick?: ((agentId: string) => void) | undefined;
}> = ({ modelRoutes, onModelRouteClick }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={`${styles['agent-section']} ${styles['model-routing']}`}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.models.routingTitle')}</h2>
      <span>priority</span>
    </div>
    {modelRoutes.map((route) => (
      <ModelRouteRow
        key={route.agentId}
        route={route}
        onModelRouteClick={onModelRouteClick}
      />
    ))}
  </section>
  );
};

export const ModelHealthSection: React.FC<{
  modelHealthRows: ModelHealth[];
}> = ({ modelHealthRows }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={`${styles['agent-section']} ${styles['model-health']}`}>
    <div className={styles['section-title-row']}>
      <h2>{t('agents.ops.models.healthTitle')}</h2>
      <span>mock</span>
    </div>
    {modelHealthRows.map((row) => (
      <ModelHealthRow key={row.name} row={row} />
    ))}
  </section>
  );
};

/**
 * Audit filter identifiers are data values (they round-trip through
 * onAuditFilterChange and match AuditResult enums); only their display
 * labels resolve through i18n. Unknown IDs render verbatim. #2007
 */
const AUDIT_FILTER_LABEL_KEYS: Record<string, string> = {
  '全部': 'agents.ops.audit.filters.all',
  '需确认': 'agents.ops.audit.filters.needsConfirm',
  '禁止': 'agents.ops.audit.filters.denied',
  '今天': 'agents.ops.audit.filters.today',
};

export const AuditFilterBar: React.FC<{
  filters: string[];
  activeAuditFilter: string;
  onAuditFilterChange?: ((filter: string) => void) | undefined;
}> = ({ filters, activeAuditFilter, onAuditFilterChange }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <div className={styles['audit-filter-bar']}>
    {filters.map((filter) => {
      const labelKey = AUDIT_FILTER_LABEL_KEYS[filter];
      return (
        <AuditFilterChip
          key={filter}
          filter={filter}
          label={labelKey ? t(labelKey) : filter}
          active={activeAuditFilter === filter}
          onAuditFilterChange={onAuditFilterChange}
        />
      );
    })}
  </div>
  );
};

export const AuditEntriesSection: React.FC<{
  auditEntries: AuditEntry[];
}> = ({ auditEntries }) => {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
  <section className={`${styles['agent-section']} ${styles['audit-section']}`}>
    <div className={styles['audit-head']}>
      <span>{t('agents.ops.audit.headTime')}</span>
      <span>Agent</span>
      <span>{t('agents.ops.audit.headTool')}</span>
      <span>{t('agents.ops.audit.headResult')}</span>
      <span>{t('agents.ops.audit.headTarget')}</span>
    </div>
    {auditEntries.map((entry, i) => (
      <AuditEntryRow key={auditEntryKey(entry, i)} entry={entry} />
    ))}
  </section>
  );
};
