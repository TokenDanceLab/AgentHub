import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
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

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const realNoPolicy = dataSource === 'real' && policyRules.length === 0;
  const checks = [
    { label: t('agents.ops.policy.approvalReadAuto'), checked: approvalReadAuto },
    { label: t('agents.ops.policy.approvalWriteConfirm'), checked: approvalWriteConfirm },
    { label: t('agents.ops.policy.approvalHighRiskDeny'), checked: approvalHighRiskDeny },
    { label: t('agents.ops.policy.approvalAuditEvents'), checked: approvalAuditEvents },
  ];

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.ops.policy.title')}</h1>
          <p className={styles['head-subcopy']}>
            {dataSource === 'real'
              ? t('agents.ops.policy.subcopyReal')
              : t('agents.ops.policy.subcopyDemo')}
          </p>
        </div>
        {onPolicyAdd && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onPolicyAdd}>
            <DesignNavIcon name="plus" size={15} />
            {t('agents.ops.policy.add')}
          </button>
        )}
      </div>

      <div className={styles['agent-policy-layout']}>
        {realNoPolicy ? (
          <EmptyState
            title={t('agents.ops.policy.emptyTitle')}
            description={t('agents.ops.policy.emptyDescription')}
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const realNoTools = dataSource === 'real' && toolMatrixAgents.length === 0;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.ops.tools.title')}</h1>
          <p className={styles['head-subcopy']}>
            {t('agents.ops.tools.subcopy')}
          </p>
        </div>
        {onToolsAddAgent && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onToolsAddAgent}>
            <DesignNavIcon name="plus" size={15} />
            {t('agents.ops.tools.addAgent')}
          </button>
        )}
      </div>

      {realNoTools ? (
        <EmptyState
          title={t('agents.ops.tools.emptyTitle')}
          description={t('agents.ops.tools.emptyDescription')}
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const realNoHealth = dataSource === 'real' && modelHealthRows.length === 0;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.ops.models.title')}</h1>
          <p className={styles['head-subcopy']}>
            {dataSource === 'real'
              ? t('agents.ops.models.subcopyReal')
              : t('agents.ops.models.subcopyDemo')}
          </p>
        </div>
        {onModelAdd && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onModelAdd}>
            <DesignNavIcon name="plus" size={15} />
            {t('agents.ops.models.add')}
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
          title={t('agents.ops.models.emptyTitle')}
          description={t('agents.ops.models.emptyDescription')}
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
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const realNoAudit = dataSource === 'real' && auditEntries.length === 0;

  // Filter identifiers (data plane): display labels resolve through
  // AuditFilterBar's i18n label map so the IDs stay stable. #2007
  const filters = ['全部', '需确认', '禁止', '今天'];

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.ops.audit.title')}</h1>
          <p className={styles['head-subcopy']}>
            {dataSource === 'real'
              ? t('agents.ops.audit.subcopyReal')
              : t('agents.ops.audit.subcopyDemo')}
          </p>
        </div>
        {onAuditExport && (
          <button className={`${styles['outline-action']} outline-action`} type="button" onClick={onAuditExport}>
            <DesignNavIcon name="download" size={15} />
            {t('agents.ops.audit.export')}
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
          title={t('agents.ops.audit.emptyTitle')}
          description={t('agents.ops.audit.emptyDescription')}
          titleLevel={3}
        />
      ) : (
        <AuditEntriesSection auditEntries={auditEntries} />
      )}
    </main>
  );
};
