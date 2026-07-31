import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
import { useFocusTrap } from '../../ui/focusTrap';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  icon?: DesignNavIconName | undefined;
  label: string;
  shortcut?: string;
  chevron?: boolean;
  danger?: boolean;
  onClick?: () => void;
}

export interface ContextMenuProps {
  groups?: Array<Array<ContextMenuItem>> | undefined;
  isOpen: boolean;
  items?: Array<ContextMenuItem> | undefined;
  subtitle?: string | undefined;
  title?: string | undefined;
  x: number;
  y: number;
  onClose: () => void;
}

const EDGE_GAP = 8;
const MENU_WIDTH = 244;

export const ContextMenu: React.FC<ContextMenuProps> = ({
  groups,
  items,
  isOpen,
  subtitle = '卡片操作',
  title,
  x,
  y,
  onClose,
}) => {
  const menuRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [activeIndex, setActiveIndex] = useState(0);

  // Flatten menu groups into a single indexed list for arrow navigation.
  const flatItems = useMemo(() => {
    const menuGroups = groups ?? (items ? [items] : []);
    const result: Array<{ item: ContextMenuItem; groupIndex: number; itemIndex: number }> = [];
    menuGroups.forEach((group, gi) => {
      group.forEach((item, ii) => {
        result.push({ item, groupIndex: gi, itemIndex: ii });
      });
    });
    return result;
  }, [groups, items]);

  // Reset activeIndex on every open (render-phase state update — safe in React 18+).
  const prevOpenRef = useRef(isOpen);
  if (isOpen && !prevOpenRef.current) {
    setActiveIndex(0);
  }
  prevOpenRef.current = isOpen;

  // Focus trap: saves trigger, wraps Tab/Shift+Tab, returns focus on close.
  useFocusTrap(menuRef, isOpen);

  // Focus the active menu item whenever activeIndex changes.
  useEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const buttons = menuRef.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    const target = buttons[activeIndex] as HTMLButtonElement | undefined;
    target?.focus();
  }, [activeIndex, isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) {
      setOpen(false);
      return;
    }

    const rect = menuRef.current.getBoundingClientRect();
    const menuH = rect.height || 360;
    const left = Math.max(EDGE_GAP, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_GAP));
    const top = Math.max(EDGE_GAP, Math.min(y, window.innerHeight - menuH - EDGE_GAP));

    setPos({ left: Math.round(left), top: Math.round(top) });

    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, x, y]);

  // Keyboard: Escape close + Arrow navigation (wrap) + Enter select + Home/End.
  useEffect(() => {
    if (!isOpen || flatItems.length === 0) return;

    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % flatItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
          break;
        case 'Home':
          e.preventDefault();
          setActiveIndex(0);
          break;
        case 'End':
          e.preventDefault();
          setActiveIndex(flatItems.length - 1);
          break;
        case 'Enter': {
          e.preventDefault();
          flatItems[activeIndex]?.item.onClick?.();
          onClose();
          break;
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, flatItems, activeIndex]);

  if (!isOpen) return null;

  const menuGroups = groups ?? (items ? [items] : []);
  const handleBackdropClick = () => onClose();
  const handleItemClick = (item: ContextMenuItem) => {
    item.onClick?.();
    onClose();
  };

  // Track global index during render for active highlight.
  let globalIdx = 0;

  return (
    <>
      <div className={styles.backdrop} onClick={handleBackdropClick} />
      <section
        ref={menuRef}
        className={`${styles.menu}${open ? ` ${styles.open}` : ''}`}
        role="menu"
        aria-label="卡片操作菜单"
        style={{ left: pos.left, top: pos.top }}
      >
        {title && (
          <div className={styles.title}>
            <span>{title}</span>
            <small>{subtitle}</small>
          </div>
        )}
        {menuGroups.map((group, groupIndex) => (
          <div key={groupIndex} className={styles.group}>
            {group.map((item, itemIndex) => {
              const idx = globalIdx++;
              const isActive = idx === activeIndex;
              return (
                <button
                  key={`${item.label}-${itemIndex}`}
                  className={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}${isActive ? ` ${styles.active}` : ''}`}
                  type="button"
                  role="menuitem"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleItemClick(item)}
                  onMouseEnter={() => setActiveIndex(idx)}
                >
                  <span className={styles.icon}>
                    <DesignNavIcon name={item.icon ?? 'folder'} size={15} />
                  </span>
                  <span>{item.label}</span>
                  {item.shortcut ? <kbd className={styles.shortcut}>{item.shortcut}</kbd> : null}
                  {item.chevron ? <b className={styles.chevron}>›</b> : null}
                </button>
              );
            })}
          </div>
        ))}
      </section>
    </>
  );
};
