import { useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './ShortcutHelp.module.css';

interface Shortcut {
  keys: string[];
  description: string;
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'], description: 'shortcut.search' },
  { keys: ['⌘/Ctrl', 'B'], description: 'shortcut.toggleSidebar' },
  { keys: ['⌘/Ctrl', 'J'], description: 'shortcut.toggleRunPanel' },
  { keys: ['Enter'], description: 'shortcut.send' },
  { keys: ['Shift', 'Enter'], description: 'shortcut.newline' },
  { keys: ['Escape'], description: 'shortcut.close' },
  { keys: ['?'], description: 'shortcut.help' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function ShortcutHelp({ open, onClose }: Props) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap: keep focus inside the dialog
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
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      // Focus the close button on open
      requestAnimationFrame(() => {
        dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      });
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcut.title')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>{t('shortcut.title')}</h2>
          <button className={styles.closeBtn} onClick={onClose} aria-label={t('shortcut.close')} type="button">
            &times;
          </button>
        </div>

        <table className={styles.table}>
          <tbody>
            {SHORTCUTS.map((sc) => (
              <tr key={sc.description} className={styles.row}>
                <td className={styles.keys}>
                  {sc.keys.map((key, i) => (
                    <span key={key}>
                      <kbd className={styles.kbd}>{key}</kbd>
                      {i < sc.keys.length - 1 && (
                        <span className={styles.plus}>+</span>
                      )}
                    </span>
                  ))}
                </td>
                <td className={styles.desc}>{t(sc.description)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
