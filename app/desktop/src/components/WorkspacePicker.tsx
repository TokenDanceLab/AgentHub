import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock3, FolderGit2, FolderOpen, Plus, Trash2, X } from 'lucide-react';
import type { WorkspaceEntry } from '@/utils/workspaceStore';
import { formatTimeAgo } from '@/utils/workspaceStore';
import styles from './WorkspacePicker.module.css';

interface Props {
  workspaces: WorkspaceEntry[];
  selectedPath?: string;
  onSelect: (workspace: WorkspaceEntry) => void;
  onBrowse: () => void;
  onRemove: (path: string) => void;
  onClearAll: () => void;
  disabled?: boolean;
}

export default function WorkspacePicker({
  workspaces,
  selectedPath,
  onSelect,
  onBrowse,
  onRemove,
  onClearAll,
  disabled = false,
}: Props) {
  const { t } = useTranslation();
  const browseRef = useRef<HTMLButtonElement>(null);

  const visible = useMemo(
    () => workspaces.filter((ws) => ws.path !== selectedPath).slice(0, 6),
    [workspaces, selectedPath],
  );

  const handleRemove = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      e.preventDefault();
      onRemove(path);
    },
    [onRemove],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, action: () => void) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        action();
      }
    },
    [],
  );

  return (
    <div className={styles.root} role="region" aria-label={t('workspace.recent')}>
      <div className={styles.header}>
        <h3 className={styles.title}>{t('workspace.recent')}</h3>
        {workspaces.length > 0 && (
          <button type="button" className={styles.clearBtn} onClick={onClearAll} disabled={disabled}>
            <Trash2 size={13} />
            <span>{t('workspace.clearAll')}</span>
          </button>
        )}
      </div>

      {workspaces.length > 0 ? (
        <div className={styles.grid}>
          {workspaces.slice(0, 8).map((ws) => {
            const isSelected = selectedPath != null && selectedPath.toLowerCase() === ws.path.toLowerCase();
            return (
              <button
                key={ws.path}
                type="button"
                className={`${styles.card} ${isSelected ? styles.cardSelected : ''}`}
                onClick={() => onSelect(ws)}
                onKeyDown={(e) => handleKeyDown(e, () => onSelect(ws))}
                disabled={disabled}
                title={ws.path}
                aria-label={t('workspace.openProject', { name: ws.name })}
                aria-pressed={isSelected}
              >
                <div className={styles.cardHeader}>
                  <span className={styles.cardIcon} aria-hidden="true">
                    <FolderOpen size={18} />
                  </span>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardName}>{ws.name}</span>
                    <span className={styles.cardPath}>{ws.path}</span>
                  </div>
                  <button
                    type="button"
                    className={styles.cardRemove}
                    onClick={(e) => handleRemove(e, ws.path)}
                    aria-label={t('workspace.remove', { name: ws.name })}
                    title={t('workspace.remove', { name: ws.name })}
                    disabled={disabled}
                    tabIndex={-1}
                  >
                    <X size={13} />
                  </button>
                </div>
                <div className={styles.cardFooter}>
                  <span className={styles.cardTimestamp}>
                    <Clock3 size={11} />
                    {formatTimeAgo(ws.lastOpenedAt)}
                  </span>
                  {ws.branch ? (
                    <span className={styles.cardBranch}>
                      <FolderGit2 size={11} />
                      {ws.branch}
                    </span>
                  ) : null}
                  {isSelected && (
                    <span className={styles.cardCheck}>
                      <Check size={13} />
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>
          <FolderOpen size={32} className={styles.emptyIcon} />
          <p className={styles.emptyText}>{t('workspace.empty')}</p>
        </div>
      )}

      <button
        ref={browseRef}
        type="button"
        className={styles.browseBtn}
        onClick={onBrowse}
        disabled={disabled}
        aria-label={t('workspace.browse')}
      >
        <Plus size={16} />
        <span>{t('workspace.browse')}</span>
      </button>
    </div>
  );
}
