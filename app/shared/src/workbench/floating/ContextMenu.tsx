import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
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

  useEffect(() => {
    if (!isOpen) return;

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const menuGroups = groups ?? (items ? [items] : []);
  const handleBackdropClick = () => onClose();
  const handleItemClick = (item: ContextMenuItem) => {
    item.onClick?.();
    onClose();
  };

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
            {group.map((item, itemIndex) => (
              <button
                key={`${item.label}-${itemIndex}`}
                className={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}`}
                type="button"
                role="menuitem"
                onClick={() => handleItemClick(item)}
              >
                <span className={styles.icon}>
                  <DesignNavIcon name={item.icon ?? 'folder'} size={15} />
                </span>
                <span>{item.label}</span>
                {item.shortcut ? <kbd className={styles.shortcut}>{item.shortcut}</kbd> : null}
                {item.chevron ? <b className={styles.chevron}>›</b> : null}
              </button>
            ))}
          </div>
        ))}
      </section>
    </>
  );
};
