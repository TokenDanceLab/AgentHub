import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID,
  normalizeWorkbenchDataMode,
  resolveDemoWorkbenchTranscript,
} from '@shared/demo';
import {
  normalizeHubMessagesToTranscript,
  normalizeHubRuntimeEventsToTranscript,
  type HubMessageTranscriptInput,
  type HubRuntimeEventTranscriptInput,
  type TranscriptBlock,
} from '@shared/transcript';
import { createHubClient } from '@/api/hubClient';
import { getAccessToken } from '@/hooks/useAuth';
import { useHubStore } from '@/stores/hubStore';
import {
  resolveWebWorkbenchConversations,
  webConversationWithPinnedMessages,
  webHubEmptyTranscript,
} from './webPlatform';
import { useWebHubRealtime } from './webHubRealtime';

const hubClient = createHubClient({ getToken: getAccessToken });

export function useWebWorkbenchModel(selectedConversationId?: string) {
  const dataMode = normalizeWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE);
  const authenticated = useHubStore((state) => state.authenticated);
  const hubReady = dataMode !== 'demo' && authenticated && Boolean(getAccessToken());
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<HubRuntimeEventTranscriptInput[]>([]);

  const sessions = useQuery({
    queryKey: ['web-v4', 'hub-sessions', hubReady],
    queryFn: () => hubClient.listSessions(),
    enabled: hubReady,
    refetchInterval: hubReady ? 10_000 : false,
    placeholderData: (previous) => previous,
  });

  const conversations = resolveWebWorkbenchConversations(sessions.data, hubReady, dataMode);
  const activeConversationId = (
    conversations.some((conversation) => conversation.id === selectedConversationId)
      ? selectedConversationId
      : conversations[0]?.id
  ) ?? 'agent-collab';
  const activeHubSessionId = hubReady && sessions.data?.length ? activeConversationId : null;

  useEffect(() => {
    setLiveRuntimeEvents([]);
  }, [activeHubSessionId]);

  const appendLiveRuntimeEvent = useCallback((event: HubRuntimeEventTranscriptInput) => {
    setLiveRuntimeEvents((current) => appendHubRuntimeEvent(current, event));
  }, []);

  useWebHubRealtime({
    enabled: hubReady,
    runtimeSessionId: activeHubSessionId,
    onRuntimeEvent: appendLiveRuntimeEvent,
  });

  const messages = useQuery({
    queryKey: ['web-v4', 'hub-messages', activeHubSessionId],
    queryFn: () => hubClient.getMessages(activeHubSessionId!, { limit: 80 }),
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const pinnedMessages = useQuery({
    queryKey: ['web-v4', 'hub-pins', activeHubSessionId],
    queryFn: () => hubClient.listPinnedMessages(activeHubSessionId!),
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const resolvedConversations = hubReady && activeHubSessionId
    ? conversations.map((conversation) =>
      conversation.id === activeHubSessionId
        ? webConversationWithPinnedMessages(conversation, pinnedMessages.data)
        : conversation,
    )
    : conversations;

  const transcript = resolveWebWorkbenchTranscript(
    hubReady,
    activeHubSessionId,
    messages.data,
    liveRuntimeEvents,
  );

  return {
    activeConversationId,
    conversations: resolvedConversations,
    transcript,
  };
}

export function resolveWebWorkbenchTranscript(
  hubReady: boolean,
  activeHubSessionId: string | null,
  messages: HubMessageTranscriptInput[] | undefined,
  liveRuntimeEvents: HubRuntimeEventTranscriptInput[],
  dataMode = normalizeWorkbenchDataMode(import.meta.env.VITE_AGENTHUB_DATA_MODE),
): TranscriptBlock[] {
  if (!hubReady) {
    return dataMode === 'real'
      ? webHubEmptyTranscript
      : resolveDemoWorkbenchTranscript(WORKBENCH_DEMO_FALLBACK_CONVERSATION_ID);
  }
  if (!activeHubSessionId) return webHubEmptyTranscript;
  return [
    ...normalizeHubMessagesToTranscript(messages),
    ...normalizeHubRuntimeEventsToTranscript(liveRuntimeEvents),
  ];
}

export function appendHubRuntimeEvent(
  current: HubRuntimeEventTranscriptInput[],
  incoming: HubRuntimeEventTranscriptInput,
  limit = 200,
): HubRuntimeEventTranscriptInput[] {
  const incomingKey = hubRuntimeEventKey(incoming);
  const replaced = current.filter((event) => hubRuntimeEventKey(event) !== incomingKey);
  return [...replaced, incoming].slice(-limit);
}

function hubRuntimeEventKey(event: HubRuntimeEventTranscriptInput): string {
  return event.id ?? [
    event.task_id,
    event.edge_run_id,
    event.event_seq,
    event.event_type,
  ].filter((part) => part != null && String(part).trim()).join(':');
}
