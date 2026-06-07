import { useQuery } from '@tanstack/react-query';
import { normalizeHubMessagesToTranscript } from '@shared/transcript';
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

  useWebHubRealtime({ enabled: hubReady });

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

  const messages = useQuery({
    queryKey: ['web-v4', 'hub-messages', activeHubSessionId],
    queryFn: () => hubClient.getMessages(activeHubSessionId!, { limit: 80 }),
    enabled: Boolean(activeHubSessionId),
    staleTime: 5_000,
    placeholderData: (previous) => previous,
  });

  const transcript = hubReady
    ? activeHubSessionId
      ? normalizeHubMessagesToTranscript(messages.data)
      : webHubEmptyTranscript
    : webTranscript;

  return {
    activeConversationId,
    conversations,
    transcript,
  };
}
