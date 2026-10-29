import { useMemo, useState } from 'react';
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import type { WorkbenchConversation } from '../../platform';
import { ThreadList } from './elements/thread-list.aui';
import { useAssistantText } from './text';

export interface ConversationActions {
  rename?: ((id: string, title: string) => Promise<void>) | undefined;
  delete?: ((id: string) => Promise<void>) | undefined;
  archive?: ((id: string, archived: boolean) => Promise<void>) | undefined;
}

export interface AssistantThreadListProps {
  conversations: WorkbenchConversation[];
  currentId: string;
  onSelect?: ((id: string) => void) | undefined;
  onNew?: (() => void) | undefined;
  actions?: ConversationActions | undefined;
}

export function AssistantThreadList({ conversations, currentId, onSelect, onNew, actions }: AssistantThreadListProps) {
  const [error, setError] = useState<string>();
  const [showArchived, setShowArchived] = useState(false);
  const t = useAssistantText();
  // The list runtime only projects server-owned thread metadata. It owns no message history.
  const threads = useMemo(() => conversations.filter((item) => Boolean(item.archived) === showArchived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
    .map((item) => ({ id: item.id, title: item.title, status: 'regular' as const,
      custom: { canRename: item.canRename, canDelete: item.canDelete, canArchive: item.canArchive, unreadCount: item.unreadCount } })), [conversations, showArchived]);
  const perform = async (action: () => Promise<void>) => {
    setError(undefined);
    try { await action(); } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update conversation');
      throw cause;
    }
  };
  const { rename, delete: deleteConversation, archive } = actions ?? {};
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: [],
    convertMessage: (message) => message,
    async onNew() { /* This runtime renders the thread list only. */ },
    adapters: { threadList: { threadId: currentId, threads,
      onSwitchToThread: onSelect,
      onSwitchToNewThread: onNew,
      ...(rename ? { onRename: (id: string, title: string) => perform(() => rename(id, title)) } : {}),
      onDelete: deleteConversation ? (id) => perform(() => deleteConversation(id)) : undefined,
      onArchive: archive ? (id) => perform(() => archive(id, !showArchived)) : undefined,
    } },
  });
  return <AssistantRuntimeProvider runtime={runtime}>
    <div className="aui-root flex h-full min-h-0 flex-col gap-2 overflow-y-auto p-2">
      <ThreadList canRename={Boolean(actions?.rename)} canDelete={Boolean(actions?.delete)} canArchive={Boolean(actions?.archive)} archived={showArchived} />
      {error && <p role="alert" className="text-destructive px-2 text-sm">{error}</p>}
      {(showArchived || conversations.some((item) => item.archived)) && <button type="button" className="text-muted-foreground mt-auto rounded-md px-2 py-2 text-start text-xs hover:bg-muted"
        onClick={() => setShowArchived(!showArchived)}>{t(showArchived ? 'Active conversations' : 'Archived conversations')}</button>}
    </div>
  </AssistantRuntimeProvider>;
}
