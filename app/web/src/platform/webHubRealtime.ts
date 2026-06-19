import { useEffect, useRef } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubRuntimeEventFromPayload, type HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import { createHubWS, type HubWSHandle, type HubWSOptions } from '@/api/hubWS';
import { createHubClient } from '@/api/hubClient';
import { trackEventSeq, replayMissedEvents } from '@/api/runEventReplay';
import { useConnectionStore } from '@/stores/connectionStore';
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
  HUB_EVENTS.MESSAGE_EDITED,
  HUB_EVENTS.MESSAGE_RECALL,
  HUB_EVENTS.MESSAGE_PIN,
  HUB_EVENTS.MESSAGE_UNPIN,
  HUB_EVENTS.MESSAGE_REACTION_ADDED,
  HUB_EVENTS.MESSAGE_REACTION_REMOVED,
  HUB_EVENTS.MESSAGE_READ,
]);

const AGENT_EVENTS = new Set<string>([
  HUB_EVENTS.AGENT_DISPATCH,
  HUB_EVENTS.AGENT_STREAM,
  HUB_EVENTS.AGENT_DONE,
  HUB_EVENTS.AGENT_FAILED,
  HUB_EVENTS.AGENT_CANCEL,
  HUB_EVENTS.AGENT_CONTROL,
  HUB_EVENTS.AGENT_REGENERATE,
]);

const DEVICE_EVENTS = new Set<string>([
  HUB_EVENTS.DEVICE_ONLINE,
  HUB_EVENTS.DEVICE_OFFLINE,
  HUB_EVENTS.DEVICE_KICKED,
]);

const CONTACT_EVENTS = new Set<string>([
  HUB_EVENTS.FRIEND_REQUEST,
  HUB_EVENTS.FRIEND_ACCEPTED,
]);

const NOTIFICATION_EVENTS = new Set<string>([
  HUB_EVENTS.NOTIFICATION_NEW,
]);

const TEAM_EVENTS = new Set<string>([
  HUB_EVENTS.TEAM_RUN_STARTED,
  HUB_EVENTS.TEAM_EVENT,
  HUB_EVENTS.TEAM_ASSIGNMENT_DONE,
  HUB_EVENTS.TEAM_ASSIGNMENT_FAILED,
]);

const PLAN_EVENTS = new Set<string>([
  HUB_EVENTS.PLAN_PROPOSED,
  HUB_EVENTS.PLAN_APPROVED,
  HUB_EVENTS.PLAN_REJECTED,
  HUB_EVENTS.PLAN_EXPIRED,
]);

export interface WebHubRealtimeOptions {
  enabled: boolean;
  runtimeSessionId?: string | null;
  runtimeTaskId?: string | null;
  onRuntimeEvent?: (event: HubRuntimeEventTranscriptInput) => void;
  /** Callback invoked with replayed events after a WS reconnect gap fill. */
  onReplayEvents?: (events: HubRuntimeEventTranscriptInput[], taskId: string) => void;
  createSocket?: CreateHubWS;
  getToken?: () => string | null;
}

