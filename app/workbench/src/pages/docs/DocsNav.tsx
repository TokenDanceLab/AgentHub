/* ═══════════════════════════════════════════════════════════════════════
   Docs left-nav subview — extracted for Phase 19 #582.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../DocsPage.module.css';
import { DEFAULT_NAV_ITEMS, NAV_ICONS, NavGlyph } from './shared';
import type { DocsPageNavItem } from './types';

export function DocsNav({
  activeNav,
  onNavChange,
  searchQuery = '',
  onSearchChange,
  navItems,
  shortcuts,
  onShortcutClick,
}: {
  activeNav: string;
  onNavChange: (navId: string) => void;
  searchQuery?: string | undefined;
  onSearchChange?: ((query: string) => void) | undefined;
  navItems: DocsPageNavItem[];
  shortcuts: string[];
  onShortcutClick?: ((name: string) => void) | undefined;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const resolvedNavItems = navItems.length > 0 ? navItems : DEFAULT_NAV_ITEMS;

  return (
    <aside className={`${styles.nav} workbench-nav`}>
      <div className={`${styles.navTitle} workbench-title`}>{t('nav.docs')}</div>
      <input
        className={`${styles.search} workbench-search`}
        placeholder={t('header.search')}
        value={searchQuery}
        // #2154 P1-1: no onSearchChange = frozen input. Disabled + title keep
        // the surface honest until the docs search is actually wired.
        disabled={!onSearchChange}
        title={onSearchChange ? undefined : t('search.unavailableHint')}
        onChange={(e) => onSearchChange?.(e.target.value)}
      />

      {resolvedNavItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.navRow} ${
            activeNav === item.id ? styles.navRowActive : ''
          }`}
          onClick={() => onNavChange(item.id)}
        >
          <NavGlyph name={item.icon ?? NAV_ICONS[item.id] ?? 'fileText'} />
          {item.label}
          {item.trailing && (
            <small className={styles.navBadge}>{item.trailing}</small>
          )}
        </button>
      ))}

      {/* #2154 P2-2(b): the caption + shortcut list only render when there is
          real shortcut data. With none, the whole block disappears instead of
          advertising an empty "我的文档库" section. */}
      {shortcuts.length > 0 && (
        <>
          <div className={styles.navCaption}>{t('docs.myLibrary')}</div>
          {shortcuts.map((name) => (
            <div
              key={name}
              className={styles.navShortcut}
              onClick={() => onShortcutClick?.(name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onShortcutClick?.(name);
                }
              }}
            >
              {name}
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
