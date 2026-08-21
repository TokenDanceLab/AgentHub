/* ═══════════════════════════════════════════════════════════════════════
   ForwardConversationPicker — 转发目标会话多选器 (#1385).

   Used by the transcript context menu's forward submenu: lists the current
   conversations, the user picks one or more targets (forwardMessage accepts
   targetSessionIds[]), and onConfirm fires with the chosen ids.

   WAI-ARIA listbox pattern: role="listbox" aria-multiselectable, options
   with aria-selected, roving tabindex, ArrowUp/Down to move, Space toggles
   a selection, Enter commits (confirm button click path also available).
   Escape is owned by the submenu host (ContextMenu) and deliberately not
   swallowed, mirroring the EmojiPicker convention.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkbenchConversation } from '@shared/platform';
import styles from './ForwardConversationPicker.module.css';

export interface ForwardConversationPickerProps {
  /** Current conversation list; each id doubles as the forward target session id. */
  conversations: WorkbenchConversation[];
  /** Accessible name of the listbox, e.g. t('aria.forwardPicker'). */
  ariaLabel?: string | undefined;
  /** Confirm button label, e.g. t('forward.confirm'). */
  confirmLabel?: string | undefined;
  /** Cancel button label, e.g. t('forward.cancel'). Hidden when onCancel is absent. */
  cancelLabel?: string | undefined;
  /** Shown when there are no conversations to forward to. */
  emptyLabel?: string | undefined;
  /** Auto-focus the first option on mount — used when opening inside a submenu. */
  autoFocus?: boolean | undefined;
  /** Fired with the chosen target session ids (click, or Enter on the list). */
  onConfirm: (targetSessionIds: string[]) => void;
  /** Optional cancel button action (typically the submenu close). */
  onCancel?: (() => void) | undefined;
}

export const ForwardConversationPicker: React.FC<ForwardConversationPickerProps> = ({
  conversations,
  ariaLabel = '选择转发目标会话',
  confirmLabel = '确认转发',
  cancelLabel = '取消',
  emptyLabel = '暂无会话可转发',
  autoFocus = false,
  onConfirm,
  onCancel,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLDivElement | null>>([]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const isEmpty = conversations.length === 0;
  const count = conversations.length;

  // Roving tabindex: move DOM focus to the active option while the user is
  // navigating; on mount only when autoFocus is requested, so embedding the
  // picker in a page does not steal focus (mirrors EmojiPicker).
  useEffect(() => {
    if (listboxRef.current?.contains(document.activeElement) || autoFocus) {
      optionRefs.current[activeIndex]?.focus();
    }
    // autoFocus is a mount-time intent; roving applies for the picker's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const toggle = (id: string): void => {
    setSelectedIds((prev) => (
      prev.includes(id) ? prev.filter((other) => other !== id) : [...prev, id]
    ));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    // Escape is owned by the submenu host (ContextMenu); do not swallow.
    if (e.key === 'Escape') return;
    if (count === 0) return;
    let next: number | null;
    switch (e.key) {
      case 'ArrowDown':
        next = (activeIndex + 1) % count;
        break;
      case 'ArrowUp':
        next = (activeIndex - 1 + count) % count;
        break;
      case ' ':
      case 'Space':
        e.preventDefault();
        toggle(conversations[activeIndex]!.id);
        return;
      case 'Enter':
        e.preventDefault();
        if (selectedIds.length > 0) onConfirm(selectedIds);
        return;
      default:
        return;
    }
    e.preventDefault();
    setActiveIndex(next);
  };

  return (
    <>
      {isEmpty ? (
        <div role="status" className={styles.empty}>{emptyLabel}</div>
      ) : (
        <div
          ref={listboxRef}
          role="listbox"
          aria-label={ariaLabel}
          aria-multiselectable="true"
          className={styles.listbox}
          onKeyDown={handleKeyDown}
        >
          {conversations.map((conversation, index) => {
            const isSelected = selectedSet.has(conversation.id);
            const isActive = index === activeIndex;
            return (
              <div
                key={conversation.id}
                ref={(el) => {
                  optionRefs.current[index] = el;
                }}
                role="option"
                aria-selected={isSelected}
                tabIndex={isActive ? 0 : -1}
                className={`${styles.option}${isActive ? ` ${styles.active}` : ''}`}
                onClick={() => toggle(conversation.id)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className={styles.check} aria-hidden="true">{isSelected ? '✓' : ''}</span>
                <span className={styles.title}>{conversation.title}</span>
              </div>
            );
          })}
        </div>
      )}
      {!isEmpty && (
        <div className={styles.actions}>
          {onCancel ? (
            <button
              type="button"
              className={styles.cancel}
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={styles.confirm}
            disabled={selectedIds.length === 0}
            onClick={() => onConfirm(selectedIds)}
          >
            {confirmLabel}
          </button>
        </div>
      )}
    </>
  );
};
