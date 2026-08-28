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
    saveStateLabel,
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
  const resolvedSaveStateLabel = saveStateLabel ?? t('agents.installed.synced');
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
            {t('agents.installed.subcopy')}
          </p>
        </div>
        {onAgentAdd ? (
          <button
            className={`${styles['outline-action']} outline-action`}
            type="button"
            onClick={onAgentAdd}
          >
            <DesignNavIcon name="plus" size={15} />
            {t('agents.empty.add')}
          </button>
        ) : null}
      </div>

      {/* Summary strip */}
      <div className={styles['agent-summary-strip']}>
        <AgentStat label={t('agents.installed.stats.installed')} value={installedCount} meta={t('agents.installed.stats.installedMeta')} />
        <AgentStat label={t('agents.installed.stats.runnable')} value={runnableCount} meta={t('agents.installed.stats.runnableMeta')} />
        <AgentStat label={t('agents.installed.stats.confirm')} value={confirmCount} meta={t('agents.installed.stats.confirmMeta')} />
        <AgentStat label={t('agents.detail.model')} value={defaultModelLabel} meta={t('agents.installed.stats.defaultModelMeta')} />
      </div>

      {/* Layout: list + edit panel */}
      <div className={styles['agent-layout']}>
        <section className={styles['agent-section']}>
          <div className={styles['section-title-row']}>
            <h2>{t('agents.nav.installed')}</h2>
            <span>{agentsLoading ? t('agents.installed.syncing') : t('agents.installed.count', { count: agents.length })}</span>
          </div>
          {agentsError && agents.length === 0 ? (
            <div className={styles.statusStack}>
              <RecoveryPanel
                {...(styles.recoveryPanel ? { className: styles.recoveryPanel } : {})}
                icon={<DesignNavIcon name="error404" size={18} />}
                eyebrow={t('agents.installed.recovery.eyebrow')}
                title={t('agents.installed.recovery.title')}
                description={t('agents.installed.recovery.description')}
                meta={agentsError}
                primaryAction={{
                  label: t('agents.installed.recovery.retry'),
                  busyLabel: t('agents.installed.recovery.retrying'),
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
                          {t('agents.installed.recovery.retry')}
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
                      ? t('agents.installed.targetPrefix', { value: agent.targetPreference })
                      : agent.skills.length > 0
                        ? agent.skills.join(' · ')
                        : t('agents.installed.noSkills')}
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
            saveStateLabel={resolvedSaveStateLabel}
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
