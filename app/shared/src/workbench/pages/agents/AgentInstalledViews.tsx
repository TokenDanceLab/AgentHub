import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '../../../i18n';
import { DesignNavIcon } from '../../designIcons';
import { EmptyState, RecoveryPanel, StatusNotice } from '../../../ui';
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

  return (
    <main className={`${styles['agent-main']} workbench-main`}>
      <div className={`${styles['workbench-head']} workbench-head`}>
        <div>
          <h1>{t('agents.installed.title')}</h1>
          <p className={styles['head-subcopy']}>
            查看 Agent 基础配置、skills 和工具权限；写入能力按 Hub / Edge 合同逐步接入。
          </p>
        </div>
        <button
          className={`${styles['outline-action']} outline-action`}
          type="button"
          onClick={onAgentAdd}
        >
          <DesignNavIcon name="plus" size={15} />
          添加 Agent
        </button>
      </div>

      {/* Summary strip */}
      <div className={styles['agent-summary-strip']}>
        <AgentStat label="已安装" value={installedCount} meta="active templates" />
        <AgentStat label="可运行" value={runnableCount} meta="running / ready" />
        <AgentStat label="需确认权限" value={confirmCount} meta="tool gates" />
        <AgentStat label="默认模型" value={defaultModelLabel} meta="routing" />
      </div>

      {/* Layout: list + edit panel */}
      <div className={styles['agent-layout']}>
        <section className={styles['agent-section']}>
          <div className={styles['section-title-row']}>
            <h2>已安装 Agent</h2>
            <span>{agentsLoading ? '同步中' : `${agents.length} active`}</span>
          </div>
          {agentsError && agents.length === 0 ? (
            <div className={styles.statusStack}>
              <RecoveryPanel
                {...(styles.recoveryPanel ? { className: styles.recoveryPanel } : {})}
                icon={<DesignNavIcon name="error404" size={18} />}
                eyebrow="Agent recovery"
                title="Agent 加载失败"
                description="无法从当前 Hub 读取已安装 Agent Profile。列表暂时不可用，重试后可重新同步。"
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
            {agents.length === 0 && !agentsLoading && !agentsError ? (
              <EmptyState
                title="暂无 Agent Profile"
                description="当前 Hub 账号还没有已安装 Agent。"
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
                  ? { action: { label: '添加 Agent', onClick: onAgentAdd } }
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
                    {agent.role} · {agent.engine}
                  </span>
                  <div className={styles['agent-capability-tags']}>
                    {deriveCapabilityTags(agent).map((tag) => (
                      <span
                        key={tag.label}
                        className={`${styles['capability-tag']} ${styles[tag.color]}`}
                      >
                        {tag.label}
                      </span>
                    ))}
                  </div>
                  <small>
                    {agent.targetPreference ? `Target: ${agent.targetPreference}` : agent.skills.join(' · ') || '未配置 skill'}
                  </small>
                </div>
                <em>{agent.provider ? `${agent.provider} / ${agent.model}` : agent.model}</em>
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
