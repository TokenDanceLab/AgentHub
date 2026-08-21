import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';
import { DesignNavIcon, type DesignNavIconName } from '../designIcons';
import { FOCUSABLE, useFocusTrap } from '@shared/ui/focusTrap';
import styles from './ContextMenu.module.css';

export interface ContextMenuItem {
  icon?: DesignNavIconName | undefined;
  label: string;
  shortcut?: string;
  chevron?: boolean;
  danger?: boolean;
  onClick?: () => void;
  /**
   * Optional submenu panel (#1384). Rendered next to the item when it is
   * active/focused (chevron items). May be a node or a render function that
   * receives `close` (closes the whole menu — call it after the submenu
   * selection is committed).
   */
  submenu?: React.ReactNode | ((close: () => void) => React.ReactNode);
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
const SUBMENU_WIDTH = 132;

export const ContextMenu: React.FC<ContextMenuProps> = ({
  groups,
  items,
  isOpen,
  subtitle,
  title,
  x,
  y,
  onClose,
}) => {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  const resolvedSubtitle = subtitle ?? t('context.cardActions');
  const menuRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x, top: y });
  const [activeIndex, setActiveIndex] = useState(0);
  // Flat index of the item whose submenu panel is open (null = none).
  const [submenuIndex, setSubmenuIndex] = useState<number | null>(null);
  // Submenu flips to the left when the menu sits near the right viewport edge.
  const [submenuFlip, setSubmenuFlip] = useState(false);

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

  // Reset activeIndex (and any open submenu) on every open (render-phase
  // state update — safe in React 18+).
  const prevOpenRef = useRef(isOpen);
  if (isOpen && !prevOpenRef.current) {
    setActiveIndex(0);
    setSubmenuIndex(null);
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

  // Keep the open submenu in sync with the active item: hovering or roving
  // to an item with a `submenu` opens it; moving away closes it.
  useEffect(() => {
    if (!isOpen) return;
    const active = flatItems[activeIndex]?.item;
    setSubmenuIndex(active?.submenu !== undefined ? activeIndex : null);
  }, [activeIndex, isOpen, flatItems]);

  // Move focus into the submenu panel when it opens (its content may also
  // autofocus); when it closes, roving focus stays on the parent item.
  useEffect(() => {
    if (!isOpen || submenuIndex === null || !menuRef.current) return;
    const panel = menuRef.current.querySelector<HTMLElement>('[data-submenu-panel]');
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
  }, [submenuIndex, isOpen]);

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
    setSubmenuFlip(left + MENU_WIDTH + SUBMENU_WIDTH > window.innerWidth - EDGE_GAP);

    const raf = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(raf);
  }, [isOpen, x, y]);

  // Keyboard: Escape close + Arrow navigation (wrap) + Enter select + Home/End.
  // While a submenu is open it owns navigation (arrows rove inside it); the
  // menu level only handles Escape (close the submenu, keep the menu).
  useEffect(() => {
    if (!isOpen || flatItems.length === 0) return;

    const handleKey = (e: KeyboardEvent) => {
      if (submenuIndex !== null) {
        // Escape always closes the submenu; ArrowLeft closes it only when
        // focus is outside the submenu panel, so content that roves with
        // arrows (e.g. the EmojiPicker grid) keeps its own Left/Right keys.
        const focusInSubmenu = menuRef.current
          ?.querySelector('[data-submenu-panel]')
          ?.contains(document.activeElement);
        if (e.key === 'Escape' || (e.key === 'ArrowLeft' && !focusInSubmenu)) {
          e.preventDefault();
          setSubmenuIndex(null);
          const buttons = menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
          buttons?.[activeIndex]?.focus();
        }
        return;
      }
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
        case 'ArrowRight': {
          const item = flatItems[activeIndex]?.item;
          if (item?.submenu !== undefined) {
            e.preventDefault();
            setSubmenuIndex(activeIndex);
          }
          break;
        }
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
          const item = flatItems[activeIndex]?.item;
          if (item?.submenu !== undefined) {
            // Chevron item: open the submenu instead of activating the action.
            setSubmenuIndex(activeIndex);
          } else {
            item?.onClick?.();
            onClose();
          }
          break;
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose, flatItems, activeIndex, submenuIndex]);

  if (!isOpen) return null;

  const menuGroups = groups ?? (items ? [items] : []);
  const handleBackdropClick = () => onClose();
  const handleItemClick = (idx: number) => {
    const item = flatItems[idx]?.item;
    if (item?.submenu !== undefined) {
      // Chevron item with a submenu: opening it is the click's job, not the
      // item action (prevents accidental default reactions).
      setSubmenuIndex(idx);
      return;
    }
    item?.onClick?.();
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
        aria-label={t('aria.contextMenu')}
        style={{ left: pos.left, top: pos.top }}
      >
        {title && (
          <div className={styles.title}>
            <span>{title}</span>
            <small>{resolvedSubtitle}</small>
          </div>
        )}
        {menuGroups.map((group, groupIndex) => (
          <div key={groupIndex} className={styles.group}>
            {group.map((item, itemIndex) => {
              const idx = globalIdx++;
              const isActive = idx === activeIndex;
              const isSubmenuOpen = idx === submenuIndex;
              const menuItemButton = (
                <button
                  key={`${item.label}-${itemIndex}`}
                  className={`${styles.item}${item.danger ? ` ${styles.danger}` : ''}${isActive ? ` ${styles.active}` : ''}`}
                  type="button"
                  role="menuitem"
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleItemClick(idx)}
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
              if (item.submenu === undefined) return menuItemButton;
              return (
                <div
                  key={`submenu-${item.label}-${itemIndex}`}
                  className={styles.submenuAnchor}
                >
                  {menuItemButton}
                  {isSubmenuOpen ? (
                    <div
                      className={`${styles.submenu}${submenuFlip ? ` ${styles.flip}` : ''}`}
                      data-submenu-panel
                    >
                      {typeof item.submenu === 'function' ? item.submenu(onClose) : item.submenu}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </section>
    </>
  );
};
