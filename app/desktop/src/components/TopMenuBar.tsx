import { useState, useEffect, useRef } from 'react';
import styles from '@/App.module.css';
import { resolveTopMenuClickState, type TopMenuId } from '@/utils/topMenuState';

export interface TopMenuItem {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  separatorBefore?: boolean;
  action: () => void | Promise<void>;
}

export type TopMenuDefinition = Record<TopMenuId, { label: string; items: TopMenuItem[] }>;

export const TOP_MENU_ORDER: TopMenuId[] = ['file', 'edit', 'view', 'window', 'help'];

interface TopMenuBarProps {
  menus: TopMenuDefinition;
  ariaLabel?: string;
}

export default function TopMenuBar({ menus, ariaLabel }: TopMenuBarProps) {
  const [openTopMenu, setOpenTopMenu] = useState<TopMenuId | null>(null);
  const [hoverOpenedTopMenu, setHoverOpenedTopMenu] = useState<TopMenuId | null>(null);
  const hoverOpenedTopMenuRef = useRef<TopMenuId | null>(null);
  const topMenuRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!openTopMenu) return undefined;

    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && topMenuRef.current?.contains(target)) return;
      setOpenTopMenu(null);
      setHoverOpenedTopMenu(null);
      hoverOpenedTopMenuRef.current = null;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpenTopMenu(null);
      setHoverOpenedTopMenu(null);
      hoverOpenedTopMenuRef.current = null;
    };

    window.addEventListener('pointerdown', closeOnPointerDown, true);
    window.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown, true);
      window.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [openTopMenu]);

  return (
    <nav className={styles.appMenu} ref={topMenuRef} aria-label={ariaLabel}>
      {TOP_MENU_ORDER.map((menuId) => {
        const menu = menus[menuId];
        const expanded = openTopMenu === menuId;
        const panelId = `top-menu-${menuId}`;
        return (
          <div
            key={menuId}
            className={styles.topMenuGroup}
            onMouseEnter={() => {
              if (!openTopMenu) return;
              setHoverOpenedTopMenu(menuId);
              hoverOpenedTopMenuRef.current = menuId;
            }}
          >
            <button
              type="button"
              className={`${styles.topMenuTrigger} ${expanded ? styles.topMenuTriggerActive : ''}`}
              aria-haspopup="menu"
              aria-expanded={expanded}
              aria-controls={expanded ? panelId : undefined}
              onClick={() => {
                setOpenTopMenu((current) => resolveTopMenuClickState(current, menuId, hoverOpenedTopMenuRef.current ?? hoverOpenedTopMenu));
                setHoverOpenedTopMenu(null);
                hoverOpenedTopMenuRef.current = null;
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setOpenTopMenu(menuId);
                  setHoverOpenedTopMenu(null);
                  hoverOpenedTopMenuRef.current = null;
                }
              }}
            >
              {menu.label}
            </button>
            {expanded && (
              <div id={panelId} className={styles.topMenuPanel} role="menu" aria-label={menu.label}>
                {menu.items.map((item) => (
                  <div key={item.id} className={styles.topMenuItemWrap}>
                    {item.separatorBefore && <div className={styles.topMenuSeparator} role="separator" />}
                    <button
                      type="button"
                      role="menuitem"
                      className={`${styles.topMenuItem} ${item.danger ? styles.topMenuItemDanger : ''}`}
                      disabled={item.disabled}
                      aria-disabled={item.disabled ? true : undefined}
                      title={item.disabled && item.detail ? item.detail : undefined}
                      onClick={() => {
                        if (item.disabled) return;
                        const result = item.action();
                        setOpenTopMenu(null);
                        setHoverOpenedTopMenu(null);
                        hoverOpenedTopMenuRef.current = null;
                        if (result instanceof Promise) void result;
                      }}
                    >
                      <span className={styles.topMenuItemLabel}>{item.label}</span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
