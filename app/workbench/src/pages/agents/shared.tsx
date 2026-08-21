import React from 'react';
import styles from '../AgentsPage.module.css';
import type { RiskLevel } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Shared presentational helpers for AgentsPage subviews.
   Extracted for Phase 16 strangler slice #552.
   ═══════════════════════════════════════════════════════════════════════ */

export function permissionClass(value: string): string {
  if (value === '允许' || value === '默认允许') return 'allow';
  if (value === '禁止') return 'deny';
  return 'confirm';
}

export function riskClass(level: RiskLevel): string {
  if (level === '高风险') return 'risk-high';
  if (level === '低风险') return 'risk-low';
  return 'risk-mid';
}

export const ConfigSummaryRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className={styles['config-summary-row']}>
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

export function formatList(items: string[] | undefined, emptyLabel: string): string {
  if (!items || items.length === 0) return emptyLabel;
  return items.join(' · ');
}
