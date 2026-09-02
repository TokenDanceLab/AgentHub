/* ═══════════════════════════════════════════════════════════════════════
   Projects chrome subviews — nav row, filters, tabs, editor.

   Residual extract from ProjectDetailViews for Phase 22 #618.
   CSS remains on shared ProjectsPage.module.css.
   ═══════════════════════════════════════════════════════════════════════ */

import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { SHARED_WORKBENCH_I18N_NAMESPACE } from '@shared/i18n';
import { DesignNavIcon } from '../../designIcons';
import {
  FOLDER_THEME_COLORS,
  FOLDER_THEME_COLOR_META,
} from '@shared/folderThemeColors';
import styles from '../ProjectsPage.module.css';
import type {
  ProjectDraft,
  ProjectFilter,
  ProjectInfo,
  ProjectTab,
} from './types';
import { FILTER_ITEMS, TAB_ITEMS } from './types';

export function ProjectNavRow({
  project,
  isActive,
  onSelect,
}: {
  project: ProjectInfo;
  isActive: boolean;
  onSelect: (id: string) => void;
}) {
  const handleClick = useCallback(() => {
    onSelect(project.id);
  }, [project.id, onSelect]);

  const rowClass = `${styles.navRow} ${isActive ? styles.navRowActive : ''}`;

  return (
    <button type="button" className={rowClass} onClick={handleClick}>
      <span className={styles.navRowIcon}>
        <DesignNavIcon name={isActive ? 'grid' : 'folder'} size={15} />
      </span>
      <span className={styles.navRowCopy}>
        <strong className={styles.navRowName}>{project.name}</strong>
        <small className={styles.navRowDesc}>{project.description}</small>
      </span>
      <em className={styles.navRowStatus}>{project.status}</em>
    </button>
  );
}

export function FilterList({
  activeFilter,
  onFilterChange,
  availableFilters,
}: {
  activeFilter: ProjectFilter;
  onFilterChange: (filter: ProjectFilter) => void;
  /** Filters the current data source can satisfy; absent = all available. */
  availableFilters?: readonly ProjectFilter[] | undefined;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={styles.filterList}>
      {FILTER_ITEMS.map((item) => {
        // #2154 P2-3: `all` never filters anything out, so it stays clickable.
        // A lifecycle chip is clickable only when at least one loaded project
        // classifies into that bucket — an enabled chip whose click can only
        // yield an empty list would replace the old decorative chip with a
        // fresh false fact about the user's data. Hub exposes no project
        // lifecycle field today (the web projection labels every project
        // 'Hub'/'Hub group'), so on real web data all three render disabled
        // with the reason in the title.
        const available = item.id === 'all'
          || availableFilters === undefined
          || availableFilters.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            data-filter-id={item.id}
            className={`${styles.filterBtn} ${activeFilter === item.id ? styles.filterBtnActive : ''}`}
            disabled={!available}
            title={available ? undefined : t('projects.nav.filterUnavailable')}
            onClick={() => onFilterChange(item.id)}
          >
            <span className={styles.filterBtnIcon}>
              <DesignNavIcon name={item.icon} size={15} />
            </span>
            {t(item.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

export function ProjectTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: ProjectTab;
  onTabChange: (tab: ProjectTab) => void;
}) {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  return (
    <div className={styles.tabs}>
      {TAB_ITEMS.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`${styles.tabBtn} ${activeTab === item.id ? styles.tabBtnActive : ''}`}
          onClick={() => onTabChange(item.id)}
        >
          <DesignNavIcon name={item.icon} size={15} />
          {t(item.labelKey)}
        </button>
      ))}
    </div>
  );
}

export function ProjectEditor({
  mode,
  draft,
  saving,
  error,
  onDraftChange,
  onCancel,
  onSubmit,
}: {
  mode: 'create' | 'update';
  draft: ProjectDraft;
  saving?: boolean | undefined;
  error?: string | undefined;
  onDraftChange: (draft: ProjectDraft) => void;
  onCancel: () => void;
  onSubmit: () => void;
}): React.ReactElement {
  const { t } = useTranslation(SHARED_WORKBENCH_I18N_NAMESPACE);
  const submitLabel = mode === 'create' ? '创建项目' : '保存项目';
  return (
    <form
      className={styles.projectEditor}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className={styles.editorGrid}>
        <label className={styles.editorField}>
          <span>{t('projects.projectName')}</span>
          <input
            value={draft.name}
            onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            disabled={saving}
          />
        </label>
        <label className={styles.editorField}>
          <span>{t('projects.projectDescription')}</span>
          <input
            value={draft.description}
            onChange={(event) => onDraftChange({ ...draft, description: event.target.value })}
            disabled={saving}
          />
        </label>
      </div>
      <fieldset className={styles.editorThemeColor}>
        <legend className={styles.editorThemeColorLegend}>{t('projects.themeColor')}</legend>
        <div className={styles.themeSwatchRow} role="radiogroup" aria-label={t("aria.themeColor")}>
          {FOLDER_THEME_COLORS.map((color) => {
            const meta = FOLDER_THEME_COLOR_META[color];
            const selected = draft.themeColor === color;
            return (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={selected}
                aria-label={meta.label}
                title={meta.label}
                className={`${styles.themeSwatch} ${selected ? styles.themeSwatchActive : ''}`}
                style={{
                  '--swatch-dark': meta.dark,
                  '--swatch-light': meta.light,
                } as React.CSSProperties}
                onClick={() => {
                  const isSelected = draft.themeColor === color;
                  const { themeColor: _omit, ...rest } = draft;
                  void _omit;
                  onDraftChange(isSelected ? rest : { ...rest, themeColor: color });
                }}
                disabled={saving}
              />
            );
          })}
        </div>
      </fieldset>
      {error ? <div className={styles.editorError} role="alert">{error}</div> : null}
      <div className={styles.editorActions}>
        <button type="button" className={styles.editorCancelBtn} onClick={onCancel} disabled={saving}>
          {t('projects.cancel')}
        </button>
        <button type="submit" className={styles.newProjectBtn} disabled={saving || !draft.name.trim()}>
          {saving ? t('projects.saving') : submitLabel}
        </button>
      </div>
    </form>
  );
}
