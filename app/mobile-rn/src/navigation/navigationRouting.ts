// Application-level navigation routing for mobile deep links and
// notification click intents (issue #1824).
//
// Pure reducer mapping MobileNavigationTarget (shared notification intent
// SSOT) onto the app's tab/selection state. App.tsx applies the result to
// React state; unit-testing the mapping keeps the wire-up honest without
// requiring RN rendering.

import type { MobileNavigationTarget } from '@/integrations/notificationIntents';
import type { MobileInspectorSheetMode, MobileTab } from '@/types';

export interface MobileNavigationRoutingState {
  activeTab: MobileTab;
  threadId?: string;
  runId?: string;
  /** When set, the tasks screen opens the review sheet on mount. */
  approvalSheetMode?: MobileInspectorSheetMode;
}

export function reduceNavigationTarget(
  _state: MobileNavigationRoutingState,
  target: MobileNavigationTarget,
): MobileNavigationRoutingState {
  if (target.screen === 'thread') {
    return {
      activeTab: 'thread',
      threadId: target.threadId,
    };
  }

  const next: MobileNavigationRoutingState = { activeTab: 'tasks' };
  if (target.runId) {
    next.runId = target.runId;
  }
  if (target.threadId) {
    next.threadId = target.threadId;
  }
  if (target.source === 'approval') {
    next.approvalSheetMode = 'review';
  }
  return next;
}
