/* ═══════════════════════════════════════════════════════════════════════
   Settings left-nav shell — sections, search, and scope rows.

   Extracted from SettingsPage as Phase 21 residual thin #604.
   CSS remains on shared SettingsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import styles from '../SettingsPage.module.css';
import { NavGlyph, SettingsScopeRow } from './shared';
import { NAV_ITEMS } from './types';
import type { SettingsPaneId } from './types';

export type SettingsNavProps = {
  activePane: SettingsPaneId;
  onSelectPane: (pane: SettingsPaneId) => void;
  spaceTitle: string;
  spaceMeta: string;
  currentUserDisplayName?: string | undefined;
};

export function SettingsNav({
  activePane,
  onSelectPane,
  spaceTitle,
  spaceMeta,
  currentUserDisplayName,
}: SettingsNavProps): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <aside className={`${styles.nav} workbench-nav`}>
      <div className={`${styles.navTitle} workbench-title`}>{t('nav.settings')}</div>
      <input
        className={`${styles.navSearch} workbench-search`}
        type="search"
        placeholder={t('settings.searchPlaceholder')}
      />
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={`${styles.navRow}${activePane === item.id ? ` ${styles.navRowActive}` : ''}`}
          type="button"
          onClick={() => onSelectPane(item.id)}
        >
          <NavGlyph name={item.glyph} />
          {item.label}
        </button>
      ))}
      <div className={styles.navCaption}>{t('settings.currentSpace')}</div>
      <SettingsScopeRow title={spaceTitle} meta={spaceMeta} />
      <SettingsScopeRow title="TokenDance" meta="组织空间" />
      <SettingsScopeRow title={currentUserDisplayName ?? '未登录'} meta="当前用户" />
    </aside>
  );
}
