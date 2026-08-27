import React from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import chipStyles from './AgentHubWorkbench.module.css';
import styles from './WorkbenchGoalBanner.module.css';
import type { WorkbenchGoalStatus, WorkbenchGoalSummary } from './workbenchGoalSummary';

/**
 * Conversation goal banner (#1998, UX F8). Projection of the transcript's
 * goal tool calls (see `workbenchGoalSummary`) shown between the workspace
 * header and the transcript of conversations that have a derivable goal.
 *
 * Honest-control contract: the stop entry renders ONLY when the shell wired
 * `onCancelRun`; the Hub has no pause channel, so no pause button is ever
 * rendered. The status chip reuses the attention-model chip classes and
 * OKLCH token palette — no second status-color system.
 */
export interface WorkbenchGoalBannerProps {
  summary: WorkbenchGoalSummary;
  /** Stop the active run; absent = no control surface at all (fail-closed). */
  onCancelRun?: (() => void) | undefined;
}

/** Attention-chip color slot per goal status (existing palette, no new colors). */
const GOAL_STATUS_CHIP_KIND: Record<WorkbenchGoalStatus, 'running' | 'awaiting' | 'goal-complete'> = {
  active: 'running',
  blocked: 'awaiting',
  completed: 'goal-complete',
};

const GOAL_STATUS_LABEL_KEY: Record<WorkbenchGoalStatus, string> = {
  active: 'goalBanner.status.active',
  blocked: 'goalBanner.status.blocked',
  completed: 'goalBanner.status.completed',
};

export function WorkbenchGoalBanner({
  summary,
  onCancelRun,
}: WorkbenchGoalBannerProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  return (
    <section
      aria-label={t('goalBanner.aria')}
      className={styles.goalBanner}
      data-goal-status={summary.status}
    >
      <span
        className={chipStyles.mainchainAttentionChip}
        data-attention-kind={GOAL_STATUS_CHIP_KIND[summary.status]}
      >
        <span aria-hidden="true" className={chipStyles.mainchainAttentionDot} />
        {t(GOAL_STATUS_LABEL_KEY[summary.status])}
      </span>
      <p className={styles.goalObjective} title={summary.objective}>
        {summary.objective}
      </p>
      {onCancelRun ? (
        <button
          aria-label={t('goalBanner.stopAria')}
          className={styles.goalStop}
          onClick={onCancelRun}
          type="button"
        >
          {t('goalBanner.stop')}
        </button>
      ) : null}
    </section>
  );
}
