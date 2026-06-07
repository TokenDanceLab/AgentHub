import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
  webHubEmptyTranscript,
  webTranscript,
} from './webPlatform';
import { useWebHubRealtime } from './webHubRealtime';

const hubClient = createHubClient({ getToken: getAccessToken });

export function useWebWorkbenchModel() {
  const authenticated = useHubStore((state) => state.authenticated);
  const hubReady = authenticated && Boolean(getAccessToken());
  const [liveRuntimeEvents, setLiveRuntimeEvents] = useState<HubRuntimeEventTranscriptInput[]>([]);

  const sessions = useQuery({
    queryKey: ['web-v4', 'hub-sessions', hubReady],
    queryFn: () => hubClient.listSessions(),
    enabled: hubReady,
    refetchInterval: hubReady ? 10_000 : false,
    placeholderData: (previous) => previous,
  });

  const conversations = resolveWebWorkbenchConversations(sessions.data, hubReady);
  const activeConversationId = conversations[0]?.id ?? 'agent-collab';
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

  const transcript = resolveWebWorkbenchTranscript(
    hubReady,
    activeHubSessionId,
    messages.data,
    liveRuntimeEvents,
  );

  return {
    activeConversationId,
    conversations,
    transcript,
  };
}

export function resolveWebWorkbenchTranscript(
  hubReady: boolean,
  activeHubSessionId: string | null,
  messages: HubMessageTranscriptInput[] | undefined,
  liveRuntimeEvents: HubRuntimeEventTranscriptInput[],
): TranscriptBlock[] {
  if (!hubReady) return webTranscript;
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
