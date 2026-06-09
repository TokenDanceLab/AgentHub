import { describe, expect, it } from 'vitest';

import {
  buildTabAccessibilityLabel,
  formatTabBadgeCount,
  getTabBadgeCount,
  isTabSelected,
  shouldRenderBottomTabRail,
} from './navigationLayout';

describe('navigation layout helpers', () => {
  it('groups detail and overflow tabs under their parent selection state', () => {
    expect(isTabSelected('thread', 'chat', ['thread'])).toBe(true);
    expect(isTabSelected('settings', 'more', ['contacts', 'agents', 'settings', 'account', 'more'])).toBe(true);
    expect(isTabSelected('docs', 'chat', ['thread'])).toBe(false);
  });

  it('limits tab badges to the chat and task rails', () => {
    expect(getTabBadgeCount('chat', { pendingReviews: 5, unreadThreads: 12 })).toBe(12);
    expect(getTabBadgeCount('tasks', { pendingReviews: 5, unreadThreads: 12 })).toBe(5);
    expect(getTabBadgeCount('docs', { pendingReviews: 5, unreadThreads: 12 })).toBe(0);
    expect(formatTabBadgeCount(0)).toBeUndefined();
    expect(formatTabBadgeCount(100)).toBe('99+');
  });

  it('includes selected state and badge context in tab accessibility labels', () => {
    expect(buildTabAccessibilityLabel({ badgeCount: 3, label: 'Chats', selected: true, value: 'chat' }))
      .toBe('Chats, selected, 3 unread');
    expect(buildTabAccessibilityLabel({ badgeCount: 2, label: 'Tasks', selected: false, value: 'tasks' }))
      .toBe('Tasks, 2 pending reviews');
    expect(buildTabAccessibilityLabel({ badgeCount: 0, label: 'Docs', selected: false, value: 'docs' }))
      .toBe('Docs');
  });

  it('keeps tablet split-pane rails inline instead of duplicating shell tabs', () => {
    expect(shouldRenderBottomTabRail({ activeTab: 'chat' })).toBe(true);
    expect(shouldRenderBottomTabRail({ activeTab: 'thread' })).toBe(false);
    expect(shouldRenderBottomTabRail({ activeTab: 'account' })).toBe(false);
    expect(shouldRenderBottomTabRail({ activeTab: 'chat', placement: 'inlinePane' })).toBe(false);
    expect(shouldRenderBottomTabRail({ activeTab: 'chat', hidden: true })).toBe(false);
  });
});
