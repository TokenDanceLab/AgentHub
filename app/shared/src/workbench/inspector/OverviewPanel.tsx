import React, { useState, useCallback } from 'react';
import { DesignFileIcon, DesignNavIcon } from '../designIcons';
import styles from './OverviewPanel.module.css';

/* ═══════════════════════════════════════════════════════════════════════
   OverviewPanel — Inspector overview with collapsible task & file sections.

   Mirrors the desktop demo .monitor-section / .monitor-task / .monitor-file
   visual design using ONLY v4 CSS custom properties.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Types ────────────────────────────────────────────────────────────────

export interface TaskItem {
  label: string;
  status: 'done' | 'active' | 'todo';
}

export interface FileItem {
  name: string;
  type?: string | undefined;
  /** Highlight this file as a primary / deliverable. */
  isPrimary?: boolean;
  /** Mark this file as currently open in the right inspector editor. */
  isOpen?: boolean;
}

export interface OverviewPanelProps {
  tasks: TaskItem[];
  files: FileItem[];

  /** Section title for the task list. Defaults to "Tasks". */
  taskSectionTitle?: string;

  /** Optional kicker text shown above files (e.g. "Builder 工作目录"). */
  kicker?: string;

  /** Label above the primary file group. Defaults to "交付文件". */
  primaryFileLabel?: string;

  /** Label above the working files group. Defaults to "工作文件". */
  workingFileLabel?: string;

  /** Fired when a file row is clicked. */
  onFileClick?: (file: FileItem) => void;
}

// ── Component ────────────────────────────────────────────────────────────

export const OverviewPanel: React.FC<OverviewPanelProps> = ({
  tasks,
  files,
  taskSectionTitle = '任务',
  kicker,
  primaryFileLabel = '交付文件',
  workingFileLabel = '工作文件',
  onFileClick,
}) => {
  const [tasksOpen, setTasksOpen] = useState(true);
  const [filesOpen, setFilesOpen] = useState(true);

  const toggleTasks = useCallback(() => setTasksOpen((v) => !v), []);
  const toggleFiles = useCallback(() => setFilesOpen((v) => !v), []);

  const primaryFiles = files.filter((f) => f.isPrimary);
  const workingFiles = files.filter((f) => !f.isPrimary);
  const taskToggleLabel = `${tasksOpen ? '折叠' : '展开'} ${taskSectionTitle}`;
  const filesToggleLabel = `${filesOpen ? '折叠' : '展开'} 产物`;

  return (
    <div className={styles.panel}>
      {/* ── Tasks section ── */}
      <section className={`${styles.section} ${tasksOpen ? '' : styles.sectionCollapsed}`}>
        <div className={styles.sectionHead}>
          <span>{taskSectionTitle}</span>
          <button
            type="button"
            className={styles.sectionToggle}
            onClick={toggleTasks}
            aria-expanded={tasksOpen}
            aria-label={taskToggleLabel}
            title={taskToggleLabel}
          >
            <span className={styles.chevron} aria-hidden="true">
              <DesignNavIcon name="chevron" size={14} />
            </span>
          </button>
        </div>

        <div className={styles.taskList}>
          {tasks.map((task, i) => (
            <div
              key={i}
              className={`${styles.task} ${
                task.status === 'done'
                  ? styles.taskDone
                  : task.status === 'active'
                    ? styles.taskActive
                    : ''
              }`}
            >
              {task.status === 'done' ? (
                <span className={styles.taskCheck}>
                  <DesignNavIcon name="checkCircle" size={16} />
                </span>
              ) : task.status === 'active' ? (
                <span className={styles.taskActiveDot}>
                  <span className={styles.taskActiveDotInner} />
                </span>
              ) : (
                <span className={styles.taskTodoDot} />
              )}
              <span>{task.label}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Files section ── */}
      <section className={`${styles.section} ${filesOpen ? '' : styles.sectionCollapsed}`}>
        <div className={styles.sectionHead}>
          <span>产物</span>
          <button
            type="button"
            className={styles.sectionToggle}
            onClick={toggleFiles}
            aria-expanded={filesOpen}
            aria-label={filesToggleLabel}
            title={filesToggleLabel}
          >
            <span className={styles.chevron} aria-hidden="true">
              <DesignNavIcon name="chevron" size={14} />
            </span>
          </button>
        </div>

        {kicker && <div className={styles.kicker}>{kicker}</div>}

        {primaryFiles.length > 0 && (
          <>
            <div className={styles.subhead}>{primaryFileLabel}</div>
            <div className={styles.fileList}>
              {primaryFiles.map((file, i) => (
                <button
                  key={`p-${i}`}
                  type="button"
                  className={[
                    styles.file,
                    styles.filePrimary,
                    file.isOpen ? styles.fileOpen : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onFileClick?.(file)}
                  aria-label={`打开 ${file.name} 只读预览`}
                >
                  <DesignFileIcon className={styles.fileIcon} name={file.name} type={file.type} />
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileAction}>
                    <DesignNavIcon name="preview" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}

        {workingFiles.length > 0 && (
          <>
            <div className={styles.subhead}>{workingFileLabel}</div>
            <div className={styles.fileList}>
              {workingFiles.map((file, i) => (
                <button
                  key={`w-${i}`}
                  type="button"
                  className={`${styles.file}${file.isOpen ? ` ${styles.fileOpen}` : ''}`}
                  onClick={() => onFileClick?.(file)}
                  aria-label={`打开 ${file.name} 只读预览`}
                >
                  <DesignFileIcon className={styles.fileIcon} name={file.name} type={file.type} />
                  <span className={styles.fileName}>{file.name}</span>
                  <span className={styles.fileAction}>
                    <DesignNavIcon name="preview" size={14} />
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
};
