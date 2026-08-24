import React from 'react';
import { DesignNavIcon } from '../../designIcons';
import { EmptyState } from '@shared/ui';
import styles from '../AgentsPage.module.css';
import {
  AuditEntriesSection,
  AuditFilterBar,
  CcSwitchStatusSection,
  ModelCardsGrid,
  ModelHealthSection,
  ModelRoutingSection,
  PolicyApprovalSection,
  PolicyMatrixSection,
  ToolPermissionLegend,
  ToolPermissionMatrix,
} from './AgentOpsParts';
import type { AgentsPageProps } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Ops cluster views — 运行策略 / 工具权限 / 模型配置 / 审计日志.

   Extracted from AgentsPage as Phase 17 strangler slice #560.
   Residual thin: presentational subpanels live in AgentOpsParts (#629).
   CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   3. 运行策略 (Policy)
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentPolicyView: React.FC<AgentsPageProps> = (props) => {
  const {
    dataSource,
    policyRules = [],
    onPolicyAdd,
    approvalReadAuto = true,
    approvalWriteConfirm = true,
    approvalHighRiskDeny = true,
    approvalAuditEvents = false,
    onApprovalToggle,
  } = props;

  const realNoPolicy = dataSource === 'real' && policyRules.length === 0;
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
            {dataSource === 'real'
              ? '配置 Agent 执行边界、审批默认值和风险分级。策略数据由真实后端提供。'
              : '配置 Agent 执行边界、审批默认值和风险分级。这里展示前端 demo 的策略矩阵。'}
          </p>
        </div>
        {onPolicyAdd && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onPolicyAdd}>
            <DesignNavIcon name="plus" size={15} />
            新增策略
          </button>
        )}
      </div>

      <div className={styles['agent-policy-layout']}>
        {realNoPolicy ? (
          <EmptyState
            title="策略数据当前不可用"
            description="real 模式未接入真实策略数据源，暂无策略可展示。"
            titleLevel={3}
          />
        ) : (
          <PolicyMatrixSection policyRules={policyRules} />
        )}
        <PolicyApprovalSection checks={checks} onApprovalToggle={onApprovalToggle} />
      </div>
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   4. 工具权限 (Tools)
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentToolsView: React.FC<AgentsPageProps> = (props) => {
  const {
    dataSource,
    toolMatrixAgents = [],
    toolMatrixTools = [],
    onToolsAddAgent,
  } = props;
  const realNoTools = dataSource === 'real' && toolMatrixAgents.length === 0;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>工具权限</h1>
          <p className={styles['head-subcopy']}>
            按 Agent 查看工具授权。权限值可在“Agent 配置”页直接修改，这里做集中总览。
          </p>
        </div>
        {onToolsAddAgent && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onToolsAddAgent}>
            <DesignNavIcon name="plus" size={15} />
            添加 Agent
          </button>
        )}
      </div>

      {realNoTools ? (
        <EmptyState
          title="工具权限矩阵当前不可用"
          description="real 模式未接入真实工具权限数据源，暂无工具矩阵可展示。"
          titleLevel={3}
        />
      ) : (
        <ToolPermissionMatrix
          toolMatrixAgents={toolMatrixAgents}
          toolMatrixTools={toolMatrixTools}
        />
      )}
      <ToolPermissionLegend />
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   5. 模型配置 (Models)
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentModelsView: React.FC<AgentsPageProps> = (props) => {
  const {
    dataSource,
    models = [],
    modelRoutes = [],
    modelHealthRows = [],
    onModelAdd,
    onModelRouteClick,
    ccSwitchStatus,
    ccSwitchProviders = [],
  } = props;
  const realNoHealth = dataSource === 'real' && modelHealthRows.length === 0;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>模型配置</h1>
          <p className={styles['head-subcopy']}>
            {dataSource === 'real'
              ? '定义可选模型、默认用途和 Agent 分配。模型健康数据由真实后端提供。'
              : '定义可选模型、默认用途和 Agent 分配。当前 demo 只修改前端展示状态。'}
          </p>
        </div>
        {onModelAdd && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onModelAdd}>
            <DesignNavIcon name="plus" size={15} />
            添加模型
          </button>
        )}
      </div>

      {ccSwitchStatus ? (
        <CcSwitchStatusSection
          ccSwitchStatus={ccSwitchStatus}
          ccSwitchProviders={ccSwitchProviders}
        />
      ) : null}

      <ModelCardsGrid models={models} />
      <ModelRoutingSection modelRoutes={modelRoutes} onModelRouteClick={onModelRouteClick} />
      {realNoHealth ? (
        <EmptyState
          title="模型健康数据当前不可用"
          description="real 模式未接入真实模型健康数据源，暂无健康状态可展示。"
          titleLevel={3}
        />
      ) : (
        <ModelHealthSection modelHealthRows={modelHealthRows} />
      )}
    </main>
  );
};

/* ═══════════════════════════════════════════════════════════════════════
   6. 审计日志 (Audit)
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentAuditView: React.FC<AgentsPageProps> = (props) => {
  const {
    dataSource,
    auditEntries = [],
    activeAuditFilter = '全部',
    onAuditFilterChange,
    onAuditExport,
  } = props;
  const realNoAudit = dataSource === 'real' && auditEntries.length === 0;

  const filters = ['全部', '需确认', '禁止', '今天'];

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>审计日志</h1>
          <p className={styles['head-subcopy']}>
            {dataSource === 'real'
              ? '记录 Agent 工具调用、审批结果和目标资源。审计数据由真实后端提供。'
              : '记录 Agent 工具调用、审批结果和目标资源，用于 demo 中展示治理闭环。'}
          </p>
        </div>
        {onAuditExport && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onAuditExport}>
            <DesignNavIcon name="download" size={15} />
            导出日志
          </button>
        )}
      </div>

      <AuditFilterBar
        filters={filters}
        activeAuditFilter={activeAuditFilter}
        onAuditFilterChange={onAuditFilterChange}
      />
      {realNoAudit ? (
        <EmptyState
          title="审计日志当前不可用"
          description="real 模式未接入真实审计数据源，暂无审计记录可展示。"
          titleLevel={3}
        />
      ) : (
        <AuditEntriesSection auditEntries={auditEntries} />
      )}
    </main>
  );
};
