// SelectionDeleteConfirm — #1823 destructive multi-delete confirm gate.
//
// planMultiAction('delete') raises a confirm step instead of soft-hiding
// immediately (the Delete hotkey and the bar button both go through it).
// This inline bar sits above the MultiSelectBar; Escape / 取消 dismiss it
// without deleting, 确认删除 runs the soft-hide.

import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import styles from './SelectionDeleteConfirm.module.css';

export interface SelectionDeleteConfirmProps {
  /** Number of selected blocks this delete would remove. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  workspaceLeft?: number | undefined;
  workspaceWidth?: number | undefined;
}

export const SelectionDeleteConfirm: React.FC<SelectionDeleteConfirmProps> = ({
  count,
  onConfirm,
  onCancel,
  workspaceLeft,
  workspaceWidth,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  // A11y (#1823): move focus to the confirm button on mount so the pending
  // destructive action is immediately operable from the keyboard.
  useEffect(() => {
    confirmButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      // Consume Escape inside the confirm so the selection-mode document
      // listener (exit selection) does not fold it too — the first Escape
      // cancels the pending delete, a second one leaves selection mode.
      event.stopPropagation();
      onCancel();
    }
  };

  const style = {
    ...(workspaceLeft !== undefined ? { '--selectbar-left': `${Math.round(workspaceLeft)}px` } : {}),
    ...(workspaceWidth !== undefined ? { '--selectbar-width': `${Math.round(workspaceWidth)}px` } : {}),
  } as React.CSSProperties;

  return (
    <div
      className={styles.confirm}
      style={style}
      role="alertdialog"
      aria-label={t('selection.confirmDeleteAria', { count })}
      onKeyDown={handleKeyDown}
      data-testid="selection-delete-confirm"
    >
      <span className={styles.message}>{t('selection.confirmDeleteTitle', { count })}</span>
      <button
        ref={confirmButtonRef}
        type="button"
        className={styles.confirmBtn}
        onClick={onConfirm}
      >
        {t('selection.confirmDelete')}
      </button>
      <button
        type="button"
        className={styles.cancelBtn}
        onClick={onCancel}
      >
        {t('selection.cancelDelete')}
      </button>
    </div>
  );
};
