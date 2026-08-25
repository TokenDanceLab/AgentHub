import { useEffect } from 'react';
import { isWorkbenchRealDataMode } from '@shared/demo';
import type { GlobalRailPage } from './GlobalRail';
import { WORKBENCH_MOCK_TASK_POOL } from './mockData';
import {
  consumeWorkbenchTaskDeepLinkIntent,
  deriveActiveTaskQueue,
  getWorkbenchTaskDeepLinkSnapshot,
  publishWorkbenchTaskQueue,
  subscribeWorkbenchTaskDeepLinks,
  type WorkbenchTaskDeepLinkIntent,
} from './workbenchTaskDeepLinks';

/* ═══════════════════════════════════════════════════════════════════════
   Shell-side application of task ↔ conversation deep links (#1963).

   Surfaces (tasks route view, conversation sidebar) only queue intents in
   `workbenchTaskDeepLinks`; this hook — mounted once by the workbench
   shell — is the single consumer that turns an intent into page /
   conversation navigation, keeping the deep link reversible ("可后退")
   through the same intent store.
   ═══════════════════════════════════════════════════════════════════════ */

export interface UseWorkbenchTaskDeepLinksOptions {
  setActivePage: (page: GlobalRailPage) => void;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  /** Platform data mode (`workbenchStatus.dataMode`) — governs the demo seed. */
  dataMode?: string | undefined;
}

function navigateForDeepLinkIntent(
  intent: WorkbenchTaskDeepLinkIntent,
  options: UseWorkbenchTaskDeepLinksOptions,
): void {
  if (intent.type === 'open') {
    if (intent.link.direction === 'task-to-conversation') {
      options.setActivePage('chat');
      if (intent.link.conversationId) {
        options.onActiveConversationChange?.(intent.link.conversationId);
      }
      return;
    }
    options.setActivePage('runs');
    return;
  }
  // Back trip: return to the page the deep link started from. The other half
  // of the origin state (task focus / active conversation) is preserved by
  // the store and the surfaces themselves.
  options.setActivePage(intent.link.direction === 'task-to-conversation' ? 'runs' : 'chat');
}

export function useWorkbenchTaskDeepLinks(options: UseWorkbenchTaskDeepLinksOptions): void {
  const { setActivePage, onActiveConversationChange, dataMode } = options;

  useEffect(() => {
    function applyPendingIntent(): void {
      if (!getWorkbenchTaskDeepLinkSnapshot().pending) return;
      const intent = consumeWorkbenchTaskDeepLinkIntent();
      if (intent) navigateForDeepLinkIntent(intent, { setActivePage, onActiveConversationChange });
    }

    // Drain anything queued before mount (e.g. a restored intent in tests),
    // then follow the store for live intents.
    applyPendingIntent();
    return subscribeWorkbenchTaskDeepLinks(applyPendingIntent);
  }, [setActivePage, onActiveConversationChange]);

  // Sidebar queue seed for the chat page, where the tasks route hook is
  // unmounted and cannot publish: demo mode derives the queue from the mock
  // pool; real data mode has no task backend yet (#1818) so the queue stays
  // empty and the group hides. While the tasks route is mounted it
  // republishes its live inventory over this seed.
  const realDataMode = isWorkbenchRealDataMode(dataMode);
  useEffect(() => {
    publishWorkbenchTaskQueue(
      realDataMode ? [] : deriveActiveTaskQueue(WORKBENCH_MOCK_TASK_POOL),
    );
  }, [realDataMode]);
}
