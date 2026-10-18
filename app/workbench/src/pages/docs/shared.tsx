/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for DocsPage subviews (#582).
   ═══════════════════════════════════════════════════════════════════════ */

import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../../designIcons';
import styles from '../DocsPage.module.css';
import type { DocsPane, DocsPageNavItem } from './types';

// ── Design icons ──
//
// Demo shortcut names live in mockData.ts and reach the page through the docs
// route; real mode renders no shortcut block.

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

// ── Nav item icon lookup ──

export const NAV_ICONS: Record<string, DesignNavIconName> = {
  home: 'home',
  drive: 'drive',
  library: 'library',
  notes: 'notes',
  download: 'download',
};

export const DEFAULT_NAV_ITEMS: DocsPageNavItem[] = [
  { id: 'home', label: '主页', icon: 'home' },
  { id: 'drive', label: '云盘', icon: 'drive' },
  { id: 'library', label: '知识库', icon: 'library' },
  { id: 'notes', label: '智能纪要', icon: 'notes' },
  // `trailing` is only populated from real data; there is no download
  // pipeline, so the nav does not claim one is in progress.
  { id: 'download', label: '离线', icon: 'download' },
];

// ── Tab definitions ──

export const DOC_TABS: { id: DocsPane; labelKey: string }[] = [
  { id: 'recent', labelKey: 'docs.tab.recent' },
  { id: 'owned', labelKey: 'docs.tab.mine' },
  { id: 'shared', labelKey: 'docs.tab.shared' },
  { id: 'starred', labelKey: 'docs.tab.starred' },
];
