import type { MobileTab } from '@/types';

export type BottomTabRailPlacement = 'bottom' | 'inlinePane' | 'hidden';

interface NavigationBadgeCounters {
  pendingReviews: number;
  unreadThreads: number;
}

interface TabAccessibilityOptions {
  badgeCount: number;
  label: string;
  selected: boolean;
  value: MobileTab;
}

interface BottomTabRailOptions {
  activeTab: MobileTab;
  hidden?: boolean;
  placement?: BottomTabRailPlacement;
}

export function isTabSelected(
  activeTab: MobileTab,
  value: MobileTab,
  activeValues: MobileTab[] = [],
): boolean {
  return value === activeTab || activeValues.includes(activeTab);
}

export function getTabBadgeCount(
  value: MobileTab,
  counters: NavigationBadgeCounters,
): number {
  if (value === 'chat') {
    return normalizeBadgeCount(counters.unreadThreads);
  }
  if (value === 'tasks') {
    return normalizeBadgeCount(counters.pendingReviews);
  }

  return 0;
}

export function formatTabBadgeCount(count: number): string | undefined {
  const normalized = normalizeBadgeCount(count);
  if (normalized <= 0) {
    return undefined;
  }

  return normalized > 99 ? '99+' : String(normalized);
}

export function buildTabAccessibilityLabel({
  badgeCount,
  label,
  selected,
  value,
}: TabAccessibilityOptions): string {
  const parts = [label.trim()];
  if (selected) {
    parts.push('selected');
  }

  const badgeContext = formatBadgeAccessibilityContext(value, badgeCount);
  if (badgeContext) {
    parts.push(badgeContext);
  }

  return parts.filter(Boolean).join(', ');
}

export function shouldRenderBottomTabRail({
  activeTab,
  hidden = false,
  placement = 'bottom',
}: BottomTabRailOptions): boolean {
  if (hidden || placement !== 'bottom') {
    return false;
  }

  return activeTab !== 'thread' && activeTab !== 'account';
}

function formatBadgeAccessibilityContext(value: MobileTab, count: number): string | undefined {
  const normalized = normalizeBadgeCount(count);
  if (normalized <= 0) {
    return undefined;
  }

  if (value === 'chat') {
    return `${normalized} unread`;
  }
  if (value === 'tasks') {
    return `${normalized} pending reviews`;
  }

  return `${normalized} updates`;
}

function normalizeBadgeCount(count: number): number {
  if (!Number.isFinite(count)) {
    return 0;
  }

  return Math.max(0, Math.trunc(count));
}