export function useWebHubRealtime({
  enabled,
  runtimeSessionId,
  runtimeTaskId,
  onRuntimeEvent,
  onReplayEvents,
  createSocket = createHubWS,
  getToken = getAccessToken,
}: WebHubRealtimeOptions): void {
  const queryClient = useQueryClient();
  const runtimeSessionIdRef = useRef(runtimeSessionId);
  const runtimeTaskIdRef = useRef(runtimeTaskId);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onReplayEventsRef = useRef(onReplayEvents);

  useEffect(() => {
    runtimeSessionIdRef.current = runtimeSessionId;
    runtimeTaskIdRef.current = runtimeTaskId;
    onRuntimeEventRef.current = onRuntimeEvent;
    onReplayEventsRef.current = onReplayEvents;
  }, [onRuntimeEvent, onReplayEvents, runtimeSessionId, runtimeTaskId]);

  useEffect(() => {
    if (!enabled) return undefined;

    let replaying = false;
    const hubClient = createHubClient({ getToken });

    const socket = createSocket({
      getToken,
      onAuthSuccess: () => {
        // After (re)connect auth, attempt replay for the active task.
        if (replaying) return;
        replaying = true;
        const store = useConnectionStore.getState();
        // Only replay if we have previously tracked seq ids (i.e. this is a reconnect).
        const taskId = runtimeTaskIdRef.current;
        if (!taskId || store.lastEventSeq[taskId] == null) {
          replaying = false;
          return;
        }
        store.setReconnecting(false);
        void replayMissedEvents({
          socket,
          hubClient,
          getActiveTaskId: () => runtimeTaskIdRef.current ?? undefined,
          onReplayEvents: (events, tid) => {
            onReplayEventsRef.current?.(events, tid);
            replaying = false;
          },
        }).catch(() => { replaying = false; });
      },
    });
    const unsubscribe = socket.onAny((type, payload) => {
      invalidateWebWorkbenchHubQueries(queryClient, type, payload);
      dispatchHubRuntimeEvent(
        type,
        payload,
        runtimeSessionIdRef.current,
        onRuntimeEventRef.current,
        runtimeTaskIdRef.current,
      );
      // Track seq_id from agent events for replay cursor.
      if (AGENT_EVENTS.has(type)) {
        trackSeqFromPayload(payload);
        getAgentActivityStore().handleEvent(type, payload);
      }
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
  runtimeTaskId?: string | null,
): void {
  if (!onRuntimeEvent || !runtimeSessionId) return;

  const parsed = eventType === HUB_EVENTS.AGENT_STREAM
    ? hubRuntimeEventFromPayload(payload)
    : hubTerminalRuntimeEventFromPayload(eventType, payload, runtimeSessionId, runtimeTaskId);
  const event = attachRuntimeSession(parsed, runtimeSessionId, runtimeTaskId);
  if (!event || event.session_id !== runtimeSessionId) return;
  onRuntimeEvent(event);
}

export function invalidateWebWorkbenchHubQueries(
  queryClient: QueryClient,
  eventType: string,
  payload: unknown,
): void {
  // ── Session-scoped events (sessions + messages + agents) ──
  const touchesSessions =
    SESSION_EVENTS.has(eventType) ||
    MESSAGE_EVENTS.has(eventType) ||
    AGENT_EVENTS.has(eventType);

  if (touchesSessions) {
    if (AGENT_EVENTS.has(eventType)) {
      recordRealtimeAgentTaskIndex(queryClient, eventType, payload);
    }

    void queryClient.invalidateQueries({ queryKey: ['web-v4', 'hub-sessions'] });

    if (MESSAGE_EVENTS.has(eventType) || AGENT_EVENTS.has(eventType)) {
      const sessionId = readSessionId(payload);
      void queryClient.invalidateQueries({
        queryKey: sessionId
          ? ['web-v4', 'hub-messages', sessionId]
          : ['web-v4', 'hub-messages'],
      });
    }
  }

  // ── Device events ──────────────────────────────
  if (DEVICE_EVENTS.has(eventType)) {
    void queryClient.invalidateQueries({ queryKey: ['web-v4', 'execution-targets'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'execution-targets'] });
  }

  // ── Contact events ─────────────────────────────
  if (CONTACT_EVENTS.has(eventType)) {
    void queryClient.invalidateQueries({ queryKey: ['web-v4', 'contacts'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'contacts'] });
  }

  // ── Notification events ────────────────────────
  if (NOTIFICATION_EVENTS.has(eventType)) {
    void queryClient.invalidateQueries({ queryKey: ['web-v4', 'notifications'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'notifications'] });
  }

  // ── Team events ────────────────────────────────
  if (TEAM_EVENTS.has(eventType)) {
    const teamId = readString(payload, 'team_id', 'teamId');
    const teamRunId = readString(payload, 'team_run_id', 'teamRunId', 'run_id', 'runId');
    if (teamId && teamRunId) {
      void queryClient.invalidateQueries({
        queryKey: ['web-v4', 'agent-teams', teamId, 'runs', teamRunId],
      });
      void queryClient.invalidateQueries({
        queryKey: ['hub', 'agent-teams', teamId, 'runs', teamRunId],
      });
    }
    if (teamId) {
      void queryClient.invalidateQueries({
        queryKey: ['web-v4', 'agent-teams', teamId, 'runs'],
      });
      void queryClient.invalidateQueries({ queryKey: ['hub', 'agent-teams', teamId, 'runs'] });
    }
    void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-teams'] });
    void queryClient.invalidateQueries({ queryKey: ['hub', 'agent-teams'] });
  }

  // ── Plan events ────────────────────────────────
  if (PLAN_EVENTS.has(eventType)) {
    const runId = readString(payload, 'run_id', 'runId');
    const taskId = readString(payload, 'task_id', 'taskId');
    if (taskId) {
      void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-events', taskId] });
    }
  }
}

function recordRealtimeAgentTaskIndex(
  queryClient: QueryClient,
  eventType: string,
  payload: unknown,
): void {
  const taskId = readString(payload, 'task_id', 'taskId');
  if (!taskId) return;
  const task = {
    taskId,
    ...(readSessionId(payload) ? { sessionId: readSessionId(payload) } : {}),
    ...(readString(payload, 'edge_run_id', 'edgeRunId', 'run_id', 'runId') ? {
      edgeRunId: readString(payload, 'edge_run_id', 'edgeRunId', 'run_id', 'runId'),
    } : {}),
    status: realtimeTaskStatus(eventType),
  };

  queryClient.setQueryData(['web-v4', 'agent-task-index', taskId], task);
  if (task.sessionId) {
    queryClient.setQueryData(['web-v4', 'active-agent-task', task.sessionId], task);
  }
  void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-events', taskId] });
  void queryClient.invalidateQueries({ queryKey: ['web-v4', 'agent-task-summary', taskId] });
}

function realtimeTaskStatus(eventType: string): string {
  switch (eventType) {
    case HUB_EVENTS.AGENT_DONE:
      return 'completed';
    case HUB_EVENTS.AGENT_FAILED:
      return 'failed';
    case HUB_EVENTS.AGENT_CANCEL:
      return 'cancelled';
    case HUB_EVENTS.AGENT_CONTROL:
      return 'awaiting_approval';
    default:
      return 'running';
  }
}

function hubTerminalRuntimeEventFromPayload(
  eventType: string,
  payload: unknown,
  runtimeSessionId: string,
  runtimeTaskId: string | null | undefined,
): HubRuntimeEventTranscriptInput | null {
  const taskId = readString(payload, 'task_id', 'taskId');
  const sessionId = readSessionId(payload) ?? (taskId === runtimeTaskId ? runtimeSessionId : undefined);
  if (!taskId || !sessionId) return null;
  const edgeRunId = readString(payload, 'edge_run_id', 'edgeRunId', 'run_id', 'runId');
  const createdAt = readString(payload, 'created_at', 'createdAt');

  if (eventType === HUB_EVENTS.AGENT_DONE) {
    const content = readString(payload, 'result_summary', 'final_content', 'content') ?? 'Agent task completed.';
    return compactRuntimeEvent({
      task_id: taskId,
      ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
      session_id: sessionId,
      event_type: 'run.agent.result',
      payload: {
        content,
        success: true,
        ...(readPayloadValue(payload, 'usage') ? { usage: readPayloadValue(payload, 'usage') } : {}),
      },
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }

  if (eventType === HUB_EVENTS.AGENT_FAILED) {
    const error = readString(payload, 'error', 'error_message', 'reason') ?? 'Agent task failed.';
    return compactRuntimeEvent({
      task_id: taskId,
      ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
      session_id: sessionId,
      event_type: 'run.failed',
      payload: { error, success: false },
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }

  if (eventType === HUB_EVENTS.AGENT_CANCEL) {
    const reason = readString(payload, 'reason', 'error', 'error_message') ?? 'Agent task cancelled.';
    return compactRuntimeEvent({
      task_id: taskId,
      ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
      session_id: sessionId,
      event_type: 'run.cancelled',
      payload: { error: reason, success: false },
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }

  if (eventType === HUB_EVENTS.AGENT_CONTROL) {
    const kind = readString(payload, 'kind');
    return compactRuntimeEvent({
      task_id: taskId,
      ...(edgeRunId ? { edge_run_id: edgeRunId } : {}),
      session_id: sessionId,
      event_type: 'run.agent.permission_requested',
      payload: {
        kind,
        edge_control: readPayloadValue(payload, 'edge_control'),
        edgeControl: readPayloadValue(payload, 'edgeControl'),
      },
      ...(createdAt ? { created_at: createdAt } : {}),
    });
  }

  return null;
}

function attachRuntimeSession(
  event: HubRuntimeEventTranscriptInput | null,
  runtimeSessionId: string,
  runtimeTaskId: string | null | undefined,
): HubRuntimeEventTranscriptInput | null {
  if (!event) return null;
  if (event.session_id || !runtimeTaskId || event.task_id !== runtimeTaskId) return event;
  return { ...event, session_id: runtimeSessionId };
}

function compactRuntimeEvent(event: HubRuntimeEventTranscriptInput): HubRuntimeEventTranscriptInput {
  return {
    ...(event.id ? { id: event.id } : {}),
    ...(event.task_id ? { task_id: event.task_id } : {}),
    ...(event.edge_run_id ? { edge_run_id: event.edge_run_id } : {}),
    ...(event.session_id ? { session_id: event.session_id } : {}),
    ...(event.agent_instance_id ? { agent_instance_id: event.agent_instance_id } : {}),
    ...(event.event_seq != null ? { event_seq: event.event_seq } : {}),
    ...(event.event_type ? { event_type: event.event_type } : {}),
    ...(event.payload !== undefined ? { payload: event.payload } : {}),
    ...(event.created_at ? { created_at: event.created_at } : {}),
  };
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

function readString(payload: unknown, ...keys: string[]): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  const record = payload as HubPayload;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readPayloadValue(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined;
  return (payload as HubPayload)[key];
}

/**
 * Extract task_id and event_seq from an agent WS event payload
 * and update the replay cursor in the connection store.
 */
function trackSeqFromPayload(payload: unknown): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  const record = payload as HubPayload;
  const taskId = typeof record.task_id === 'string' ? record.task_id : undefined;
  const eventSeq = typeof record.event_seq === 'number' ? record.event_seq : undefined;
  if (taskId && eventSeq != null) {
    trackEventSeq(taskId, eventSeq);
  }
}
