// Modal/Overlay component — shared UI primitive
// Used by ArtifactPreview, fullscreen diff, and future overlay content.
import { useEffect, useCallback, useRef, type ReactNode } from 'react';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from './focusTrap';
import { useExiting } from './useExiting';
import { Tooltip } from './Tooltip';
import { Button } from './Button';
import { CHATVIEW_I18N_NAMESPACE } from '../chatview/i18n/resources';
import styles from './Modal.module.css';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string | undefined;
  children?: ReactNode | undefined;
  /** Render the body at 100vw x 100vh with no border-radius. */
  fullscreen?: boolean | undefined;
  onToggleFullscreen?: (() => void) | undefined;
  /** Additional class for the overlay wrapper. */
  overlayClassName?: string | undefined;
  /** Additional class for the content container. */
  contentClassName?: string | undefined;
}

export function Modal({
  open,
  onClose,
  title,
  children,
  fullscreen,
  onToggleFullscreen,
  overlayClassName,
  contentClassName,
}: ModalProps) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(overlayRef, open);

  // Keep the overlay mounted through the exit animation after onClose flips
  // `open` false (#1825); reduced-motion drops it immediately.
  const { mounted, exiting } = useExiting(open, 200);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, handleKeyDown]);

  // Prevent body scroll while modal is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!mounted) return null;

  const contentClasses = [
    styles.content,
    fullscreen ? styles.contentFullscreen : '',
    contentClassName ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      ref={overlayRef}
      className={`${styles.overlay}${exiting ? ` ${styles.overlayExiting}` : ''}${overlayClassName ? ` ${overlayClassName}` : ''}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Modal'}
    >
      <div className={contentClasses}>
        {(title != null || onToggleFullscreen != null) && (
          <div className={styles.header}>
            {title != null && <span className={styles.title}>{title}</span>}
            {onToggleFullscreen != null && (
              <Tooltip label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onToggleFullscreen}
                  aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  type="button"
                >
                  {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </Button>
              </Tooltip>
            )}
            <Tooltip label={t('ui.close', 'Close')}>
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                aria-label={t('ui.close', 'Close')}
                type="button"
              >
                <X size={16} />
              </Button>
            </Tooltip>
          </div>
        )}
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}

export default Modal;
