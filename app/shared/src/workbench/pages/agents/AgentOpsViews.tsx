import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_ICON_SIZE,
} from '../../designIcons';
import { RuntimeBrandIcon } from '../../RuntimeBrandIcon';
import styles from '../AgentsPage.module.css';
import { permissionClass, riskClass } from './shared';
import type { AgentsPageProps } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Ops cluster views — 运行策略 / 工具权限 / 模型配置 / 审计日志.

   Extracted from AgentsPage as Phase 17 strangler slice #560.
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   3. 运行策略 (Policy)
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentPolicyView: React.FC<AgentsPageProps> = (props) => {
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

export const AgentToolsView: React.FC<AgentsPageProps> = (props) => {
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

export const AgentModelsView: React.FC<AgentsPageProps> = (props) => {
  const {
    models = [],
    modelRoutes = [],
    modelHealthRows = [],
    onModelAdd,
    onModelRouteClick,
    ccSwitchStatus,
    ccSwitchProviders = [],
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

      {/* cc-switch proxy status */}
      {ccSwitchStatus && (
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
      )}

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

export const AgentAuditView: React.FC<AgentsPageProps> = (props) => {
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
