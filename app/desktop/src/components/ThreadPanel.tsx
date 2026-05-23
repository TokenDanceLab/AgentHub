import { useState, useMemo, useRef, useEffect, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { ThreadInfo } from '@shared/types';
import { ConversationList } from '@shared/components';
import type { ConversationData } from '@shared/components';
import { useThreads, useRenameThread, useDeleteThread } from '@/api/threadQueries';
import { useToast } from '@/contexts/ToastContext';
import styles from './ThreadPanel.module.css';

/** ThreadInfo with optional count metadata the Edge may return. */
interface ThreadInfoExt extends ThreadInfo {
  runCount?: number;
  itemCount?: number;
}

interface Props {
  online: boolean;
  selectedId?: string;
  onSelect: (thread: ThreadInfo) => void;
}

/** Human-readable fallback when a thread has no title. */
function getDisplayTitle(th: ThreadInfo, t: (k: string) => string): string {
  if (th.title?.trim()) return th.title;
  return t('thread.untitled');
}

/** Relative time display (e.g. "3m ago", "2h ago"). Uses i18n for locale. */
function relativeTime(
  dateStr: string,
  t: (k: string, v?: Record<string, unknown>) => string,
): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return t('time.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('time.minutesAgo', { count: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('time.hoursAgo', { count: hours });
  const days = Math.floor(hours / 24);
  if (days < 30) return t('time.daysAgo', { count: days });
  return new Date(dateStr).toLocaleDateString();
}

export default memo(function ThreadPanel({ online, selectedId, onSelect }: Props) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // TanStack Query — server state
  const { data } = useThreads();
  const threads = data?.items ?? [];
  const renameMutation = useRenameThread();
  const deleteMutation = useDeleteThread();

  const [query, setQuery] = useState('');

  // Inline rename state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return threads;
    const q = query.toLowerCase();
    return threads.filter((th) => th.title.toLowerCase().includes(q));
  }, [threads, query]);

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
      setEditingId(null);
      setActionError(null);
      showToast('success', t('toast.threadRenamed'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      showToast('error', msg);
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
      await deleteMutation.mutateAsync(threadId);
      setDeletingId(null);
      setActionError(null);
      showToast('success', t('toast.threadDeleted'));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setActionError(msg);
      showToast('error', msg);
    }
  };

  const handleCancelDelete = () => {
    setDeletingId(null);
    setActionError(null);
  };

  // ── create handler ─────────────────────────

  const handleCreate = () => {
    // Invalidate queries so Edge-synced threads refresh
    queryClient.invalidateQueries({ queryKey: ['threads'] });
  };

  // ── helpers ────────────────────────────────

  const formatCount = (th: ThreadInfoExt): string | null => {
    const runs = th.runCount;
    const msgs = th.itemCount;
    const count = msgs ?? runs;
    if (count != null && count > 0) return t('thread.messages', { count });
    return null;
  };

  // Map threads to ConversationData for the shared component
  const conversationData: ConversationData[] = useMemo(
    () =>
      filtered.map((th) => {
        const ext = th as ThreadInfoExt;
        const count = formatCount(ext);
        const lastMsg = [relativeTime(th.updatedAt, t), count].filter(Boolean).join(' · ');
        const hasUnread =
          ext.runCount != null && ext.runCount > 0 && th.threadId !== selectedId;
        return {
          id: th.threadId,
          name: getDisplayTitle(th, t),
          lastMessage: lastMsg || t('thread.untitled'),
          unread: hasUnread ? 1 : 0,
        };
      }),
    [filtered, t, selectedId],
  );

  const handleSelectId = useCallback(
    (id: string) => {
      const thread = threads.find((th) => th.threadId === id);
      if (thread) onSelect(thread);
    },
    [threads, onSelect],
  );

  const selectedThread = threads.find((th) => th.threadId === selectedId);

  // ── render ─────────────────────────────────

  return (
    <nav className={styles.sidebar} aria-label={t('thread.title')}>
      <div className={styles.header}>
        <span className={styles.title}>{t('thread.title')}</span>
        <button
          className={styles.createBtn}
          onClick={handleCreate}
          disabled={!online}
          title={t('thread.create')}
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

      {actionError && <div className={styles.actionError}>{actionError}</div>}

      {/* Inline edit row — rendered outside ConversationList */}
      {editingId && (
        <div className={styles.editRow}>
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
        </div>
      )}

      {/* Delete confirmation row — rendered outside ConversationList */}
      {deletingId && (
        <div className={styles.confirmRow}>
          <span className={styles.confirmText}>{t('thread.confirmDelete')}</span>
          <button
            className={`${styles.actionBtn} ${styles.deleteConfirm}`}
            onClick={() => handleConfirmDelete(deletingId)}
          >
            <Trash2 size={14} />
            {t('thread.delete')}
          </button>
          <button
            className={styles.actionBtn}
            onClick={handleCancelDelete}
            title={t('thread.cancel')}
            aria-label={t('thread.cancel')}
          >
            <X size={14} />
            {t('thread.cancel')}
          </button>
        </div>
      )}

      <ConversationList
        conversations={conversationData}
        activeId={selectedId}
        onSelect={handleSelectId}
        className={styles.conversationList}
      />

      {/* Per-item actions for selected thread */}
      {selectedThread && !editingId && !deletingId && (
        <div className={styles.actions}>
          <button
            className={styles.actionBtn}
            onClick={(e) => handleStartEdit(e, selectedThread)}
            title={t('thread.rename')}
            aria-label={t('thread.rename')}
            disabled={!online}
          >
            <Pencil size={12} />
          </button>
          <button
            className={styles.actionBtn}
            onClick={(e) => handleStartDelete(e, selectedThread.threadId)}
            title={t('thread.delete')}
            aria-label={t('thread.delete')}
            disabled={!online}
          >
            <Trash2 size={12} />
          </button>
        </div>
      )}
    </nav>
  );
});
