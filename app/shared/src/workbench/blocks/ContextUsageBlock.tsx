import React from 'react';
import styles from './ContextUsageBlock.module.css';

interface ContextUsageBlockProps {
  /** Number of input (prompt) tokens consumed */
  inputTokens: number;
  /** Number of output (completion) tokens consumed */
  outputTokens: number;
  /** Context window limit, shown as the third stat when provided. */
  contextLimit?: number | undefined;
  /** Cache hit percentage (0-100), shown as additional stat when provided */
  cachePercent?: number | undefined;
  /** Formatted cost string, e.g. "$0.44" */
  cost?: string | undefined;
  /** Usage percentage (0-100) for the progress bar fill */
  usagePercent: number;
  /** Model or run label displayed below the stats grid */
  modelLabel?: string | undefined;
}

const fmt = (n: number): string =>
  new Intl.NumberFormat('en-US').format(n);

export const ContextUsageBlock: React.FC<ContextUsageBlockProps> = ({
  inputTokens,
  outputTokens,
  contextLimit,
  cachePercent,
  cost,
  usagePercent,
  modelLabel,
}) => {
  const totalTokens = inputTokens + outputTokens;
  const clampedPercent = Math.min(100, Math.max(0, usagePercent));
  const capacityLabel = contextLimit != null ? 'limit' : 'total';
  const capacityValue = contextLimit ?? totalTokens;

  return (
    <div className={styles.row}>
      <div className={`${styles.block} context-usage-block`} data-card-surface>
        <div className={styles.head}>
          <strong className={styles.headTitle}>上下文使用</strong>
          <em className={styles.headPercent}>{Math.round(clampedPercent)}%</em>
        </div>

        <div className={`${styles.bar} context-bar`}>
          <span
            className={styles.barFill}
            style={{ width: `${clampedPercent}%` }}
          />
        </div>

        <div className={`${styles.stats} context-stats`}>
          <span>
            input{' '}
            <strong>{fmt(inputTokens)}</strong>
          </span>
          <span>
            output{' '}
            <strong>{fmt(outputTokens)}</strong>
          </span>
          <span>
            {capacityLabel}{' '}
            <strong>{fmt(capacityValue)}</strong>
          </span>
          <span>
            cost{' '}
            <strong>{cost != null ? cost : '—'}</strong>
          </span>
        </div>

        {cachePercent != null && (
          <small className={styles.cacheNote}>
            缓存命中 {Math.round(cachePercent)}%
          </small>
        )}

        {modelLabel && (
          <small className={styles.modelLabel}>{modelLabel}</small>
        )}
      </div>
    </div>
  );
};
