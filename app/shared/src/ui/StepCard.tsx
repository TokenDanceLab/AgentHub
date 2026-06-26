import React, { useEffect, useRef, useState } from 'react';
import type { EvidenceRefStatus } from '../transcript';
import styles from './StepCard.module.css';

export type StepCardStatus = EvidenceRefStatus;

export type SubStepKind = 'plan' | 'tool_call' | 'skill' | 'artifact' | 'text' | 'error';

/* ═══ Sub-step shape ═══ */

export interface StepCardSubStep {
  /** Unique key for React list rendering */
  key: string;
  /** Type of step — determines the icon */
  kind: SubStepKind;
  /** Brief human-readable description */
  label: string;
  /** Optional secondary detail */
  detail?: string;
  /** Step-level status */
  status?: StepCardStatus;
}

/* ═══ Props ═══ */

export interface StepCardProps {
  /** Group icon (emoji or short text) */
  icon: string;
  /** Task title shown in the header */
  title: string;
  /** Overall group status */
  status: StepCardStatus;
  /** Optional one-liner meta text */
  meta?: string;
  /** Whether the card starts expanded */
  defaultOpen?: boolean;
  /** Sub-steps rendered as a timeline in the expandable body */
  subSteps?: StepCardSubStep[];
  /** Arbitrary children rendered below sub-steps */
  children?: React.ReactNode;
}

/* ═══ Helpers ═══ */

function statusLabel(status: StepCardStatus): string {
  switch (status) {
    case 'pending': return '待执行';
    case 'running': return '运行中';
    case 'completed': return '完成';
    case 'failed': return '失败';
    default: return status;
  }
}

function statusClass(status: StepCardStatus): string {
  switch (status) {
    case 'running': return styles.running ?? '';
    case 'completed': return styles.completed ?? '';
    case 'failed': return styles.failed ?? '';
    case 'pending': return styles.pending ?? '';
    default: return '';
  }
}

function subStepStatusClass(status?: StepCardStatus): string {
  if (!status) return '';
  switch (status) {
    case 'running': return styles.stepRunning ?? '';
    case 'completed': return styles.stepCompleted ?? '';
    case 'failed': return styles.stepFailed ?? '';
    case 'pending': return styles.stepPending ?? '';
    default: return '';
  }
}

/* ═══ Component ═══ */

export function StepCard({
  icon,
  title,
  status,
  meta,
  defaultOpen = false,
  subSteps = [],
  children,
}: StepCardProps): React.ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  const collapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-collapse 3 s after completing
  useEffect(() => {
    if (collapseTimer.current) {
      clearTimeout(collapseTimer.current);
      collapseTimer.current = null;
    }

    if (status === 'completed' && open) {
      collapseTimer.current = setTimeout(() => {
        setOpen(false);
      }, 3000);
    }

    return () => {
      if (collapseTimer.current) {
        clearTimeout(collapseTimer.current);
        collapseTimer.current = null;
      }
    };
  }, [status, open]);

  const hasBody = (subSteps.length > 0) || Boolean(children);

  return (
    <section
      className={[
        styles.card,
        statusClass(status),
        open ? styles.open : '',
      ].filter(Boolean).join(' ')}
      data-step-card
      data-status={status}
    >
      <button
        aria-expanded={open}
        className={styles.header}
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className={styles.icon}>{icon}</span>
        <span className={styles.copy}>
          <strong className={styles.title}>{title}</strong>
          {meta && <small className={styles.meta}>{meta}</small>}
        </span>
        <span className={styles.statusIcon} data-status={status} aria-hidden="true" />
        <span className={styles.statusLabel}>{statusLabel(status)}</span>
        {hasBody && (
          <span className={styles.chevron} aria-hidden="true">
            <svg
              fill="none"
              height="14"
              viewBox="0 0 14 14"
              width="14"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M4 5.5L7 8.5L10 5.5"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.9"
              />
            </svg>
          </span>
        )}
      </button>

      {hasBody && (
        <div className={styles.body}>
          <div className={styles.bodyInner}>
            {subSteps.length > 0 && (
              <ol className={styles.timeline}>
                {subSteps.map((step) => (
                  <li
                    key={step.key}
                    className={[styles.timelineItem, subStepStatusClass(step.status)].filter(Boolean).join(' ')}
                  >
                    <span className={styles.timelineMarker} data-kind={step.kind} aria-hidden="true" />
                    <span className={styles.timelineCopy}>
                      <span className={styles.timelineLabel}>{step.label}</span>
                      {step.detail && (
                        <span className={styles.timelineDetail}>{step.detail}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {children}
          </div>
        </div>
      )}
    </section>
  );
}
