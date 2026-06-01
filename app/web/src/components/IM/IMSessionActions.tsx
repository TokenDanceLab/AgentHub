import { useState, useCallback, useRef, useEffect, memo } from 'react';
import { Pin, PinOff, Archive, ArchiveRestore, Bell, BellOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './IMSessionActions.module.css';

interface IMSessionActionsProps {
  pinned?: boolean | undefined;
  archived?: boolean | undefined;
  muted?: boolean | undefined;
  onPin?: (() => void) | undefined;
  onUnpin?: (() => void) | undefined;
  onArchive?: (() => void) | undefined;
  onUnarchive?: (() => void) | undefined;
  onMute?: (() => void) | undefined;
  onUnmute?: (() => void) | undefined;
}

const IMSessionActions = memo(function IMSessionActions({
  pinned,
  archived,
  muted,
  onPin,
  onUnpin,
  onArchive,
  onUnarchive,
  onMute,
  onUnmute,
}: IMSessionActionsProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const handleToggle = useCallback(() => {
    setOpen((v) => !v);
  }, []);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div className={styles.wrapper}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        onClick={handleToggle}
        aria-label={t('im.actions')}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
          <circle cx="3" cy="7" r="1.2" />
          <circle cx="7" cy="7" r="1.2" />
          <circle cx="11" cy="7" r="1.2" />
        </svg>
      </button>

      {open && (
        <div ref={menuRef} className={styles.menu} role="menu" onMouseDown={(e) => e.stopPropagation()}>
          {pinned ? (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onUnpin?.();
                handleClose();
              }}
            >
              <PinOff size={14} />
              <span>{t('im.unpin')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onPin?.();
                handleClose();
              }}
            >
              <Pin size={14} />
              <span>{t('im.pin')}</span>
            </button>
          )}

          {archived ? (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onUnarchive?.();
                handleClose();
              }}
            >
              <ArchiveRestore size={14} />
              <span>{t('im.unarchive')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onArchive?.();
                handleClose();
              }}
            >
              <Archive size={14} />
              <span>{t('im.archive')}</span>
            </button>
          )}

          <div className={styles.separator} />

          {muted ? (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onUnmute?.();
                handleClose();
              }}
            >
              <Bell size={14} />
              <span>{t('im.unmute')}</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.menuItem}
              role="menuitem"
              onClick={() => {
                onMute?.();
                handleClose();
              }}
            >
              <BellOff size={14} />
              <span>{t('im.mute')}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
});

export default IMSessionActions;
