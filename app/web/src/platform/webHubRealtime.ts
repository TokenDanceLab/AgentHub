import { useEffect, useRef } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubRuntimeEventFromPayload, type HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { createHubWS, type HubWSHandle, type HubWSOptions } from '@/api/hubWS';
import { getAccessToken } from '@/hooks/useAuth';

type HubPayload = Record<string, unknown>;
type CreateHubWS = (opts: HubWSOptions) => HubWSHandle;

const SESSION_EVENTS = new Set<string>([
  HUB_EVENTS.SESSION_CREATED,
  HUB_EVENTS.SESSION_DISSOLVED,
  HUB_EVENTS.SESSION_INFO_UPDATED,
  HUB_EVENTS.SESSION_MEMBER_JOINED,
  HUB_EVENTS.SESSION_MEMBER_LEFT,
]);

const MESSAGE_EVENTS = new Set<string>([
  HUB_EVENTS.MESSAGE_NEW,
  HUB_EVENTS.MESSAGE_RECALL,
  HUB_EVENTS.MESSAGE_PIN,
  HUB_EVENTS.MESSAGE_UNPIN,
  HUB_EVENTS.MESSAGE_READ,
]);

const AGENT_EVENTS = new Set<string>([
  HUB_EVENTS.AGENT_STREAM,
  HUB_EVENTS.AGENT_DONE,
  HUB_EVENTS.AGENT_FAILED,
  HUB_EVENTS.AGENT_CANCEL,
]);

export interface WebHubRealtimeOptions {
  enabled: boolean;
  runtimeSessionId?: string | null;
  onRuntimeEvent?: (event: HubRuntimeEventTranscriptInput) => void;
  createSocket?: CreateHubWS;
  getToken?: () => string | null;
}

export function useWebHubRealtime({
  enabled,
  runtimeSessionId,
  onRuntimeEvent,
  createSocket = createHubWS,
  getToken = getAccessToken,
}: WebHubRealtimeOptions): void {
  const queryClient = useQueryClient();
  const runtimeSessionIdRef = useRef(runtimeSessionId);
  const onRuntimeEventRef = useRef(onRuntimeEvent);

  useEffect(() => {
    runtimeSessionIdRef.current = runtimeSessionId;
    onRuntimeEventRef.current = onRuntimeEvent;
  }, [onRuntimeEvent, runtimeSessionId]);

  useEffect(() => {
    if (!enabled) return undefined;

    const socket = createSocket({ getToken });
    const unsubscribe = socket.onAny((type, payload) => {
      invalidateWebWorkbenchHubQueries(queryClient, type, payload);
      dispatchHubRuntimeEvent(type, payload, runtimeSessionIdRef.current, onRuntimeEventRef.current);
    });

    socket.connect();
    return () => {
      unsubscribe();
      socket.close();
    };
  }, [createSocket, enabled, getToken, queryClient]);
}

export function dispatchHubRuntimeEvent(
  eventType: string,
  payload: unknown,
  runtimeSessionId: string | null | undefined,
  onRuntimeEvent: ((event: HubRuntimeEventTranscriptInput) => void) | undefined,
): void {
  if (eventType !== HUB_EVENTS.AGENT_STREAM || !onRuntimeEvent || !runtimeSessionId) return;

  const event = hubRuntimeEventFromPayload(payload);
  if (!event || event.session_id !== runtimeSessionId) return;
  onRuntimeEvent(event);
}

export function invalidateWebWorkbenchHubQueries(
  queryClient: QueryClient,
  eventType: string,
  payload: unknown,
): void {
  const touchesSessions = SESSION_EVENTS.has(eventType) || MESSAGE_EVENTS.has(eventType) || AGENT_EVENTS.has(eventType);
  if (!touchesSessions) return;

  void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });

  if (!MESSAGE_EVENTS.has(eventType) && !AGENT_EVENTS.has(eventType)) return;

  const sessionId = readSessionId(payload);
  void queryClient.invalidateQueries({
    queryKey: sessionId
      ? ['web-v4', 'hub-messages', sessionId]
      : ['web-v4', 'hub-messages'],
  });
}

function readSessionId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as HubPayload;
  const direct = record.session_id ?? record.sessionId;
  if (typeof direct === 'string' && direct.trim()) return direct;

  const nested = record.message;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return undefined;
  const nestedRecord = nested as HubPayload;
  const nestedSession = nestedRecord.session_id ?? nestedRecord.sessionId;
  return typeof nestedSession === 'string' && nestedSession.trim() ? nestedSession : undefined;
}
