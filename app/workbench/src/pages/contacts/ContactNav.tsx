import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../ContactsPage.module.css';
import { NavGlyph, NAV_ITEMS } from './shared';
import type { ContactsPageProps } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Contacts left-nav shell — org row, pane nav, recent shortcuts.

   Extracted from ContactsPage as Phase 18 strangler slice #574.
   CSS remains on shared ContactsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

export type ContactNavProps = Pick<
  ContactsPageProps,
  | 'activePane'
  | 'onPaneChange'
  | 'searchQuery'
  | 'onSearchChange'
  | 'orgName'
  | 'orgInitials'
  | 'pendingContacts'
  | 'friendRequests'
  | 'sentRequests'
  | 'recentShortcuts'
>;

export function ContactNav({
  activePane,
  onPaneChange,
  searchQuery = '',
  onSearchChange,
  orgName,
  orgInitials,
  pendingContacts,
  friendRequests,
  sentRequests,
  recentShortcuts = [],
}: ContactNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const resolvedPending = pendingContacts ?? [];
  const requestCount = (friendRequests?.length ?? 0) + (sentRequests?.length ?? 0);
  const navItems = NAV_ITEMS.map((item) =>
    item.id === 'new' && (resolvedPending.length > 0 || requestCount > 0)
      ? { ...item, badge: resolvedPending.length > 0 ? resolvedPending.length : requestCount }
      : item,
  );

  return (
    <aside className={`${styles.nav} workbench-nav`}>
      <div className={`${styles.navTitle} workbench-title`}>{t('nav.contacts')}</div>
      <input
        className={`${styles.search} workbench-search`}
        placeholder={t('contacts.search.placeholder')}
        value={searchQuery}
        onChange={(e) => onSearchChange?.(e.target.value)}
      />

      <div className={styles.orgRow}>
        <div className={styles.orgLogo}>{orgInitials}</div>
        <span className={styles.orgName}>{orgName}</span>
        <button type="button" className={styles.orgAction}>
          {t('contacts.manage')}
        </button>
      </div>

      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.navRow} ${
            activePane === item.id ? styles.navRowActive : ''
          }`}
          onClick={() => onPaneChange(item.id)}
        >
          <NavGlyph name={item.icon} />
          {item.label}
          {item.badge != null && (
            <small className={styles.navBadge}>{item.badge}</small>
          )}
        </button>
      ))}

      <div className={styles.navCaption}>{t('contacts.recentContacts')}</div>
      {recentShortcuts.map((name) => (
        <div key={name} className={styles.navShortcut}>
          {name}
        </div>
      ))}
    </aside>
  );
}
