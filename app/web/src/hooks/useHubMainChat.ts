import { useCallback, useEffect, useRef, useState } from 'react';
import { createHubClient, type MessageResponse } from '@/api/hubClient';
import type { HubWSHandle } from '@/api/hubWS';
import { getAccessToken } from '@/hooks/useAuth';
import { HUB_EVENTS } from '@shared/hubEvents';
import type { ChatMessage } from '@/components/ChatView.types';
import {
  hubMessageToChatMessage,
  mergeChatMessages,
  type HubMessageLike,
} from '@/utils/hubAdapters';

interface UseHubMainChatOptions {
  sessionId: string | null;
  authenticated: boolean;
  hubWS: HubWSHandle | null;
}

export function useHubMainChat({ sessionId, authenticated, hubWS }: UseHubMainChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const hubClientRef = useRef(createHubClient({ getToken: getAccessToken }));

  const refreshMessages = useCallback(async () => {
    if (!sessionId || !authenticated || !getAccessToken()) {
      setMessages([]);
      return;
    }
    const snapshot = await hubClientRef.current.getMessages(sessionId, { limit: 80 });
    const converted = snapshot.map((msg: MessageResponse) => hubMessageToChatMessage(msg));
    setMessages((current) => mergeChatMessages(current, converted));
  }, [authenticated, sessionId]);

  useEffect(() => {
    void refreshMessages().catch(() => {
      setMessages([]);
    });
  }, [refreshMessages]);

  useEffect(() => {
    if (!hubWS || !authenticated || !sessionId) return;
    const unsub = hubWS.on(HUB_EVENTS.MESSAGE_NEW, (rawPayload: unknown) => {
      const msg = rawPayload as HubMessageLike;
      const msgSessionId = msg?.session_id ?? msg?.sessionId;
      if (msgSessionId !== sessionId) return;
      setMessages((current) => mergeChatMessages(current, [hubMessageToChatMessage(msg)]));
    });
    return unsub;
  }, [authenticated, hubWS, sessionId]);

  const appendOptimistic = useCallback((message: ChatMessage) => {
    setMessages((current) => mergeChatMessages(current, [message]));
  }, []);

  const removeMessage = useCallback((messageId: string) => {
    setMessages((current) => current.filter((message) => message.id !== messageId));
  }, []);

  return {
    messages,
    appendOptimistic,
    removeMessage,
    refreshMessages,
  } as const;
}
