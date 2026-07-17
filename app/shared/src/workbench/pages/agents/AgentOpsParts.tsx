import React from 'react';
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
}> = ({ policyRules }) => (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>策略矩阵</h2>
      <span>{policyRules.length} rules</span>
    </div>
    <div className={styles['agent-rule-list']}>
      {policyRules.map((rule) => (
        <PolicyRuleRow key={rule.name} rule={rule} />
      ))}
    </div>
  </section>
);

export const PolicyApprovalSection: React.FC<{
  checks: Array<{ label: string; checked: boolean }>;
  onApprovalToggle?: ((index: number, checked: boolean) => void) | undefined;
}> = ({ checks, onApprovalToggle }) => (
  <section className={`${styles['agent-section']} ${styles['policy-side']}`}>
    <div className={styles['section-title-row']}>
      <h2>默认审批流</h2>
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
      <strong>策略命中顺序</strong>
      <p>
        先匹配工具风险，再匹配目标资源，最后落到 Agent 自身权限。所有拒绝项写入审计日志。
      </p>
    </div>
  </section>
);

export const ToolPermissionMatrix: React.FC<{
  toolMatrixAgents: ToolMatrixAgent[];
  toolMatrixTools: string[];
}> = ({ toolMatrixAgents, toolMatrixTools }) => (
  <section className={styles['agent-section']}>
    <div className={styles['section-title-row']}>
      <h2>权限总览</h2>
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

export const ToolPermissionLegend: React.FC = () => (
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
);

export const CcSwitchStatusSection: React.FC<{
  ccSwitchStatus: CCSwitchStatusInfo;
  ccSwitchProviders?: CCSwitchProviderInfo[] | undefined;
}> = ({ ccSwitchStatus, ccSwitchProviders = [] }) => (
  <section className={styles['ccswitch-section']}>
    <div className={styles['section-title-row']}>
      <h2>cc-switch 透明代理</h2>
      <CcSwitchStatusBadge routingActive={ccSwitchStatus.routingActive} />
    </div>
    <CcSwitchStatusGrid status={ccSwitchStatus} />
    <CcSwitchCurrentProviders providers={ccSwitchProviders} />
  </section>
);

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
}> = ({ modelRoutes, onModelRouteClick }) => (
  <section className={`${styles['agent-section']} ${styles['model-routing']}`}>
    <div className={styles['section-title-row']}>
      <h2>路由规则</h2>
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

export const ModelHealthSection: React.FC<{
  modelHealthRows: ModelHealth[];
}> = ({ modelHealthRows }) => (
  <section className={`${styles['agent-section']} ${styles['model-health']}`}>
    <div className={styles['section-title-row']}>
      <h2>模型健康</h2>
      <span>mock</span>
    </div>
    {modelHealthRows.map((row) => (
      <ModelHealthRow key={row.name} row={row} />
    ))}
  </section>
);

export const AuditFilterBar: React.FC<{
  filters: string[];
  activeAuditFilter: string;
  onAuditFilterChange?: ((filter: string) => void) | undefined;
}> = ({ filters, activeAuditFilter, onAuditFilterChange }) => (
  <div className={styles['audit-filter-bar']}>
    {filters.map((filter) => (
      <AuditFilterChip
        key={filter}
        filter={filter}
        active={activeAuditFilter === filter}
        onAuditFilterChange={onAuditFilterChange}
      />
    ))}
  </div>
);

export const AuditEntriesSection: React.FC<{
  auditEntries: AuditEntry[];
}> = ({ auditEntries }) => (
  <section className={`${styles['agent-section']} ${styles['audit-section']}`}>
    <div className={styles['audit-head']}>
      <span>时间</span>
      <span>Agent</span>
      <span>工具</span>
      <span>结果</span>
      <span>目标</span>
    </div>
    {auditEntries.map((entry, i) => (
      <AuditEntryRow key={auditEntryKey(entry, i)} entry={entry} />
    ))}
  </section>
);
