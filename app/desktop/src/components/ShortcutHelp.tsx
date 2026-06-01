import { useEffect, useRef, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BINDING_IDS, getBinding } from '@/stores/keybindingStore';
import styles from './ShortcutHelp.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onNavigateToKeyboard?: () => void;
}

function groupIcon(id: ShortcutGroupId): ReactNode {
  switch (id) {
    case 'conversation':
      return <MessageSquareText size={15} />;
    case 'composer':
      return <Command size={15} />;
    case 'navigation':
      return <PanelLeft size={15} />;
    case 'workspace':
      return <Settings2 size={15} />;
    default:
      return <Keyboard size={15} />;
  }
}

export default function ShortcutHelp({ open, onClose, onNavigateToKeyboard }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!open) return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [open, onClose],
  );

  useEffect(() => {
    if (!open) return undefined;
    document.addEventListener('keydown', handleKeyDown);
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.headerIcon} aria-hidden="true">
            <Keyboard size={17} />
          </span>
          <h2 id="shortcut-help-title" className={styles.title}>{t('shortcut.title')}</h2>
          <button
            ref={closeButtonRef}
            className={styles.closeBtn}
            onClick={onClose}
            aria-label={t('shortcut.close')}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <table className={styles.table}>
          <tbody>
            {BINDING_IDS.map((id) => {
              const keys = getBinding(id);
              return (
                <tr key={id} className={styles.row}>
                  <td className={styles.keys}>
                    {keys.map((key, i) => (
                      <span key={key}>
                        <kbd className={styles.kbd}>{key}</kbd>
                        {i < keys.length - 1 && (
                          <span className={styles.plus}>+</span>
                        )}
                      </span>
                    ))}
                  </td>
                  <td className={styles.desc}>{t(`shortcut.${id}`)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
