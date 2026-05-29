import { useState, useMemo, useRef, useEffect, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, MessageSquare, Pencil, Trash2, Check, X, Archive, ArchiveRestore } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { RunInfo, ThreadInfo } from '@shared/types';
import { useThreads, useRenameThread, useDeleteThread, useCreateThread, useArchiveThread, useRestoreThread } from '@/api/threadQueries';
import { useToastStore } from '@/stores/toastStore';
import styles from './ThreadPanel.module.css';

interface Props {
  online: boolean;
  selectedId?: string;
  onSelect: (thread: ThreadInfo) => void;
  onCreate?: () => Promise<void> | void;
  onThreadTitleEdited?: (threadId: string) => void;
  runs?: RunInfo[];
}

type ThreadFilter = 'active' | 'archived';
type ThreadRunStatusKind = 'running' | 'waitingApproval' | 'failed';

interface ThreadRunStatus {
  kind: ThreadRunStatusKind;
  labelKey: string;
  run: RunInfo;
}

const RUNNING_STATUSES = new Set(['queued', 'starting', 'started', 'running', 'cancelling']);
const WAITING_APPROVAL_STATUSES = new Set([
  'waiting_approval',
  'waiting-approval',
  'awaiting_approval',
  'pending_approval',
  'approval_required',
]);
const FAILED_STATUSES = new Set(['failed', 'error']);
const METHOD_NOT_ALLOWED_RE = /method\s+not\s+allowed|405/i;

/** Human-readable fallback when a thread has no title. */
function getDisplayTitle(th: ThreadInfo, t: (k: string) => string): string {
  if (th.title?.trim()) return th.title;
  return t('thread.untitled');
}

function threadActionErrorMessage(
  error: unknown,
  t: (k: string) => string,
  unsupportedKey = 'toast.error',
): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (METHOD_NOT_ALLOWED_RE.test(msg)) return t(unsupportedKey);
  return msg || t('toast.error');
}

