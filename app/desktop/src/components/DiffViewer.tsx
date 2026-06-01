// GitHub-style diff viewer with file tree, collapsible hunks, and line numbers
// Enhanced with git integration: tab switcher for Agent changes vs Git changes,
// and commit preview panel for staged/unstaged diffs.
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Check,
  X,
  ChevronRight,
  FileCode,
  GitBranch,
  GitCommit,
  MessageSquareText,
} from 'lucide-react';
import type { FileDiff, DiffHunk } from './ChatView.types';
import styles from './DiffViewer.module.css';

interface Props {
  /** Agent-produced file changes (from tool calls) */
  files: FileDiff[];
  /** Git file changes (from git status) — merged view for the git tab */
  gitFiles?: FileDiff[];
  /** Git staged diffs (with hunks) for side-by-side commit preview */
  gitStagedFiles?: FileDiff[];
  /** Git unstaged diffs (with hunks) for side-by-side commit preview */
  gitUnstagedFiles?: FileDiff[];
  /** Git branch name for commit preview */
  gitBranch?: string | null;
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}

type DiffTab = 'agent' | 'git';

export default function DiffViewer({
  files,
  gitFiles,
  gitStagedFiles,
  gitUnstagedFiles,
  gitBranch,
  onAcceptFile,
  onRejectFile,
}: Props) {
  const { t } = useTranslation();
  const hasGitChanges = gitFiles && gitFiles.length > 0;
  const hasAgentChanges = files.length > 0;
  const showTabs = hasAgentChanges && hasGitChanges;

  const [activeTab, setActiveTab] = useState<DiffTab>(
    hasAgentChanges ? 'agent' : hasGitChanges ? 'git' : 'agent',
  );

  // Determine which files to display based on active tab
  const activeFiles = activeTab === 'agent' ? files : gitFiles ?? [];

  // Separate git changes into staged and unstaged for the commit preview
  const stagedFilesForPreview = useMemo(() => {
    if (gitStagedFiles && gitStagedFiles.length > 0) return gitStagedFiles;
    if (!gitFiles) return [] as FileDiff[];
    // Fallback: derive from git status when full diffs not provided
    return gitFiles.filter((f) => f.status !== 'untracked');
  }, [gitFiles, gitStagedFiles]);

  const unstagedFilesForPreview = useMemo(() => {
    if (gitUnstagedFiles && gitUnstagedFiles.length > 0) return gitUnstagedFiles;
    if (!gitFiles) return [] as FileDiff[];
    // Fallback: derive from git status when full diffs not provided
    return gitFiles.filter((f) => f.status === 'untracked' || f.status === 'modified');
  }, [gitFiles, gitUnstagedFiles]);

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(() =>
    new Set(activeFiles.map((f) => f.filePath)),
  );

  const [activeFile, setActiveFile] = useState<string | null>(
    activeFiles[0]?.filePath ?? null,
  );

  // Reset expanded/active when tab changes
  const switchTab = (tab: DiffTab) => {
    setActiveTab(tab);
    const nextFiles = tab === 'agent' ? files : gitFiles ?? [];
    setExpandedFiles(new Set(nextFiles.map((f) => f.filePath)));
    setActiveFile(nextFiles[0]?.filePath ?? null);
  };

  if (!hasAgentChanges && !hasGitChanges) {
    return <div className={styles.empty}>No changes to display</div>;
  }

  const toggleFile = (path: string) => {
    setExpandedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const expandAll = () =>
    setExpandedFiles(new Set(activeFiles.map((f) => f.filePath)));
  const collapseAll = () => setExpandedFiles(new Set());

  const totalAdditions = activeFiles.reduce((s, f) => s + f.additions, 0);
  const totalDeletions = activeFiles.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className={styles.root}>
      {/* Tab switcher */}
      {showTabs && (
        <div className={styles.tabBar}>
          <button
            className={`${styles.tab} ${activeTab === 'agent' ? styles.tabActive : ''}`}
            onClick={() => switchTab('agent')}
          >
            <MessageSquareText size={13} />
            <span>{t('diffViewer.agentChanges')}</span>
            <span className={styles.tabCount}>{files.length}</span>
          </button>
          <button
            className={`${styles.tab} ${activeTab === 'git' ? styles.tabActive : ''}`}
            onClick={() => switchTab('git')}
          >
            <GitBranch size={13} />
            <span>{t('diffViewer.gitChanges')}</span>
            <span className={styles.tabCount}>{gitFiles?.length ?? 0}</span>
          </button>
        </div>
      )}

      {/* Commit preview panel (only visible on git tab) */}
      {activeTab === 'git' && hasGitChanges && (
        <div className={styles.commitPreview}>
          <div className={styles.commitPreviewRow}>
            <GitCommit size={13} className={styles.commitPreviewIcon} />
            <span className={styles.commitPreviewLabel}>
              {t('diffViewer.commitPreview')}
            </span>
            {gitBranch && (
              <span className={styles.commitPreviewBranch}>
                {gitBranch}
              </span>
            )}
          </div>
          <div className={styles.commitPreviewStats}>
            <span className={styles.commitPreviewStat}>
              {t('diffViewer.stagedChanges')}:{' '}
              <strong>{stagedFilesForPreview.length}</strong>
            </span>
            <span className={styles.commitPreviewStat}>
              {t('diffViewer.unstagedChanges')}:{' '}
              <strong>{unstagedFilesForPreview.length}</strong>
            </span>
          </div>
          {/* Side-by-side staged / unstaged diff summary when diff hunks are available */}
          {(stagedFilesForPreview.some((f) => f.hunks.length > 0) ||
            unstagedFilesForPreview.some((f) => f.hunks.length > 0)) && (
            <div className={styles.commitPreviewSideBySide}>
              {stagedFilesForPreview.length > 0 && (
                <div className={styles.commitPreviewCol}>
                  <div className={styles.commitPreviewColHeader}>
                    <span className={styles.commitPreviewColLabel}>
                      {t('diffViewer.stagedChanges')}
                    </span>
                    <span className={styles.stagedBadge}>
                      {stagedFilesForPreview.reduce((s, f) => s + f.additions, 0)}+ /{' '}
                      {stagedFilesForPreview.reduce((s, f) => s + f.deletions, 0)}-
                    </span>
                  </div>
                  {stagedFilesForPreview.map((file) => (
                    <div key={file.filePath} className={styles.commitPreviewFile}>
                      <span className={statusBadgeClass(file.status)}>
                        {statusLabel(file.status)}
                      </span>
                      <code className={styles.commitPreviewFilePath}>
                        {file.filePath}
                      </code>
                      <span className={styles.commitPreviewFileStats}>
                        <span className={styles.addedCount}>+{file.additions}</span>
                        <span className={styles.deletedCount}>-{file.deletions}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {unstagedFilesForPreview.length > 0 && (
                <div className={styles.commitPreviewCol}>
                  <div className={styles.commitPreviewColHeader}>
                    <span className={styles.commitPreviewColLabel}>
                      {t('diffViewer.unstagedChanges')}
                    </span>
                    <span className={styles.unstagedBadge}>
                      {unstagedFilesForPreview.reduce((s, f) => s + f.additions, 0)}+ /{' '}
                      {unstagedFilesForPreview.reduce((s, f) => s + f.deletions, 0)}-
                    </span>
                  </div>
                  {unstagedFilesForPreview.map((file) => (
                    <div key={file.filePath} className={styles.commitPreviewFile}>
                      <span className={statusBadgeClass(file.status)}>
                        {statusLabel(file.status)}
                      </span>
                      <code className={styles.commitPreviewFilePath}>
                        {file.filePath}
                      </code>
                      <span className={styles.commitPreviewFileStats}>
                        <span className={styles.addedCount}>+{file.additions}</span>
                        <span className={styles.deletedCount}>-{file.deletions}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Git-only empty state */}
      {activeTab === 'git' && !hasGitChanges && (
        <div className={styles.empty}>{t('diffViewer.noGitChanges')}</div>
      )}

      {/* Agent-only empty state */}
      {activeTab === 'agent' && !hasAgentChanges && (
        <div className={styles.empty}>No changes to display</div>
      )}

      {/* Diff content */}
      {activeFiles.length > 0 && (
        <div className={styles.contentArea}>
          <div className={styles.fileTree}>
            <div className={styles.fileTreeHeader}>
              <span className={styles.fileTreeTitle}>
                {activeFiles.length} changed file
                {activeFiles.length !== 1 ? 's' : ''}
              </span>
              <span className={styles.fileTreeStats}>
                <span className={styles.addedCount}>+{totalAdditions}</span>
                <span className={styles.deletedCount}>-{totalDeletions}</span>
              </span>
              <div className={styles.fileTreeActions}>
                <button
                  className={styles.miniBtn}
                  onClick={expandAll}
                  title="Expand all"
                >
                  <ChevronRight size={14} style={{ transform: 'rotate(90deg)' }} />
                </button>
                <button
                  className={styles.miniBtn}
                  onClick={collapseAll}
                  title="Collapse all"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
            <div className={styles.fileTreeList}>
              {activeFiles.map((file) => (
                <button
                  key={file.filePath}
                  className={`${styles.fileTreeItem} ${activeFile === file.filePath ? styles.fileTreeItemActive : ''}`}
                  onClick={() => {
                    setActiveFile(file.filePath);
                    setExpandedFiles((prev) => {
                      const next = new Set(prev);
                      next.add(file.filePath);
                      return next;
                    });
                  }}
                >
                  <FileCode size={14} className={styles.fileTreeIcon} />
                  <span className={styles.fileTreePath}>
                    {file.filePath}
                  </span>
                  <span className={statusBadgeClass(file.status)}>
                    {statusLabel(file.status)}
                  </span>
                  <span className={styles.addedCount}>+{file.additions}</span>
                  <span className={styles.deletedCount}>
                    -{file.deletions}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className={styles.diffPanel}>
            {activeFiles.map((file) => (
              <FileDiffSection
                key={file.filePath}
                file={file}
                expanded={expandedFiles.has(file.filePath)}
                onToggle={() => toggleFile(file.filePath)}
                onAcceptFile={
                  activeTab === 'agent' ? onAcceptFile : undefined
                }
                onRejectFile={
                  activeTab === 'agent' ? onRejectFile : undefined
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function statusLabel(status: string): string {
  if (status === 'added') return 'A';
  if (status === 'deleted') return 'D';
  if (status === 'untracked') return '?';
  return 'M';
}

function statusBadgeClass(status: string): string {
  if (status === 'added')
    return `${styles.statusBadge} ${styles.statusAdded}`;
  if (status === 'deleted')
    return `${styles.statusBadge} ${styles.statusDeleted}`;
  if (status === 'untracked')
    return `${styles.statusBadge} ${styles.statusUntracked}`;
  return `${styles.statusBadge} ${styles.statusModified}`;
}

function FileDiffSection({
  file,
  expanded,
  onToggle,
  onAcceptFile,
  onRejectFile,
}: {
  file: FileDiff;
  expanded: boolean;
  onToggle: () => void;
  onAcceptFile?: (path: string) => void;
  onRejectFile?: (path: string) => void;
}) {
  const [accepted, setAccepted] = useState(false);
  const [rejected, setRejected] = useState(false);

  const handleAccept = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (accepted) {
      setAccepted(false);
      return;
    }
    setAccepted(true);
    setRejected(false);
    onAcceptFile?.(file.filePath);
  };

  const handleReject = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (rejected) {
      setRejected(false);
      return;
    }
    setRejected(true);
    setAccepted(false);
    onRejectFile?.(file.filePath);
  };

  const sectionClass = [
    styles.fileSection,
    accepted && styles.fileAccepted,
    rejected && styles.fileRejected,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={sectionClass}>
      <div className={styles.fileHeader}>
        <button
          className={styles.fileHeaderBtn}
          onClick={onToggle}
          aria-expanded={expanded}
        >
          <ChevronRight
            size={14}
            className={`${styles.chevron} ${expanded ? styles.chevronDown : ''}`}
          />
          <span className={statusBadgeClass(file.status)}>
            {statusLabel(file.status)}
          </span>
          <code className={styles.filePath}>{file.filePath}</code>
          <span className={styles.fileChangeStats}>
            <span className={styles.addedCount}>+{file.additions}</span>
            <span className={styles.deletedCount}>-{file.deletions}</span>
          </span>
        </button>

        {onAcceptFile && (
          <button
            className={`${styles.actionBtn} ${styles.acceptBtn} ${accepted ? styles.acceptBtnActive : ''}`}
            onClick={handleAccept}
            title={accepted ? 'Undo accept' : 'Accept all changes in this file'}
            aria-label={accepted ? 'Undo accept' : 'Accept file'}
          >
            <Check size={14} />
          </button>
        )}
        {onRejectFile && (
          <button
            className={`${styles.actionBtn} ${styles.rejectBtn} ${rejected ? styles.rejectBtnActive : ''}`}
            onClick={handleReject}
            title={
              rejected ? 'Undo reject' : 'Reject all changes in this file'
            }
            aria-label={rejected ? 'Undo reject' : 'Reject file'}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {expanded && (
        <div className={styles.fileBody}>
          {file.hunks.map((hunk, i) => (
            <HunkRenderer key={i} hunk={hunk} />
          ))}
        </div>
      )}
    </div>
  );
}

function HunkRenderer({ hunk }: { hunk: DiffHunk }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className={styles.hunk}>
      <button
        className={styles.hunkHeader}
        onClick={() => setCollapsed((v) => !v)}
      >
        <ChevronRight
          size={12}
          className={`${styles.hunkChevron} ${collapsed ? '' : styles.hunkChevronDown}`}
        />
        <code className={styles.hunkHeaderText}>{hunk.header}</code>
      </button>
      {!collapsed && (
        <div className={styles.hunkBody}>
          {hunk.lines.map((line, j) => (
            <div
              key={j}
              className={
                line.type === 'added'
                  ? styles.lineAdded
                  : line.type === 'deleted'
                    ? styles.lineDeleted
                    : styles.lineContext
              }
            >
              <span className={styles.lineNumOld}>
                {line.oldLineNumber != null ? line.oldLineNumber : ''}
              </span>
              <span className={styles.lineNumNew}>
                {line.newLineNumber != null ? line.newLineNumber : ''}
              </span>
              <span className={styles.lineSign}>
                {line.type === 'added'
                  ? '+'
                  : line.type === 'deleted'
                    ? '-'
                    : ''}
              </span>
              <span className={styles.lineContent}>{line.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
