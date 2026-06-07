import React from 'react';
import styles from './AgentTimeline.module.css';

interface AgentTimelineItem {
  /** Primary label (e.g. "初始化会话") */
  label: string;
  /** Secondary detail line (e.g. "模型、工具权限和当前项目上下文已加载") */
  detail?: string;
  /** Item state — maps to a coloured marker dot + right-aligned status text */
  status: string;
}

interface AgentTimelineProps {
  /** Section heading (defaults to "运行时间线") */
  title?: string;
  /** Ordered timeline items */
  items: AgentTimelineItem[];
}

/* Maps a status string to the CSS module class applied to the <li>. */
function statusClass(status: string): string {
  switch (status) {
    case 'completed':
    case 'done':
      return styles.completed ?? '';
    case 'running':
      return styles.running ?? '';
    case 'failed':
      return styles.failed ?? '';
    default:
      return '';
  }
}

/* Friendly status label matching the demo's statusLabel() convention. */
function statusLabel(status: string): string {
  switch (status) {
    case 'pending':
    case 'todo':
      return '待执行';
    case 'running':
      return '运行中';
    case 'completed':
    case 'done':
      return '完成';
    case 'failed':
      return '失败';
    default:
      return status;
  }
}

/**
 * AgentTimeline — an ordered list of timeline dots showing agent run steps.
 *
 * Mirrors the `.agent-timeline` block from the AgentHub Desktop demo:
 *   - header with title + item count
 *   - ordered list where each item has a circular marker dot,
 *     label + detail, and right-aligned status text.
 *
 * Marker colours:
 *   - done/completed → success green
 *   - running → primary blue
 *   - failed → danger red
 *   - todo/pending/other → neutral grey (default)
 */
export const AgentTimeline: React.FC<AgentTimelineProps> = ({
  title = '运行时间线',
  items,
}) => {
  return (
    <section className={`${styles.section} agent-timeline timeline-block`} aria-label={title}>
      <div className={styles.head}>
        <strong className={styles.headTitle}>{title}</strong>
        <span className={styles.headCount}>{items.length} items</span>
      </div>

      <ol className={styles.list}>
        {items.map((item, idx) => {
          const cls = statusClass(item.status);
          return (
            <li key={idx} className={[styles.item, cls].filter(Boolean).join(' ')}>
              {/* Circular marker with inner dot */}
              <span className={`${styles.marker} timeline-marker`} aria-hidden="true" />

              {/* Label + optional detail */}
              <div className={styles.itemBody}>
                <strong className={styles.itemLabel}>{item.label}</strong>
                {item.detail && (
                  <small className={styles.itemDetail}>{item.detail}</small>
                )}
              </div>

              {/* Right-aligned status text */}
              <em className={styles.itemStatus}>
                {statusLabel(item.status)}
              </em>
            </li>
          );
        })}
      </ol>
    </section>
  );
};
