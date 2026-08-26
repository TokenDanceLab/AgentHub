import { useEffect } from 'react';
import { normalizeWorkbenchDataMode } from '@shared/demo';
import type { GlobalRailPage } from './GlobalRail';
import { WORKBENCH_MOCK_TASK_POOL } from './mockData';
import {
  deriveActiveTaskQueue,
  useWorkbenchTaskDeepLinkStore,
  type WorkbenchTaskDeepLinkIntent,
  type WorkbenchTaskQueueSource,
} from './workbenchTaskDeepLinks';

export interface UseWorkbenchTaskDeepLinksOptions {
  setActivePage: (page: GlobalRailPage) => void;
  onActiveConversationChange?: ((conversationId: string) => void) | undefined;
  /** Compatibility field only; only explicit mock/fixture may seed local tasks. */
  dataMode?: string | undefined;
}

export function resolveTaskQueueDemoSource(dataMode: string | undefined): WorkbenchTaskQueueSource {
  const normalized = normalizeWorkbenchDataMode(dataMode);
  if (normalized === 'mock') return 'demo';
  if (normalized === 'fixture') return 'fixture';
  return null;
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

  if (intent.link.direction === 'task-to-conversation') {
    options.setActivePage('runs');
    return;
  }

  // Restore the conversation that originated the task link, even if the
  // externally controlled active conversation changed while Tasks was open.
  if (intent.link.conversationId) {
    options.onActiveConversationChange?.(intent.link.conversationId);
  }
  options.setActivePage('chat');
}

export function useWorkbenchTaskDeepLinks(options: UseWorkbenchTaskDeepLinksOptions): void {
  const { setActivePage, onActiveConversationChange, dataMode } = options;
  const store = useWorkbenchTaskDeepLinkStore();

  useEffect(() => {
    function applyPendingIntent(): void {
      if (!store.getSnapshot().pending) return;
      const intent = store.consume();
      if (intent) navigateForDeepLinkIntent(intent, { setActivePage, onActiveConversationChange });
    }

    applyPendingIntent();
    return store.subscribe(applyPendingIntent);
  }, [store, setActivePage, onActiveConversationChange]);

  // dataMode does not prove source. Only explicit mock/fixture modes seed the
  // local pool; auto/observed/approved-real stay empty until a task backend
  // publishes a runtime inventory.
  const demoSource = resolveTaskQueueDemoSource(dataMode);
  useEffect(() => {
    store.publishTaskQueue(
      demoSource ? deriveActiveTaskQueue(WORKBENCH_MOCK_TASK_POOL) : [],
      demoSource,
    );
  }, [store, demoSource]);
}
