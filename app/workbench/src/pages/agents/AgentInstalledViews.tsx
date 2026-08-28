import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignNavIcon } from '../../designIcons';
import { EmptyState, RecoveryPanel, StatusNotice } from '@shared/ui';
import { SkeletonBar } from '@shared/ui/SkeletonBar';
import styles from '../AgentsPage.module.css';
import { AgentEditPanel } from './AgentEditPanel';
import {
  AgentAvatar,
  AgentStat,
  deriveCapabilityTags,
  stateClass,
} from './AgentInstalledParts';
import type { AgentsPageProps } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Installed agents view — list + edit-panel shell.

   Extracted from AgentsPage as Phase 17 strangler slice #560.
   Residual thin (Phase 22 #616): edit panel / avatar / tags / helpers
   live in sibling modules. CSS remains on shared AgentsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export const AgentInstalledView: React.FC<AgentsPageProps> = (props) => {
  const {
    installedCount,
    runnableCount,
    confirmCount,
    defaultModelLabel,
    agents,
    agentsLoading = false,
    agentsError,
    agentActionError,
    onAgentsRetry,
    selectedAgentId,
    onAgentSelect,
    onAgentProfileOpen,
    saveStateLabel = '已同步',
    isDirty = false,
    allSkills = [],
    allTools = [],
    onAgentSave,
    onAgentDuplicate,
    onAgentDelete,
    onAgentAdd,
    savingAgentId,
    deletingAgentId,
    onAgentSkillToggle,
    onToolPermissionSet,
    onAgentFieldChange,
    recentEvents = [],
  } = props;

  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0];
  const selectedAgentBusy = Boolean(selectedAgent && (savingAgentId === selectedAgent.id || deletingAgentId === selectedAgent.id));
  const showInstalledSkeleton = agentsLoading && agents.length === 0 && !agentsError;
  const showInstalledEmpty = agents.length === 0 && !agentsLoading && !agentsError;

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.installed.title')}</h1>
          <p className={styles['head-subcopy']}>
            管理已安装的 Agent 配置、技能与工具权限。
          </p>
        </div>
        {onAgentAdd ? (
          <button
            className={`${styles['outline-action']} outline-action`}
            type="button"
            onClick={onAgentAdd}
          >
            <DesignNavIcon name="plus" size={15} />
            添加 Agent
          </button>
        ) : null}
      </div>

      {/* Summary strip */}
      <div className={styles['agent-summary-strip']}>
        <AgentStat label="已安装" value={installedCount} meta="配置档案" />
        <AgentStat label="可运行" value={runnableCount} meta="就绪 / 运行中" />
        <AgentStat label="需确认权限" value={confirmCount} meta="工具门禁" />
        <AgentStat label="默认模型" value={defaultModelLabel} meta="模型路由" />
      </div>

      {/* Layout: list + edit panel */}
      <div className={styles['agent-layout']}>
        <section className={styles['agent-section']}>
          <div className={styles['section-title-row']}>
            <h2>已安装</h2>
            <span>{agentsLoading ? '同步中' : `${agents.length} 个`}</span>
          </div>
          {agentsError && agents.length === 0 ? (
            <div className={styles.statusStack}>
              <RecoveryPanel
                {...(styles.recoveryPanel ? { className: styles.recoveryPanel } : {})}
                icon={<DesignNavIcon name="error404" size={18} />}
                eyebrow="恢复"
                title="Agent 加载失败"
                description="无法从当前 Hub 读取已安装配置。列表暂时不可用，请重试同步。"
                meta={agentsError}
                primaryAction={{
                  label: '重试',
                  busyLabel: '重试中…',
                  busy: agentsLoading,
                  icon: <DesignNavIcon name="refresh" size={14} />,
                  onClick: () => {
                    onAgentsRetry?.();
                  },
                  disabled: !onAgentsRetry,
                }}
              />
            </div>
          ) : null}
          {agentsError && agents.length > 0 ? (
            <div className={styles.statusStack}>
              <StatusNotice
                {...(styles.statusNotice ? { className: styles.statusNotice } : {})}
                icon={<DesignNavIcon name="error404" size={14} />}
                role="alert"
                {...(onAgentsRetry
                  ? {
                      action: (
                        <button
                          type="button"
                          className={styles.statusAction}
                          onClick={onAgentsRetry}
                        >
                          重试
                        </button>
                      ),
                    }
                  : {})}
              >
                {agentsError}
              </StatusNotice>
            </div>
          ) : null}
          <div className={styles['agent-config-list']}>
            {showInstalledSkeleton ? <AgentListSkeleton /> : null}
            {showInstalledEmpty ? (
              <EmptyState
                title={t('agents.empty.title')}
                description={t('agents.empty.description')}
                icon={<DesignNavIcon name="package" size={28} strokeWidth={1.5} />}
                titleLevel={3}
                {...(styles['agent-empty-compact']
                  ? { className: styles['agent-empty-compact'] }
                  : {})}
                {...(styles['agent-empty-compact-content']
                  ? { contentClassName: styles['agent-empty-compact-content'] }
                  : {})}
                {...(styles['agent-empty-compact-title']
                  ? { titleClassName: styles['agent-empty-compact-title'] }
                  : {})}
                {...(styles['agent-empty-compact-description']
                  ? { descriptionClassName: styles['agent-empty-compact-description'] }
                  : {})}
                {...(styles['agent-empty-compact-action']
                  ? { actionClassName: styles['agent-empty-compact-action'] }
                  : {})}
                {...(onAgentAdd
                  ? { action: { label: t('agents.empty.add'), onClick: onAgentAdd } }
                  : {})}
              />
            ) : null}
            {agents.map((agent) => (
              <button
                key={agent.id}
                className={`${styles['agent-config-row']} agent-config-row ${agent.id === selectedAgentId ? styles.selected : ''}`}
                type="button"
                disabled={deletingAgentId === agent.id}
                onClick={() => onAgentSelect?.(agent.id)}
              >
                <AgentAvatar agent={agent} onAgentProfileOpen={onAgentProfileOpen} />
                <div>
                  <strong>{agent.name}</strong>
                  <span>
                    {agent.engine}
                    {agent.provider ? ` · ${agent.provider}` : ''}
                  </span>
                  <div className={styles['agent-capability-tags']}>
                    {deriveCapabilityTags(agent, t).map((tag) => (
                      <span
                        key={tag.label}
                        className={`${styles['capability-tag']} ${styles[tag.color]}`}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <small>
                    {agent.targetPreference
                      ? `目标：${agent.targetPreference}`
                      : agent.skills.length > 0
                        ? agent.skills.join(' · ')
                        : '未配置技能'}
                  </small>
                </div>
                <em>{agent.model}</em>
                <span className={`${styles.state} ${stateClass(agent.state)}`} />
              </button>
            ))}
          </div>
        </section>

        {selectedAgent && (
          <AgentEditPanel
            agent={selectedAgent}
            actionError={agentActionError}
            saveStateLabel={saveStateLabel}
            isDirty={isDirty}
            isDeleting={deletingAgentId === selectedAgent.id}
            isSaving={savingAgentId === selectedAgent.id}
            isBusy={selectedAgentBusy}
            allSkills={allSkills}
            allTools={allTools}
            onAgentSave={onAgentSave}
            onAgentDuplicate={onAgentDuplicate}
            onAgentDelete={onAgentDelete}
            onAgentSkillToggle={onAgentSkillToggle}
            onAgentProfileOpen={onAgentProfileOpen}
            onToolPermissionSet={onToolPermissionSet}
            onFieldChange={onAgentFieldChange}
            recentEvents={recentEvents}
          />
        )}
      </div>
    </main>
  );
};

/* ── First-load skeleton rows (mirrors .agent-config-row grid) ── */

const AGENT_LIST_SKELETON_ROW: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '34px minmax(0, 1fr) minmax(116px, 148px) 14px',
  alignItems: 'center',
  gap: 'var(--sp-10)',
  minHeight: 66,
  padding: 'var(--td-space-2) var(--sp-10)',
  pointerEvents: 'none',
};

const AGENT_LIST_SKELETON_ROWS = 3;

function AgentListSkeleton(): React.ReactElement {
  return (
    <div aria-hidden="true" className={styles['agent-config-list']} data-testid="agent-list-skeleton">
      {Array.from({ length: AGENT_LIST_SKELETON_ROWS }, (_, i) => (
        <div key={i} style={AGENT_LIST_SKELETON_ROW}>
          <SkeletonBar variant="circle" width="34px" height="34px" />
          <div style={{ display: 'grid', gap: 6 }}>
            <SkeletonBar width="45%" height="14px" />
            <SkeletonBar width="70%" height="10px" />
          </div>
          <SkeletonBar width="85%" height="10px" />
          <SkeletonBar variant="circle" width="10px" height="10px" />
        </div>
      ))}
    </div>
  );
}
