// InlineDelegationCard — #1406 Phase 3
// Inline delegation status card mounted below a user message that triggered
// agent dispatch (dispatchRole='dispatch'). Subscribes to
// MessageDelegationStore by trigger_message_id and renders one compact card
// per associated agent task. Multi-agent → multiple cards stacked.
//
// Reuses SubagentTranscript for the expanded drill-down when
// SubagentStreamStore has events for the task (team-run case). For
// single-agent dispatch the expanded view shows a compact hint until the
// server emits team.subagent.stream for single-agent runs (remaining work).
//
// Pure consumer of existing WS frames — no protocol change.

import React, { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import {
  getMessageDelegationStore,
  type DelegationEntry,
  type DelegationStatus,
} from './MessageDelegationStore';
import { getSubagentStreamStore } from './SubagentStreamStore';
import { SubagentTranscript } from './SubagentTranscript';
import { Icon } from '@shared/ui/Icon';
import styles from './InlineDelegationCard.module.css';

// ── Status presentation ─────────────────────────────────────────────────────

interface StatusPresentation {
  labelKey: string;
  icon: string;
  colorClass: string;
}

function statusPresentation(status: DelegationStatus): StatusPresentation {
  switch (status) {
    case 'dispatching':
      return { labelKey: 'inlineDelegation.status.dispatching', icon: 'send', colorClass: styles.colorBlue! };
    case 'streaming':
      return { labelKey: 'inlineDelegation.status.streaming', icon: 'bolt', colorClass: styles.colorPurple! };
    case 'done':
      return { labelKey: 'inlineDelegation.status.done', icon: 'check_circle', colorClass: styles.colorGreen! };
    case 'failed':
      return { labelKey: 'inlineDelegation.status.failed', icon: 'error', colorClass: styles.colorRed! };
    case 'cancelled':
      return { labelKey: 'inlineDelegation.status.cancelled', icon: 'cancel', colorClass: styles.colorGray! };
  }
}

function isActiveStatus(status: DelegationStatus): boolean {
  return status === 'dispatching' || status === 'streaming';
}

// ── Store subscription bridge ───────────────────────────────────────────────

function subscribeToDelegation(cb: () => void): () => void {
  return getMessageDelegationStore().subscribe(cb);
}

function getDelegationSnapshot(): Record<string, DelegationEntry[]> {
  return getMessageDelegationStore().state.byMessageId;
}

function getServerSnapshot(): Record<string, DelegationEntry[]> {
  return {};
}

function useDelegationsByMessage(messageId: string | undefined): DelegationEntry[] {
  const byMessageId = useSyncExternalStore(subscribeToDelegation, getDelegationSnapshot, getServerSnapshot);
  return useMemo(() => {
    if (!messageId) return [];
    return byMessageId[messageId] ?? [];
  }, [byMessageId, messageId]);
}

// ── Single delegation card ─────────────────────────────────────────────────

interface DelegationCardProps {
  entry: DelegationEntry;
}

function DelegationCard({ entry }: DelegationCardProps): React.ReactElement {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const active = isActiveStatus(entry.status);
  const presentation = statusPresentation(entry.status);
  const avatarLetter = (entry.displayName[0] ?? '?').toUpperCase();
  const statusLabel = t(presentation.labelKey);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  // Read the current SubagentStreamStore snapshot for this task at render
  // time. Team-run dispatches populate it via team.subagent.stream frames;
  // single-agent dispatch does not (v1 shows a hint instead).
  const streamEvents = useMemo(
    () => getSubagentStreamStore().state.byTaskId[entry.taskId] ?? [],
    [entry.taskId, expanded, byTaskIdVersion],
  );

  return (
    <div
      className={`${styles.card} ${presentation.colorClass}`}
      data-delegation-status={entry.status}
    >
      <button
        type="button"
        className={styles.cardHeader}
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={`${entry.displayName}: ${statusLabel}`}
      >
        <span className={`${styles.avatar} ${active ? styles.avatarPulse : ''}`}>
          {avatarLetter}
        </span>
        <span className={styles.cardBody}>
          <span className={styles.cardLabel}>{entry.displayName}</span>
          <span className={`${styles.cardStatus} ${presentation.colorClass}`}>
            <Icon
              name={presentation.icon}
              size={14}
              {...(styles.statusIcon !== undefined ? { className: styles.statusIcon } : {})}
            />
            {statusLabel}
          </span>
        </span>
        <Icon name={expanded ? 'expand_less' : 'expand_more'} size={16} />
      </button>

      {expanded ? (
        <div className={styles.cardDetail}>
          {streamEvents.length > 0 ? (
            <SubagentTranscript events={streamEvents} />
          ) : (
            <div className={styles.detailHint} role="status">
              <Icon
                name="hourglass_empty"
                size={14}
                {...(styles.detailHintIcon !== undefined ? { className: styles.detailHintIcon } : {})}
              />
              <span>{t('inlineDelegation.emptyDetail')}</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

// Workaround: useSyncExternalStore does not observe SubagentStreamStore, so
// re-read the stream snapshot on each delegation snapshot change. This is a
// module-level version counter bumped by the delegation store subscription.
// It is read inside DelegationCard's useMemo deps to refresh the snapshot
// when the delegation store notifies.
let byTaskIdVersion = 0;
function bumpByTaskIdVersion(): void {
  byTaskIdVersion += 1;
}
// Subscribe once to bump the version on delegation store changes.
if (typeof window !== 'undefined') {
  getMessageDelegationStore().subscribe(bumpByTaskIdVersion);
}

// ── Public component ───────────────────────────────────────────────────────

export interface InlineDelegationCardProps {
  /** message_id of the user message to attach delegation cards to. */
  messageId?: string;
}

export function InlineDelegationCard({
  messageId,
}: InlineDelegationCardProps): React.ReactElement | null {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const entries = useDelegationsByMessage(messageId);
  if (entries.length === 0) return null;

  return (
    <div className={styles.stack} role="region" aria-label={t('inlineDelegation.ariaStack')} aria-live="polite">
      {entries.map((entry) => (
        <DelegationCard key={entry.taskId} entry={entry} />
      ))}
    </div>
  );
}
