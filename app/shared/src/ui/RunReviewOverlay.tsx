// RunReviewOverlay — run-level aggregate diff review surface (#1967).
// Hosts DiffReviewPanel in a dialog overlay so a whole run's file changes
// can be reviewed (and accepted/rejected) in one place. The overlay owns no
// review state: the panel's hunk accept/reject machine stays the single
// contract, and write-back availability is whatever the host wires through
// (`runId` + apply ports) — surfaces without a write-back path show the
// host's honest read-only notice instead of faking an apply.
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { useFocusTrap } from './focusTrap';
import { DiffReviewPanel } from './DiffReviewPanel';
import type {
  DiffHunkDecision,
  DiffReviewFile,
  DiffReviewLabels,
} from './DiffReviewPanelTypes';
import styles from './RunReviewOverlay.module.css';

export interface RunReviewOverlayProps {
  open: boolean;
  /** Aggregated file changes of the run (see transcript/runChangeAggregate). */
  files: DiffReviewFile[];
  /** Dialog title (accessible name). */
  title: string;
  /** Accessible label for the close button. */
  closeLabel: string;
  /** Host-interpolated run summary line (e.g. "3 files · +12 −5"). */
  summary?: string | undefined;
  /**
   * Honest-boundary notice shown when the current surface cannot write
   * diffs back (Web Hub-only). Absent when write-back is wired.
   */
  readOnlyNotice?: string | undefined;
  /** Hide every accept/reject action; the overlay becomes inspection-only. */
  readOnly?: boolean | undefined;
  onClose: () => void;
  /** Edge run ID + apply ports — passed through to the panel unchanged. */
  runId?: string | undefined;
  onApplyHunk?: ((decision: DiffHunkDecision) => void | Promise<void>) | undefined;
  onApplyAllHunks?: ((decisions: DiffHunkDecision[]) => void | Promise<void>) | undefined;
  onAcceptRun?: (() => void) | undefined;
  onRejectRun?: (() => void) | undefined;
  panelLabels?: DiffReviewLabels | undefined;
  className?: string | undefined;
}

export function RunReviewOverlay({
  open,
  files,
  title,
  closeLabel,
  summary,
  readOnlyNotice,
  readOnly = false,
  onClose,
  runId,
  onApplyHunk,
  onApplyAllHunks,
  onAcceptRun,
  onRejectRun,
  panelLabels,
  className,
}: RunReviewOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(overlayRef, open);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Prevent body scroll while the overlay is open (Modal parity).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className={cx(styles.overlay, className)}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="run-review-overlay"
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          {summary ? <span className={styles.summary}>{summary}</span> : null}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={14} />
          </button>
        </div>
        {readOnlyNotice ? (
          <div className={styles.readOnlyNotice} role="status">
            {readOnlyNotice}
          </div>
        ) : null}
        <div className={styles.body}>
          <DiffReviewPanel
            files={files}
            runLevel
            readOnly={readOnly}
            {...(runId !== undefined ? { runId } : {})}
            {...(onApplyHunk ? { onApplyHunk } : {})}
            {...(onApplyAllHunks ? { onApplyAllHunks } : {})}
            {...(onAcceptRun ? { onAcceptRun } : {})}
            {...(onRejectRun ? { onRejectRun } : {})}
            {...(panelLabels ? { labels: panelLabels } : {})}
          />
        </div>
      </div>
    </div>
  );
}

export default RunReviewOverlay;
