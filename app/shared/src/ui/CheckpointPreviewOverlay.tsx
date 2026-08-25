// CheckpointPreviewOverlay — read-only pre-run workspace snapshot preview (#1968).
// Opens from a checkpoint timeline card click. The overlay owns the fetch
// lifecycle against the surface's `CheckpointPort`: inventory on open, then
// per-file pre-run content on selection. Honesty contract: restore is never
// offered (the always-visible notice explains why), surfaces without a port
// get the explicit surfaceUnavailable notice, and a vanished checkpoint
// renders the absent notice instead of a broken frame.
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { useFocusTrap } from './focusTrap';
import { SkeletonBar } from './SkeletonBar';
import type {
  CheckpointFileContent,
  CheckpointPort,
  CheckpointSummary,
} from '../platform/types';
import styles from './CheckpointPreviewOverlay.module.css';

export interface CheckpointPreviewLabels {
  /** Header summary template with {{count}} and {{bytes}} placeholders. */
  summary: string;
  /** Aria label for the file list. */
  fileListAria: string;
  /** Content-pane placeholder before a file is selected. */
  selectFile: string;
  /** Shown when the selected file has no text preview (binary/size cap). */
  emptyContent: string;
  /** Shown when the run's checkpoint no longer exists in the store. */
  absent: string;
  /** Always-visible honesty notice: restore is not wired on any surface. */
  restoreUnavailable: string;
  /** Shown when the current surface exposes no checkpoint port. */
  surfaceUnavailable: string;
  /** Shown when fetching the inventory or a file fails. */
  loadFailed: string;
}

export interface CheckpointPreviewOverlayProps {
  open: boolean;
  /** Edge run ID whose pre-run checkpoint is previewed. */
  runId: string;
  /**
   * Read-only checkpoint port. Absent on Hub-only surfaces (Web) — the
   * overlay then renders the honest surfaceUnavailable notice.
   */
  port?: CheckpointPort | undefined;
  /** Dialog title (accessible name). */
  title: string;
  /** Accessible label for the close button. */
  closeLabel: string;
  labels: CheckpointPreviewLabels;
  onClose: () => void;
  className?: string | undefined;
}

type InventoryPhase = 'loading' | 'ready' | 'absent' | 'failed';
type FilePhase = 'idle' | 'loading' | 'ready' | 'empty' | 'failed';

/** Human-readable byte size for the summary line (SI units, one decimal). */
export function formatCheckpointBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < units.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }
  const text = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unitIndex]}`;
}

export function CheckpointPreviewOverlay({
  open,
  runId,
  port,
  title,
  closeLabel,
  labels,
  onClose,
  className,
}: CheckpointPreviewOverlayProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(overlayRef, open);

  const [inventoryPhase, setInventoryPhase] = useState<InventoryPhase>('loading');
  const [summary, setSummary] = useState<CheckpointSummary | undefined>(undefined);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const [filePhase, setFilePhase] = useState<FilePhase>('idle');
  const [fileContent, setFileContent] = useState<CheckpointFileContent | undefined>(undefined);
  /** Monotonic guard so a slow fetch for a previous run cannot overwrite a newer one. */
  const requestSeqRef = useRef(0);

  // Reset + fetch the inventory whenever the overlay opens for a run.
  useEffect(() => {
    if (!open) return;
    const seq = ++requestSeqRef.current;
    setSelectedPath(undefined);
    setFilePhase('idle');
    setFileContent(undefined);
    setSummary(undefined);
    if (!port) return; // surfaceUnavailable renders from props; no fetch.
    setInventoryPhase('loading');
    let cancelled = false;
    void port.list(runId).then(
      (result) => {
        if (cancelled || seq !== requestSeqRef.current) return;
        if (result) {
          setSummary(result);
          setInventoryPhase('ready');
        } else {
          setInventoryPhase('absent');
        }
      },
      () => {
        if (cancelled || seq !== requestSeqRef.current) return;
        setInventoryPhase('failed');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, runId, port]);

  const handleSelectFile = useCallback((path: string, hasText: boolean): void => {
    if (!port) return;
    setSelectedPath(path);
    setFileContent(undefined);
    if (!hasText) {
      // Edge recorded no text preview (binary or over the size cap) — do not
      // pretend there is content to fetch.
      setFilePhase('empty');
      return;
    }
    const seq = ++requestSeqRef.current;
    setFilePhase('loading');
    void port.file(runId, path).then(
      (result) => {
        if (seq !== requestSeqRef.current) return;
        if (result) {
          setFileContent(result);
          setFilePhase('ready');
        } else {
          setFilePhase('empty');
        }
      },
      () => {
        if (seq !== requestSeqRef.current) return;
        setFilePhase('failed');
      },
    );
  }, [port, runId]);

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

  const summaryLine = summary
    ? labels.summary
      .replace('{{count}}', String(summary.fileCount))
      .replace('{{bytes}}', formatCheckpointBytes(summary.totalBytes))
    : undefined;

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
      data-testid="checkpoint-preview-overlay"
    >
      <div className={styles.content}>
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          {summaryLine ? <span className={styles.summary}>{summaryLine}</span> : null}
          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={closeLabel}
          >
            <X size={14} />
          </button>
        </div>
        {/* Honesty contract (#1968): restore is never offered on any surface. */}
        <div className={styles.restoreNotice} role="note" data-testid="checkpoint-restore-notice">
          {labels.restoreUnavailable}
        </div>
        <div className={styles.body}>
          {!port ? (
            <div className={styles.notice} role="status" data-testid="checkpoint-surface-unavailable">
              {labels.surfaceUnavailable}
            </div>
          ) : inventoryPhase === 'loading' ? (
            <div className={styles.notice} role="status" data-testid="checkpoint-loading">
              <SkeletonBar />
              <SkeletonBar />
            </div>
          ) : inventoryPhase === 'absent' ? (
            <div className={styles.notice} role="status" data-testid="checkpoint-absent">
              {labels.absent}
            </div>
          ) : inventoryPhase === 'failed' ? (
            <div className={styles.notice} role="status" data-testid="checkpoint-load-failed">
              {labels.loadFailed}
            </div>
          ) : summary ? (
            <>
              <ul className={styles.fileList} aria-label={labels.fileListAria}>
                {summary.files.map((file) => (
                  <li key={file.path}>
                    <button
                      type="button"
                      className={cx(styles.fileItem, file.path === selectedPath ? styles.fileItemActive : undefined)}
                      aria-pressed={file.path === selectedPath}
                      onClick={() => handleSelectFile(file.path, file.hasText)}
                      title={file.path}
                    >
                      <span className={styles.filePath}>{file.path}</span>
                      <span className={styles.fileSize}>{formatCheckpointBytes(file.sizeBytes)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className={styles.filePane}>
                {filePhase === 'idle' ? (
                  <div className={styles.notice} data-testid="checkpoint-select-file">{labels.selectFile}</div>
                ) : filePhase === 'loading' ? (
                  <div className={styles.notice} role="status" data-testid="checkpoint-file-loading">
                    <SkeletonBar />
                    <SkeletonBar />
                  </div>
                ) : filePhase === 'empty' ? (
                  <div className={styles.notice} role="status" data-testid="checkpoint-empty-content">
                    {labels.emptyContent}
                  </div>
                ) : filePhase === 'failed' ? (
                  <div className={styles.notice} role="status" data-testid="checkpoint-file-failed">
                    {labels.loadFailed}
                  </div>
                ) : (
                  <pre className={styles.fileContent} data-testid="checkpoint-file-content">
                    {fileContent?.content ?? ''}
                  </pre>
                )}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
