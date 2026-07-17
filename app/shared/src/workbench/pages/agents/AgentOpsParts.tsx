import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_ICON_SIZE,
} from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import styles from '../AgentsPage.module.css';
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
   Shared ops-view presentational subpanels.

   Extracted from AgentOpsViews as Phase 23 residual thin #629.
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
      <div className={styles['tool-matrix-head']}>
        <span>Agent</span>
        {toolMatrixTools.map((tool) => (
          <span key={tool} className={styles['tool-head-cell']}>
            <RuntimeBrandIcon kind="tool" name={tool} size="compact" framed={false} />
            {tool}
          </span>
        ))}
      </div>
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
      <span className={`${styles['ccswitch-badge']} ${ccSwitchStatus.routingActive ? styles.active : styles.inactive}`}>
        {ccSwitchStatus.routingActive ? '已连接' : '未启用'}
      </span>
    </div>
    <div className={styles['ccswitch-status-grid']}>
      <div className={styles['ccswitch-status-row']}>
        <span>安装状态</span>
        <strong>{ccSwitchStatus.installed ? '已安装' : '未检测到'}</strong>
      </div>
      <div className={styles['ccswitch-status-row']}>
        <span>路由状态</span>
        <strong>{ccSwitchStatus.routingActive ? '活跃' : '未启用'}</strong>
      </div>
      {ccSwitchStatus.proxyPort ? (
        <div className={styles['ccswitch-status-row']}>
          <span>代理端口</span>
          <strong>{ccSwitchStatus.proxyPort}</strong>
        </div>
      ) : null}
      {ccSwitchStatus.activeAppTypes?.length ? (
        <div className={styles['ccswitch-status-row']}>
          <span>活跃应用</span>
          <strong>{ccSwitchStatus.activeAppTypes.join(', ')}</strong>
        </div>
      ) : null}
    </div>
    {ccSwitchProviders.filter((p) => p.isCurrent).map((provider) => (
      <div key={provider.providerId} className={styles['ccswitch-provider']}>
        <div className={styles['section-title-row']}>
          <h3>{provider.providerName}</h3>
          <span>current provider</span>
        </div>
        {provider.modelAliases && Object.keys(provider.modelAliases).length > 0 ? (
          <div className={styles['ccswitch-alias-grid']}>
            {Object.entries(provider.modelAliases)
              .filter(([key]) => !key.endsWith('_name'))
              .map(([alias, resolved]) => (
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
    ))}
  </section>
);

export const ModelCardsGrid: React.FC<{
  models: ModelInfo[];
}> = ({ models }) => (
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
      <div key={row.name} className={styles['model-health-row']}>
        <RuntimeBrandIcon kind="model" name={row.name} size="compact" framed={false} />
        <strong>{row.name}</strong>
        <span>{row.status}</span>
        <em>{row.meta}</em>
      </div>
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
);
