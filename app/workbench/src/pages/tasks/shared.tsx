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
import { useTranslation } from 'react-i18next';
import { CHATVIEW_I18N_NAMESPACE } from '@shared/chatview/i18n/resources';

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

export const NAV_PRIMARY: NavPrimaryItem[] = [
  { id: 'owned', label: '我负责的', icon: 'users', badge: 3 },
  { id: 'watching', label: '我关注的', icon: 'star' },
  { id: 'activity', label: '动态', icon: 'running' },
];

export const NAV_QUICK: NavQuickItem[] = [
  { id: 'all', label: '全部任务', icon: 'folder' },
  { id: 'created', label: '我创建的', icon: 'folder' },
  { id: 'assigned', label: '我分配的', icon: 'folder' },
  { id: 'done', label: '已完成', icon: 'done' },
];

export const PANE_TITLES: Record<TasksPane, string> = {
  owned: '我负责的',
  watching: '我关注的',
  activity: '动态',
  all: '全部任务',
  created: '我创建的',
  assigned: '我分配的',
  done: '已完成',
};

export const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'list', label: '列表' },
  { id: 'board', label: '看板' },
  { id: 'dashboard', label: '仪表盘' },
];

// ── Small chrome helpers ──

export function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <article className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <strong className={styles.statValue}>{value}</strong>
    </article>
  );
}

export function TaskNavMenu({ open }: { open: boolean }) {
  const { t } = useTranslation(CHATVIEW_I18N_NAMESPACE);
  if (!open) return null;

  return (
    <div className={styles.navMenu} role="menu" aria-label={t("aria.taskMoreMenu")}>
      <button type="button" role="menuitem">
        <DesignNavIcon name="fileText" size={14} />
        导入任务
      </button>
      <button type="button" role="menuitem">
        <DesignNavIcon name="folder" size={14} />
        导出当前视图
      </button>
      <button type="button" role="menuitem">
        <DesignNavIcon name="settings" size={14} />
        管理任务字段
      </button>
    </div>
  );
}
