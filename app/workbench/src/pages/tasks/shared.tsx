/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for TasksPage subviews.
   Extracted for Phase 18 strangler slice #571.
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../../designIcons';
import styles from '../TasksPage.module.css';
import type { TasksPane, ViewMode } from './types';
import type { TFunction } from 'i18next';

// ── Nav definitions ──

interface NavPrimaryItem {
  id: TasksPane;
  label: string;
  icon: DesignNavIconName;
  badge?: number;
}

interface NavQuickItem {
  id: TasksPane;
  label: string;
  icon: DesignNavIconName;
}

// ── Design icons ──

export function NavGlyph({ name }: { name: DesignNavIconName }) {
  return (
    <span className={styles.navGlyph}>
      <DesignNavIcon
        name={name}
        size={DESIGN_NAV_GLYPH_SIZE}
        strokeWidth={DESIGN_NAV_GLYPH_STROKE_WIDTH}
      />
    </span>
  );
}

// ── Nav items ──

// #2154 P3 i18n：模块级常量 label 改为渲染期经 t() 求值（language live）。

export function buildNavPrimary(t: TFunction): NavPrimaryItem[] {
  return [
    { id: 'owned', label: t('tasks.nav.owned'), icon: 'users', badge: 3 },
    { id: 'watching', label: t('tasks.nav.watching'), icon: 'star' },
    { id: 'activity', label: t('tasks.nav.activity'), icon: 'running' },
  ];
}

export function buildNavQuick(t: TFunction): NavQuickItem[] {
  return [
    { id: 'all', label: t('tasks.nav.all'), icon: 'folder' },
    { id: 'created', label: t('tasks.nav.created'), icon: 'folder' },
    { id: 'assigned', label: t('tasks.nav.assigned'), icon: 'folder' },
    { id: 'done', label: t('tasks.nav.done'), icon: 'done' },
  ];
}

export function paneTitle(t: TFunction, pane: TasksPane): string {
  return t(`tasks.nav.${pane}`);
}

export function buildViewModes(t: TFunction): { id: ViewMode; label: string }[] {
  return [
    { id: 'list', label: t('tasks.view.list') },
    { id: 'board', label: t('tasks.view.board') },
    { id: 'dashboard', label: t('tasks.view.dashboard') },
  ];
}

// ── Small chrome helpers ──

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
    </article>
  );
}
