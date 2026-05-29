import React, { type ReactNode } from 'react';
import styles from './BottomSheet.module.css';

export interface BottomSheetProps {
  ariaLabel: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
  eyebrow?: string;
  description?: ReactNode;
  closeIcon?: ReactNode;
  closeDisabled?: boolean;
  children?: ReactNode;
  footer?: ReactNode;
  layerClassName?: string;
  scrimClassName?: string;
  sheetClassName?: string;
  handleClassName?: string;
  headerClassName?: string;
  eyebrowClassName?: string;
  titleClassName?: string;
  closeButtonClassName?: string;
  descriptionClassName?: string;
  footerClassName?: string;
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}

export function BottomSheet({
  ariaLabel,
  title,
  closeLabel,
  onClose,
  eyebrow,
  description,
  closeIcon,
  closeDisabled = false,
  children,
  footer,
  layerClassName,
  scrimClassName,
  sheetClassName,
  handleClassName,
  headerClassName,
  eyebrowClassName,
  titleClassName,
  closeButtonClassName,
  descriptionClassName,
  footerClassName,
}: BottomSheetProps) {
  return (
    <div className={cx(styles.layer, layerClassName)} role="presentation">
      <button
        className={cx(styles.scrim, scrimClassName)}
        type="button"
        aria-label={closeLabel}
        disabled={closeDisabled}
        onClick={onClose}
      />
      <section className={cx(styles.sheet, sheetClassName)} role="dialog" aria-modal="true" aria-label={ariaLabel}>
        <div className={cx(styles.handle, handleClassName)} aria-hidden="true" />
        <div className={cx(styles.header, headerClassName)}>
          <div>
            {eyebrow ? <p className={cx(styles.eyebrow, eyebrowClassName)}>{eyebrow}</p> : null}
            <h2 className={cx(styles.title, titleClassName)}>{title}</h2>
          </div>
          <button
            className={cx(styles.closeButton, closeButtonClassName)}
            type="button"
            disabled={closeDisabled}
            aria-label={closeLabel}
            onClick={onClose}
          >
            {closeIcon ?? <span aria-hidden="true">x</span>}
          </button>
        </div>
        {description ? <p className={cx(styles.description, descriptionClassName)}>{description}</p> : null}
        {children}
        {footer ? <div className={cx(styles.footer, footerClassName)}>{footer}</div> : null}
      </section>
    </div>
  );
}
