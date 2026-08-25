import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComposerMention } from '@shared/composer';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import type {
  PendingDispatchQueueItemView,
  PendingIntentMove,
} from './composer/pendingIntents';
import styles from './AgentHubWorkbench.module.css';

/**
 * Visible dispatch-only queue for messages that are already persisted (#1965).
 * Controls affect the next Hub task dispatch, never the run currently in flight.
 */
export interface ComposerDispatchQueueProps {
  items: PendingDispatchQueueItemView[];
  isRunning: boolean;
  retargetOptions?: ComposerMention[] | undefined;
  onUndo: (messageId: string) => void;
  onMove: (messageId: string, move: PendingIntentMove) => void;
  onRetarget: (messageId: string, targetId: string) => void;
  onRetry: (messageId: string) => void;
  onClearAll: () => void;
}

function statusKey(item: PendingDispatchQueueItemView): string {
  if (item.status === 'failed') {
    return item.failureReason === 'retry-exhausted'
      ? 'composer.queue.statusRetryExhausted'
      : 'composer.queue.statusFailed';
  }
  if (item.status === 'dispatching') return 'composer.queue.statusDispatching';
  if (item.status === 'retrying') return 'composer.queue.statusRetrying';
  return 'composer.queue.statusQueued';
}

export const ComposerDispatchQueue = React.memo(function ComposerDispatchQueue({
  items,
  isRunning,
  retargetOptions,
  onUndo,
  onMove,
  onRetarget,
  onRetry,
  onClearAll,
}: ComposerDispatchQueueProps): React.ReactElement | null {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (items.length === 0) return null;
  const showRetarget = (retargetOptions?.length ?? 0) >= 2;
  const canClear = items.some((item) => item.status !== 'dispatching');

  return (
    <section
      aria-label={t('composer.queue.title')}
      className={styles.composerQueue}
      role="region"
    >
      <div className={styles.composerQueueHeader}>
        <div className={styles.composerQueueHeading}>
          <span className={styles.composerQueueTitle}>{t('composer.queue.title')}</span>
          <span aria-live="polite" className={styles.composerQueueSummary} role="status">
            {isRunning
              ? t('composer.queue.summaryRunning', { count: items.length })
              : t('composer.queue.summaryIdle', { count: items.length })}
          </span>
        </div>
        <button
          className={styles.composerQueueClear}
          disabled={!canClear}
          onClick={onClearAll}
          type="button"
        >
          {t('composer.queue.clearAll')}
        </button>
      </div>
      <p className={styles.composerQueueNotice}>{t('composer.queue.notice')}</p>
      <ol className={styles.composerQueueList}>
        {items.map((item, index) => {
          const dispatching = item.status === 'dispatching';
          const failed = item.status === 'failed';
          const previousDispatching = items[index - 1]?.status === 'dispatching';
          const nextDispatching = items[index + 1]?.status === 'dispatching';
          return (
            <li
              aria-label={t('composer.queue.item', {
                index: index + 1,
                text: item.text,
              })}
              className={styles.composerQueueItem}
              data-message-id={item.messageId}
              data-status={item.status}
              key={item.messageId}
            >
              <span aria-hidden="true" className={styles.composerQueueIndex}>
                {index + 1}
              </span>
              <span className={styles.composerQueueBody}>
                <span className={styles.composerQueuePreview}>{item.text}</span>
                <span className={styles.composerQueueMeta}>
                  <span className={styles.composerQueueAgent}>@{item.agentLabel}</span>
                  <span className={styles.composerQueueState}>
                    {t(statusKey(item), { attempt: item.attempt })}
                  </span>
                </span>
              </span>
              {showRetarget && (
                <select
                  aria-label={t('composer.queue.retarget', { text: item.text })}
                  className={styles.composerQueueRetarget}
                  disabled={dispatching}
                  onChange={(event) => {
                    if (event.target.value) onRetarget(item.messageId, event.target.value);
                  }}
                  value={item.agentId}
                >
                  {retargetOptions?.map((option) => (
                    <option key={option.id} value={option.id}>
                      @{option.label}
                    </option>
                  ))}
                </select>
              )}
              <span className={styles.composerQueueActions}>
                {failed && (
                  <button
                    className={styles.composerQueueTextButton}
                    onClick={() => onRetry(item.messageId)}
                    type="button"
                  >
                    {t('composer.queue.retry')}
                  </button>
                )}
                <button
                  aria-label={t('composer.queue.moveToFront', { text: item.text })}
                  className={styles.composerQueueActionButton}
                  disabled={dispatching || index === 0 || items[0]?.status === 'dispatching'}
                  onClick={() => onMove(item.messageId, 'front')}
                  type="button"
                >
                  ↥
                </button>
                <button
                  aria-label={t('composer.queue.moveUp', { text: item.text })}
                  className={styles.composerQueueActionButton}
                  disabled={dispatching || index === 0 || previousDispatching}
                  onClick={() => onMove(item.messageId, 'up')}
                  type="button"
                >
                  ↑
                </button>
                <button
                  aria-label={t('composer.queue.moveDown', { text: item.text })}
                  className={styles.composerQueueActionButton}
                  disabled={dispatching || index === items.length - 1 || nextDispatching}
                  onClick={() => onMove(item.messageId, 'down')}
                  type="button"
                >
                  ↓
                </button>
                <button
                  aria-label={t('composer.queue.undo', { text: item.text })}
                  className={styles.composerQueueTextButton}
                  disabled={dispatching}
                  onClick={() => onUndo(item.messageId)}
                  type="button"
                >
                  {t('composer.queue.undoAction')}
                </button>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
});
