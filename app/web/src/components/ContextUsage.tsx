import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  breakdownContext,
  toSegments,
  formatTokens,
  formatCost,
  type SessionMetrics,
} from '@shared/context/breakdown';
import { MetricGrid } from '@shared/ui';
import styles from './ContextUsage.module.css';

const SEGMENT_COLORS: Record<string, string> = {
  system: 'var(--info)',
  user: 'var(--primary)',
  assistant: 'var(--success)',
  tool: 'var(--warning)',
  other: 'var(--muted-foreground)',
};

interface Props {
  metrics: SessionMetrics | null;
  compact?: boolean;
}

export default function ContextUsage({ metrics, compact = false }: Props) {
  const { t } = useTranslation();
  const breakdown = useMemo(() => {
    if (!metrics || !metrics.inputTokens) return null;
    return breakdownContext(metrics.messages ?? [], metrics.inputTokens);
  }, [metrics]);

  const segments = useMemo(() => {
    if (!breakdown) return [];
    return toSegments(breakdown);
  }, [breakdown]);

  if (!metrics || !metrics.totalTokens) return null;

  const usagePercent =
    metrics.contextLimit != null && metrics.contextLimit > 0
      ? Math.round((metrics.totalTokens / metrics.contextLimit) * 100)
      : null;

  const isWarning = usagePercent != null && usagePercent >= 70 && usagePercent < 90;
  const isDanger = usagePercent != null && usagePercent >= 90;

  const barClass = [
    styles.bar,
    isDanger ? styles.barDanger : '',
    isWarning ? styles.barWarning : '',
  ]
    .filter(Boolean)
    .join(' ');

  const containerClass = compact ? `${styles.section} ${styles.compact}` : styles.section;

  if (compact) {
    return (
      <div className={containerClass}>
        <div className={barClass}>
          {segments.map((seg) => (
            <div
              key={seg.key}
              className={styles.segment}
              style={{
                width: `${seg.width}%`,
                backgroundColor: SEGMENT_COLORS[seg.key],
              }}
            />
          ))}
        </div>
        {usagePercent != null && (
          <div className={styles.usageText}>
            {usagePercent}% of {formatTokens(metrics.contextLimit ?? 200000)} used
          </div>
        )}
      </div>
    );
  }

  const metricItems = [
    { id: 'input', value: formatTokens(metrics.inputTokens), label: t('run.context.input') },
    { id: 'output', value: formatTokens(metrics.outputTokens), label: t('run.context.output') },
    { id: 'total', value: formatTokens(metrics.totalTokens), label: t('run.context.total') },
  ];

  return (
    <div className={containerClass}>
      {/* Context bar */}
      <div className={barClass}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={styles.segment}
            style={{
              width: `${seg.width}%`,
              backgroundColor: SEGMENT_COLORS[seg.key],
            }}
          />
        ))}
      </div>

      {/* Percentage display */}
      {usagePercent != null && (
        <div className={styles.usageText}>
          {t('run.context.usage', {
            percent: usagePercent,
            limit: formatTokens(metrics.contextLimit ?? 200000),
          })}
        </div>
      )}

      <MetricGrid
        className={styles.statsGrid ?? ''}
        itemClassName={styles.statRow ?? ''}
        valueClassName={styles.statValue ?? ''}
        labelClassName={styles.statLabel ?? ''}
        items={metricItems}
      />

      {/* Role breakdown legend */}
      {segments.length > 0 && (
        <div className={styles.legend}>
          {segments.map((seg) => (
            <div key={seg.key} className={styles.legendItem}>
              <span
                className={styles.legendDot}
                style={{ backgroundColor: SEGMENT_COLORS[seg.key] }}
              />
              <span className={styles.legendLabel}>{t(`run.context.segment.${seg.key}`)}</span>
              <span className={styles.legendValue}>
                {formatTokens(seg.tokens)} ({seg.percent}%)
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Cost display */}
      {metrics.totalCost != null && (
        <div className={styles.costRow}>
          <span className={styles.costLabel}>
            {[metrics.provider, metrics.model].filter(Boolean).join(' / ') || t('run.context.cost')}
          </span>
          <span className={styles.costValue}>{formatCost(metrics.totalCost)}</span>
        </div>
      )}
    </div>
  );
}
