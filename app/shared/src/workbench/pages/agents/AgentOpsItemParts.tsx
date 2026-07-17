import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_ICON_SIZE,
} from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import styles from '../AgentsPage.module.css';
import {
  ccSwitchConnectionLabel,
  ccSwitchConnectionTone,
  ccSwitchInstallLabel,
  ccSwitchRoutingLabel,
  formatModelRouteSubtitle,
  hasVisibleModelAliases,
  listCurrentCcSwitchProviders,
  listModelAliases,
  policyRiskIconName,
  resolveToolPermission,
} from './AgentOpsHelpers';
import { permissionClass, riskClass } from './shared';
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
   AgentOpsItemParts — presentational residual slices from
   AgentOpsParts (#684).

   Policy/tool/cc-switch/model/audit leaf rows and cards. CSS stays on
   AgentsPage.module.css. No intentional UX change.
   ═══════════════════════════════════════════════════════════════════════ */

export const PolicyRuleRow: React.FC<{ rule: PolicyRule }> = ({ rule }) => (
  <button
    className={`${styles['agent-rule-row']} agent-card`}
    data-card-surface
    type="button"
  >
    <span className={styles['rule-icon']}>
      <DesignNavIcon
        name={policyRiskIconName(rule.riskLevel)}
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
);

export const PolicyApprovalCheck: React.FC<{
  label: string;
  checked: boolean;
  index: number;
  onApprovalToggle?: ((index: number, checked: boolean) => void) | undefined;
}> = ({ label, checked, index, onApprovalToggle }) => (
  <label className={styles['policy-check']}>
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onApprovalToggle?.(index, e.target.checked)}
    />
    <span>{label}</span>
  </label>
);

export const ToolMatrixHead: React.FC<{ tools: string[] }> = ({ tools }) => (
  <div className={styles['tool-matrix-head']}>
    <span>Agent</span>
    {tools.map((tool) => (
      <span key={tool} className={styles['tool-head-cell']}>
        <RuntimeBrandIcon kind="tool" name={tool} size="compact" framed={false} />
        {tool}
      </span>
    ))}
  </div>
);

export const ToolMatrixAgentRow: React.FC<{
  agent: ToolMatrixAgent;
  tools: string[];
}> = ({ agent, tools }) => (
  <button className={styles['tool-matrix-row']} type="button">
    <span className={styles['tool-agent-cell']}>
      <span
        className={styles['agent-symbol']}
        style={{ background: agent.color }}
      >
        {agent.initials}
      </span>
      <strong>{agent.name}</strong>
    </span>
    {tools.map((tool) => {
      const permission = resolveToolPermission(agent.permissions, tool);
      return (
        <em key={tool} className={styles[permissionClass(permission)]}>
          {permission}
        </em>
      );
    })}
  </button>
);

export const CcSwitchStatusBadge: React.FC<{
  routingActive: boolean;
}> = ({ routingActive }) => (
  <span
    className={`${styles['ccswitch-badge']} ${styles[ccSwitchConnectionTone(routingActive)]}`}
  >
    {ccSwitchConnectionLabel(routingActive)}
  </span>
);

export const CcSwitchStatusGrid: React.FC<{
  status: CCSwitchStatusInfo;
}> = ({ status }) => (
  <div className={styles['ccswitch-status-grid']}>
    <div className={styles['ccswitch-status-row']}>
      <span>安装状态</span>
      <strong>{ccSwitchInstallLabel(status.installed)}</strong>
    </div>
    <div className={styles['ccswitch-status-row']}>
      <span>路由状态</span>
      <strong>{ccSwitchRoutingLabel(status.routingActive)}</strong>
    </div>
    {status.proxyPort ? (
      <div className={styles['ccswitch-status-row']}>
        <span>代理端口</span>
        <strong>{status.proxyPort}</strong>
      </div>
    ) : null}
    {status.activeAppTypes?.length ? (
      <div className={styles['ccswitch-status-row']}>
        <span>活跃应用</span>
        <strong>{status.activeAppTypes.join(', ')}</strong>
      </div>
    ) : null}
  </div>
);

export const CcSwitchProviderCard: React.FC<{
  provider: CCSwitchProviderInfo;
}> = ({ provider }) => {
  const aliases = listModelAliases(provider.modelAliases);
  return (
    <div className={styles['ccswitch-provider']}>
      <div className={styles['section-title-row']}>
        <h3>{provider.providerName}</h3>
        <span>current provider</span>
      </div>
      {hasVisibleModelAliases(provider.modelAliases) ? (
        <div className={styles['ccswitch-alias-grid']}>
          {aliases.map(([alias, resolved]) => (
            <div key={alias} className={styles['ccswitch-alias-row']}>
              <span>{alias}</span>
              <em>&rarr;</em>
              <strong>{resolved}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className={styles['ccswitch-no-aliases']}>当前 Provider 无模型别名映射</p>
      )}
    </div>
  );
};

export const CcSwitchCurrentProviders: React.FC<{
  providers?: CCSwitchProviderInfo[] | undefined;
}> = ({ providers = [] }) => (
  <>
    {listCurrentCcSwitchProviders(providers).map((provider) => (
      <CcSwitchProviderCard key={provider.providerId} provider={provider} />
    ))}
  </>
);

export const ModelCard: React.FC<{ model: ModelInfo }> = ({ model }) => (
  <article className={`${styles['model-card']} agent-card`} data-card-surface>
    <RuntimeBrandIcon kind="model" name={model.name} size="large" />
    <div>
      <h2>{model.name}</h2>
      <p>{model.description}</p>
      <small>{model.assignedAgents}</small>
    </div>
    <span className={styles['model-state']}>{model.state}</span>
  </article>
);

export const ModelRouteRow: React.FC<{
  route: ModelRoute;
  onModelRouteClick?: ((agentId: string) => void) | undefined;
}> = ({ route, onModelRouteClick }) => (
  <button
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
      <small>{formatModelRouteSubtitle(route.role, route.mode)}</small>
    </div>
    <RuntimeBrandIcon kind="model" name={route.model} size="compact" framed={false} />
    <em>{route.model}</em>
  </button>
);

export const ModelHealthRow: React.FC<{ row: ModelHealth }> = ({ row }) => (
  <div className={styles['model-health-row']}>
    <RuntimeBrandIcon kind="model" name={row.name} size="compact" framed={false} />
    <strong>{row.name}</strong>
    <span>{row.status}</span>
    <em>{row.meta}</em>
  </div>
);

export const AuditFilterChip: React.FC<{
  filter: string;
  active: boolean;
  onAuditFilterChange?: ((filter: string) => void) | undefined;
}> = ({ filter, active, onAuditFilterChange }) => (
  <button
    className={`${active ? styles.active : ''}`}
    type="button"
    onClick={() => onAuditFilterChange?.(filter)}
  >
    {filter}
  </button>
);

export const AuditEntryRow: React.FC<{
  entry: AuditEntry;
}> = ({ entry }) => (
  <button className={styles['audit-row']} type="button">
    <time>{entry.time}</time>
    <strong>{entry.agent}</strong>
    <span>{entry.tool}</span>
    <em className={styles[permissionClass(entry.result)]}>
      {entry.result}
    </em>
    <small>{entry.target}</small>
  </button>
);