export default memo(function ThreadPanel({ online, selectedId, onSelect, onCreate, onThreadTitleEdited, runs = [] }: Props) {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const queryClient = useQueryClient();

  // TanStack Query — server state
  const { data } = useThreads();
  const threads = data?.items ?? [];
  const renameMutation = useRenameThread();
  const deleteMutation = useDeleteThread();
  const createMutation = useCreateThread();
  const archiveMutation = useArchiveThread();
  const restoreMutation = useRestoreThread();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ThreadFilter>('active');
  const [externalCreatePending, setExternalCreatePending] = useState(false);

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const counts = useMemo(() => ({
    active: threads.filter((thread) => thread.status !== 'archived').length,
    archived: threads.filter((thread) => thread.status === 'archived').length,
  }), [threads]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return threads.filter((th) => {
      const archived = th.status === 'archived';
      if (filter === 'active' && archived) return false;
      if (filter === 'archived' && !archived) return false;
      if (!q) return true;
      return th.title.toLowerCase().includes(q);
    });
  }, [filter, threads, query]);

  const grouped = useMemo(() => groupThreads(filtered, filter, t), [filter, filtered, t]);
  const runStatusByThread = useMemo(() => deriveThreadRunStatuses(runs), [runs]);

  // Focus / select edit input whenever editingId changes
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // ── rename handlers ────────────────────────

  const handleStartEdit = (e: React.MouseEvent, th: ThreadInfo) => {
    e.stopPropagation();
    setEditingId(th.threadId);
    setEditTitle(th.title || '');
    setActionError(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    const title = editTitle.trim();
    try {
      await renameMutation.mutateAsync({ threadId: editingId, title });
      onThreadTitleEdited?.(editingId);
      setEditingId(null);
      setActionError(null);
      addToast({ type: 'success', message: t('toast.threadRenamed') });
    } catch (err: unknown) {
      const msg = threadActionErrorMessage(err, t);
      setActionError(msg);
      addToast({ type: 'error', message: msg });
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setActionError(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSaveEdit();
    else if (e.key === 'Escape') handleCancelEdit();
  };

  // ── delete handlers ────────────────────────

  const handleStartDelete = (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    setDeletingId(threadId);
    setActionError(null);
  };

  const handleConfirmDelete = async (threadId: string) => {
    try {
      const result = await deleteMutation.mutateAsync(threadId);
      setDeletingId(null);
      setQuery('');
      setActionError(null);
      addToast({ type: 'success', message: result === 'archived' ? t('toast.threadArchived') : t('toast.threadDeleted') });
    } catch (err: unknown) {
      const msg = threadActionErrorMessage(err, t, 'thread.deleteUnsupported');
      setActionError(msg);
      addToast({ type: 'error', message: msg });
      console.error('Failed to delete thread:', err);
    }
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
    setActionError(null);
  };

  const handleArchive = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      await archiveMutation.mutateAsync(threadId);
      setActionError(null);
      addToast({ type: 'success', message: t('toast.threadArchived') });
    } catch (err: unknown) {
      const msg = threadActionErrorMessage(err, t);
      setActionError(msg);
      addToast({ type: 'error', message: msg });
    }
  };

  const handleRestore = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      await restoreMutation.mutateAsync(threadId);
      setActionError(null);
      addToast({ type: 'success', message: t('toast.threadRestored') });
    } catch (err: unknown) {
      const msg = threadActionErrorMessage(err, t);
      setActionError(msg);
      addToast({ type: 'error', message: msg });
    }
  };

  // ── create handler ─────────────────────────

  const handleCreate = async () => {
    if (onCreate) {
      try {
        setExternalCreatePending(true);
        await onCreate();
        setQuery('');
        setActionError(null);
      } catch (err: unknown) {
        const msg = threadActionErrorMessage(err, t);
        setActionError(msg);
        addToast({ type: 'error', message: msg });
      } finally {
        setExternalCreatePending(false);
      }
      return;
    }

    try {
      const thread = await createMutation.mutateAsync({ title: '' });
      onSelect(thread);
      setQuery('');
      setActionError(null);
      addToast({ type: 'success', message: t('toast.threadCreated') });
    } catch (err: unknown) {
      const msg = threadActionErrorMessage(err, t);
      setActionError(msg);
      addToast({ type: 'error', message: msg });
    } finally {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    }
  };

  // ── render ─────────────────────────────────

  return (
    <nav className={styles.sidebar} aria-label={t('thread.title')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('thread.title')}</span>
        <button
          className={styles.createBtn}
          onClick={handleCreate}
          disabled={!online || createMutation.isPending || externalCreatePending}
          title={t('thread.create')}
          aria-label={t('thread.create')}
        >
          <Plus size={16} />
        </button>
      </div>

      <input
        className={styles.search}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('thread.search')}
      />

      <div className={styles.filterBar} role="tablist" aria-label={t('thread.filterLabel')}>
        <button
          type="button"
          className={`${styles.filterBtn} ${filter === 'active' ? styles.filterBtnActive : ''}`}
          onClick={() => setFilter('active')}
          role="tab"
          aria-selected={filter === 'active'}
        >
          <span>{t('thread.active')}</span>
          <b>{counts.active}</b>
        </button>
        <button
          type="button"
          className={`${styles.filterBtn} ${filter === 'archived' ? styles.filterBtnActive : ''}`}
          onClick={() => setFilter('archived')}
          role="tab"
          aria-selected={filter === 'archived'}
        >
          <span>{t('thread.archived')}</span>
          <b>{counts.archived}</b>
        </button>
      </div>

      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {filtered.length === 0 ? (
        threads.length === 0 && filter === 'active' ? (
          <button className={styles.emptyCreate} type="button" onClick={handleCreate} disabled={!online || createMutation.isPending || externalCreatePending}>
            <MessageSquare size={14} />
            <span>{t('thread.emptyAction')}</span>
          </button>
        ) : (
          <div className={styles.empty}>{filter === 'archived' ? t('thread.emptyArchived') : t('thread.empty')}</div>
        )
      ) : (
        <ul className={styles.list}>
          {grouped.map((section) => (
            <li key={section.label} className={styles.group}>
              <div className={styles.groupLabel}>{section.label}</div>
              <ul className={styles.groupList}>
                {section.items.map((th) => {
            const displayTitle = getDisplayTitle(th, t);
            if (th.threadId === editingId) {
              // ── inline editing row ──────────
              return (
                <li key={th.threadId} className={styles.editRow}>
                  <MessageSquare size={14} className={styles.editIcon} />
                  <input
                    ref={editInputRef}
                    className={styles.editInput}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={handleEditKeyDown}
                    onBlur={handleSaveEdit}
                  />
                  <button
                    className={styles.actionBtn}
                    onClick={handleSaveEdit}
                    title={t('thread.save')}
                    aria-label={t('thread.save')}
                  >
                    <Check size={14} />
                  </button>
                  <button
                    className={styles.actionBtn}
                    onClick={handleCancelEdit}
                    title={t('thread.cancel')}
                    aria-label={t('thread.cancel')}
                  >
                    <X size={14} />
                  </button>
                </li>
              );
            }

            if (th.threadId === deletingId) {
              // ── delete confirmation row ─────
              return (
                <li key={th.threadId} className={styles.confirmRow}>
                  <MessageSquare size={14} className={styles.confirmIcon} />
                  <span className={styles.confirmText} title={`${t('thread.confirmDelete')} ${displayTitle}`}>
                    {t('thread.confirmDeleteShort')}
                  </span>
                  <button
                    className={`${styles.confirmActionBtn} ${styles.confirmCancelBtn}`}
                    onClick={handleCancelDelete}
                    title={t('thread.cancel')}
                    aria-label={t('thread.cancel')}
                  >
                    {t('thread.cancel')}
                  </button>
                  <button
                    className={`${styles.confirmActionBtn} ${styles.deleteConfirm}`}
                    onClick={() => handleConfirmDelete(th.threadId)}
                    aria-label={t('thread.confirmDeleteAction')}
                  >
                    {t('thread.confirmDeleteAction')}
                  </button>
                </li>
              );
            }

            // ── normal row ────────────────────
            const runStatus = runStatusByThread.get(th.threadId);
            const hasActivity = Boolean(runStatus) && th.threadId !== selectedId;
            const selected = th.threadId === selectedId;
            const archived = th.status === 'archived';
            const runStatusClass = runStatus ? getRunStatusClass(runStatus.kind, styles) : '';

            return (
              <li key={th.threadId} className={`${styles.itemRow} ${selected ? styles.itemRowSelected : ''}`}>
                <button
                  className={`${styles.item} ${selected ? styles.selected : ''}`}
                  onClick={() => onSelect(th)}
                >
                  {hasActivity && <span className={`${styles.unreadDot} ${runStatusClass}`} />}
                  <MessageSquare size={14} />
                  <div className={styles.itemInfo}>
                    <div className={styles.name} title={displayTitle}>{displayTitle}</div>
                    {archived ? <span className={styles.statusPill}>{t('thread.archived')}</span> : null}
                    {!archived && runStatus ? (
                      <span className={`${styles.statusPill} ${runStatusClass}`} title={`${runStatus.run.runId} · ${runStatus.run.status}`}>
                        {t(runStatus.labelKey)}
                      </span>
                    ) : null}
                  </div>
                </button>
                <div className={styles.actions}>
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => handleStartEdit(e, th)}
                    title={t('thread.rename')}
                    aria-label={t('thread.rename')}
                    disabled={!online}
                  >
                    <Pencil size={12} />
                  </button>
                  {archived ? (
                    <button
                      className={styles.actionBtn}
                      onClick={(e) => handleRestore(e, th.threadId)}
                      title={t('thread.restore')}
                      aria-label={t('thread.restore')}
                      disabled={!online || restoreMutation.isPending}
                    >
                      <ArchiveRestore size={12} />
                    </button>
                  ) : (
                    <button
                      className={styles.actionBtn}
                      onClick={(e) => handleArchive(e, th.threadId)}
                      title={t('thread.archive')}
                      aria-label={t('thread.archive')}
                      disabled={!online || archiveMutation.isPending}
                    >
                      <Archive size={12} />
                    </button>
                  )}
                  <button
                    className={styles.actionBtn}
                    onClick={(e) => handleStartDelete(e, th.threadId)}
                    title={t('thread.delete')}
                    aria-label={t('thread.delete')}
                    disabled={!online}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
});

function groupThreads(
  threads: ThreadInfo[],
  filter: ThreadFilter,
  t: (key: string) => string,
): Array<{ label: string; items: ThreadInfo[] }> {
  const projectScoped = new Set(threads.map((thread) => thread.projectId).filter(Boolean)).size > 1;
  if (filter === 'archived') {
    if (!projectScoped) return [{ label: t('thread.groupArchived'), items: threads }];
    const byProject = new Map<string, ThreadInfo[]>();
    for (const thread of threads) {
      const label = `${thread.projectId || 'local'} · ${t('thread.groupArchived')}`;
      byProject.set(label, [...(byProject.get(label) ?? []), thread]);
    }
    return Array.from(byProject, ([label, items]) => ({ label, items }));
  }

  const today = new Date();
  const todayKey = dayKey(today);
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);

  const sections = new Map<string, ThreadInfo[]>();
  for (const thread of threads) {
    const key = dayKey(new Date(thread.updatedAt || thread.createdAt));
    const dateLabel = key === todayKey
      ? t('thread.groupToday')
      : key === yesterdayKey
        ? t('thread.groupYesterday')
        : t('thread.groupEarlier');
    const label = projectScoped ? `${thread.projectId || 'local'} · ${dateLabel}` : dateLabel;
    sections.set(label, [...(sections.get(label) ?? []), thread]);
  }

  if (projectScoped) {
    return Array.from(sections, ([label, items]) => ({ label, items }));
  }

  return [t('thread.groupToday'), t('thread.groupYesterday'), t('thread.groupEarlier')]
    .map((label) => ({ label, items: sections.get(label) ?? [] }))
    .filter((section) => section.items.length > 0);
}

function dayKey(value: Date): string {
  if (Number.isNaN(value.getTime())) return 'invalid';
  return value.toISOString().slice(0, 10);
}

function deriveThreadRunStatuses(runs: RunInfo[]): Map<string, ThreadRunStatus> {
  const byThread = new Map<string, RunInfo[]>();
  for (const run of runs) {
    if (!run.threadId) continue;
    byThread.set(run.threadId, [...(byThread.get(run.threadId) ?? []), run]);
  }

  const statuses = new Map<string, ThreadRunStatus>();
  for (const [threadId, threadRuns] of byThread) {
    const sorted = [...threadRuns].sort((a, b) => runTime(b).localeCompare(runTime(a)));
    const waiting = sorted.find((run) => WAITING_APPROVAL_STATUSES.has(normalizeRunStatus(run.status)));
    if (waiting) {
      statuses.set(threadId, { kind: 'waitingApproval', labelKey: 'thread.status.waitingApproval', run: waiting });
      continue;
    }

    const running = sorted.find((run) => RUNNING_STATUSES.has(normalizeRunStatus(run.status)));
    if (running) {
      statuses.set(threadId, { kind: 'running', labelKey: 'thread.status.running', run: running });
      continue;
    }

    const latest = sorted[0];
    if (latest && FAILED_STATUSES.has(normalizeRunStatus(latest.status))) {
      statuses.set(threadId, { kind: 'failed', labelKey: 'thread.status.failed', run: latest });
    }
  }
  return statuses;
}

function normalizeRunStatus(status: string | undefined): string {
  return (status ?? '').trim().toLowerCase();
}

function runTime(run: RunInfo): string {
  return run.finishedAt || run.startedAt || run.createdAt || '';
}

function getRunStatusClass(kind: ThreadRunStatusKind, css: typeof styles): string {
  if (kind === 'failed') return css.statusPillFailed ?? '';
  if (kind === 'waitingApproval') return css.statusPillApproval ?? '';
  return css.statusPillRunning ?? '';
}
