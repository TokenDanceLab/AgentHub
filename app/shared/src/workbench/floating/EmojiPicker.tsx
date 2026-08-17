/* ═══════════════════════════════════════════════════════════════════════
   EmojiPicker — lightweight fixed-emoji grid (#1384).

   Minimal picker used by the transcript context menu's react submenu: a
   fixed set of common emojis in a 2×3 grid with roving-tabindex keyboard
   support (WAI-ARIA grid pattern). Deliberately no third-party emoji
   library — the set is tiny and curated.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import styles from './EmojiPicker.module.css';

/** Fixed emoji set — keep small on purpose (#1384, no emoji library). */
export const EMOJI_OPTIONS = ['👍', '❤️', '🎉', '👀', '🚀', '✅'] as const;

/** Grid columns of the picker (2 rows of 3). */
const GRID_COLUMNS = 3;

export interface EmojiPickerProps {
  /** Fired with the picked emoji (click, or Enter/Space on the focused cell). */
  onSelect: (emoji: string) => void;
  /** Accessible name of the grid, e.g. t('aria.emojiPicker'). */
  ariaLabel?: string | undefined;
  /** Focus the first emoji on mount — used when opening inside a submenu. */
  autoFocus?: boolean | undefined;
}

export const EmojiPicker: React.FC<EmojiPickerProps> = ({
  onSelect,
  ariaLabel = '选择表情',
  autoFocus = false,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const gridRef = useRef<HTMLDivElement>(null);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const count = EMOJI_OPTIONS.length;

  // Rows of GRID_COLUMNS with the global index of each cell, so arrow-key
  // navigation can jump between rows without duplicating the layout here.
  const rows = useMemo(() => {
    const result: Array<Array<{ emoji: string; index: number }>> = [];
    EMOJI_OPTIONS.forEach((emoji, index) => {
      if (index % GRID_COLUMNS === 0) result.push([]);
      result[result.length - 1]!.push({ emoji, index });
    });
    return result;
  }, []);

  // Roving tabindex: move DOM focus to the active cell while the user is
  // navigating inside the grid; on mount only when autoFocus is requested,
  // so embedding the picker in a page does not steal focus.
  useEffect(() => {
    if (gridRef.current?.contains(document.activeElement) || autoFocus) {
      cellRefs.current[activeIndex]?.focus();
    }
    // autoFocus is a mount-time intent; roving applies for the grid's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null;
    switch (e.key) {
      case 'ArrowRight':
        next = (activeIndex + 1) % count;
        break;
      case 'ArrowLeft':
        next = (activeIndex - 1 + count) % count;
        break;
      case 'ArrowDown':
        next = (activeIndex + GRID_COLUMNS) % count;
        break;
      case 'ArrowUp':
        next = (activeIndex - GRID_COLUMNS + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      case 'Escape':
        // Escape is owned by the submenu host (ContextMenu); do not swallow.
        return;
      default:
        return;
    }
    e.preventDefault();
    setActiveIndex(next);
  };

  return (
    <div
      ref={gridRef}
      role="grid"
      aria-label={ariaLabel}
      className={styles.grid}
      onKeyDown={handleKeyDown}
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} role="row" className={styles.row}>
          {row.map(({ emoji, index }) => (
            <button type="button"
              key={emoji}
              ref={(el) => {
                cellRefs.current[index] = el;
              }}
              role="gridcell"
              tabIndex={index === activeIndex ? 0 : -1}
              className={`${styles.cell}${index === activeIndex ? ` ${styles.active}` : ''}`}
              onClick={() => onSelect(emoji)}
              onMouseEnter={() => setActiveIndex(index)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
};
