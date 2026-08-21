import React from 'react';
import {
  DesignNavIcon,
  DESIGN_NAV_GLYPH_SIZE,
  DESIGN_NAV_GLYPH_STROKE_WIDTH,
  type DesignNavIconName,
} from '../../designIcons';
import styles from '../ContactsPage.module.css';
import type { ContactModalTab, ContactsPane } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for ContactsPage subviews.
   Extracted for Phase 17 strangler slice #561.
   ═══════════════════════════════════════════════════════════════════════ */

// ── Capability tag colors (matches AgentsPage convention) ──

const CAPABILITY_TAG_COLORS: readonly string[] = ['tagBlue', 'tagGreen', 'tagOrange', 'tagPurple', 'tagTeal'];

export function capabilityColor(index: number): string {
  return CAPABILITY_TAG_COLORS[index % CAPABILITY_TAG_COLORS.length] ?? '';
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

export interface NavItem {
  id: ContactsPane;
  label: string;
  icon: DesignNavIconName;
  /** Optional badge count (for 'new' pane) */
  badge?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { id: 'internal', label: '组织内联系人', icon: 'users' },
  { id: 'external', label: '外部联系人', icon: 'external' },
  { id: 'new', label: '新的联系人', icon: 'userPlus' },
  { id: 'starred', label: '星标联系人', icon: 'star' },
  { id: 'groups', label: '我的群组', icon: 'groups' },
  { id: 'service', label: '服务台', icon: 'service' },
];

// ── Modal tab items ──

export interface ModalTabItem {
  id: ContactModalTab;
  label: string;
}

export const MODAL_TABS: ModalTabItem[] = [
  { id: 'qr', label: '企业二维码' },
  { id: 'link', label: '企业链接' },
  { id: 'code', label: '企业邀请码' },
  { id: 'phone', label: '手机号' },
];
