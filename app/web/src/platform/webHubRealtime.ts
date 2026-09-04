import { useEffect, useRef } from 'react';
import { type QueryClient, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { HUB_EVENTS } from '@shared/hubEvents';
import { hubQueryKeys, webQueryKeys } from '@shared/stores/queryKeys';
import { hubRuntimeEventFromPayload, type HubRuntimeEventTranscriptInput } from '@shared/transcript';
import { getPinMapStore } from '@shared/transcript';
import { getAgentActivityStore } from '@shared/transcript/agentActivity';
import { getMessageDelegationStore, getSubagentStreamStore } from '@agenthub/workbench';
import { handleIncomingTyping } from '@shared/chatview/typingPresence';
import { buildWSAuthProtocols, createHubWS, type HubWSHandle, type HubWSOptions } from '@shared/hub/hubWS';
import { resyncMessagesAfterReconnect } from '@shared/hub/hubMessagesResync';
import { webHubMessagesFamily } from '@/platform/webPlatformMessageHelpers';
import { WebSocketTransport, type Transport, type TransportStatus } from '@/api/transport';
import { HUB_WS_URL } from '@/config';
import { createHubClient } from '@/api/hubClient';
import { trackEventSeq, replayMissedEvents } from '@/api/runEventReplay';
import { isDeviceKickedFrame, respondToDeviceKick } from '@/platform/webDeviceKicked';
import { useConnectionStore } from '@/stores/connectionStore';
import { getAccessToken } from '@/hooks/useAuth';

type HubPayload = Record<string, unknown>;
type CreateHubWS = (opts: HubWSOptions) => HubWSHandle;

/**
 * Transport factory for the Hub socket. The hook observes the transport
 * directly for device.kicked frames (#1816), which the shared hubWS handle
 * swallows before app-level handlers.
 */
type CreateWebRealtimeTransport = (options: {
  url: string;
  getToken: () => string | null;
}) => Transport;

/** Mirrors the transport the shared hubWS builds when none is injected. */
const createDefaultWebRealtimeTransport: CreateWebRealtimeTransport = ({ url, getToken }) =>
  new WebSocketTransport({
    url,
    protocols: () => buildWSAuthProtocols(getToken()),
    maxRetries: 10,
  });

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

const TEAM_EVENTS = new Set<string>([
  HUB_EVENTS.TEAM_RUN_STARTED,
  HUB_EVENTS.TEAM_EVENT,
  HUB_EVENTS.TEAM_ASSIGNMENT_DONE,
  HUB_EVENTS.TEAM_ASSIGNMENT_FAILED,
]);

interface WebHubRealtimeOptions {
  enabled: boolean;
  runtimeSessionId?: string | null;
  runtimeTaskId?: string | null;
  onRuntimeEvent?: (event: HubRuntimeEventTranscriptInput) => void;
  /** Callback invoked with replayed events after a WS reconnect gap fill. */
  onReplayEvents?: (events: HubRuntimeEventTranscriptInput[], taskId: string) => void;
  createSocket?: CreateHubWS;
  /**
   * Transport factory handed to the socket. The hook subscribes to it
   * directly for device.kicked frames before the socket is created (#1816).
   */
  createTransport?: CreateWebRealtimeTransport;
  getToken?: () => string | null;
  /** Test/benchmark override; production uses one display-frame window. */
  liveBatchWindowMs?: number;
}

export function useWebHubRealtime({
  enabled,
  runtimeSessionId,
  runtimeTaskId,
  onRuntimeEvent,
  onReplayEvents,
  createSocket = createHubWS,
  createTransport = createDefaultWebRealtimeTransport,
  getToken = getAccessToken,
  liveBatchWindowMs = AGENT_STREAM_LIVE_BATCH_WINDOW_MS,
}: WebHubRealtimeOptions): void {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const runtimeSessionIdRef = useRef(runtimeSessionId);
  const runtimeTaskIdRef = useRef(runtimeTaskId);
  const onRuntimeEventRef = useRef(onRuntimeEvent);
  const onReplayEventsRef = useRef(onReplayEvents);
  const translateRef = useRef(t);
  const liveBatcherRef = useRef<WebWorkbenchLiveEventBatcher | null>(null);

  useEffect(() => {
    if (
      runtimeSessionIdRef.current !== runtimeSessionId ||
      runtimeTaskIdRef.current !== runtimeTaskId
    ) {
      // Drain the previous conversation before switching the refs used by the
      // async timer callback. Otherwise a trailing frame can cross sessions.
      liveBatcherRef.current?.flush();
    }
    runtimeSessionIdRef.current = runtimeSessionId;
    runtimeTaskIdRef.current = runtimeTaskId;
    onRuntimeEventRef.current = onRuntimeEvent;
    onReplayEventsRef.current = onReplayEvents;
    // Keep the socket effect independent of language switches: the kicked
    // feedback reads the current translator through this ref.
    translateRef.current = t;
  }, [onRuntimeEvent, onReplayEvents, runtimeSessionId, runtimeTaskId, t]);

  useEffect(() => {
    if (!enabled) return undefined;

    let replaying = false;
    const hubClient = createHubClient({ getToken });
    const invalidation = createWebWorkbenchHubInvalidationScheduler(queryClient);

    // #1415: Bound live stream commits to one display-frame window. Every raw
    // event is retained; React batches the callbacks from one timer turn.
    let latestActivityPayload: unknown = null;
    const liveBatcher = createWebWorkbenchLiveEventBatcher((events) => {
      for (const event of events) {
        onRuntimeEventRef.current?.(event);
      }
      const activityPayload = latestActivityPayload;
      latestActivityPayload = null;
      if (activityPayload !== null) {
        getAgentActivityStore().handleEvent(HUB_EVENTS.AGENT_STREAM, activityPayload);
      }
    }, liveBatchWindowMs);
    liveBatcherRef.current = liveBatcher;

    // Build the transport before the socket so the kicked-frame observer is
    // registered first: the shared hubWS closes the transport while handling
    // device.kicked, which clears remaining listeners mid-emit (#1816).
    const transport = createTransport({ url: HUB_WS_URL, getToken });
    const unsubscribeDeviceKicked = transport.on('message', (raw: unknown) => {
      if (isDeviceKickedFrame(raw)) {
        respondToDeviceKick(translateRef.current);
      }
    });

    const socket = createSocket({
      getToken,
      url: HUB_WS_URL,
      transport,
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
      invalidation.notify(type, payload);

      // ── Pin state — feed MESSAGE_PIN / MESSAGE_UNPIN frames into the
      // session-scoped pinMap store (runtime session filter; the existing
      // query invalidation above is kept — refetched payloads still carry
      // no pin field, so the store is the normalize-time source).
      getPinMapStore().handleFrame(type, payload, runtimeSessionIdRef.current);

      // ── Typing indicator — inbound ─────────
      if (type === HUB_EVENTS.TYPING) {
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const rec = payload as Record<string, unknown>;
          const sessionId = typeof rec.session_id === 'string' ? rec.session_id : undefined;
          const userId = typeof rec.user_id === 'string' ? rec.user_id : undefined;
          if (sessionId && userId) {
            handleIncomingTyping(sessionId, userId);
          }
        }
        // Ephemeral frame — no invalidation or runtime event needed.
        return;
      }

      if (type === HUB_EVENTS.AGENT_STREAM) {
        // #1415: Route stream events through the micro-batch queue.
        // Parse and session-filter inline (duplicates the head of
        // dispatchHubRuntimeEvent) so the batcher only sees events
        // that would actually reach the workbench model consumer.
        const parsed = hubRuntimeEventFromPayload(payload);
        const activeSessionId = runtimeSessionIdRef.current;
        const event = activeSessionId
          ? attachRuntimeSession(parsed, activeSessionId, runtimeTaskIdRef.current)
          : null;
        latestActivityPayload = payload;
        if (
          event &&
          onRuntimeEventRef.current &&
          event.session_id === activeSessionId
        ) {
          liveBatcher.push(event);
        } else {
          // Preserve global activity updates even when the stream belongs to a
          // conversation other than the currently visible transcript.
          liveBatcher.push();
        }
      } else if (type === HUB_EVENTS.TEAM_SUBAGENT_STREAM) {
        // #1478 Phase C: route team subagent stream frames into the
        // SubagentStreamStore for team-run view aggregation. No live batch
        // needed — team.subagent.stream has its own idempotency semantics
        // (UPSERT by agent_task_id + event_seq) and is consumed by a store
        // that handles ordering independently from the chat transcript.
        getSubagentStreamStore().push(payload);
      } else {
        // A terminal/session/etc. event stays immediate, but pending stream
        // frames must reach both consumers first to preserve wire ordering.
        liveBatcher.flush();
        dispatchHubRuntimeEvent(
          type,
          payload,
          runtimeSessionIdRef.current,
          onRuntimeEventRef.current,
          runtimeTaskIdRef.current,
        );
      }

      // Track seq_id from agent events for replay cursor.
      if (AGENT_EVENTS.has(type)) {
        trackSeqFromPayload(payload);
        if (type !== HUB_EVENTS.AGENT_STREAM) {
          // Non-stream agent events (dispatch/done/fail/cancel/control)
          // are already handled immediately above; agent activity for
          // AGENT_STREAM is synced once per batch inside the batcher.
          getAgentActivityStore().handleEvent(type, payload);
        }
        // #1406 Phase 3: feed agent.* frames to the message-delegation
        // store so inline delegation cards can subscribe by
        // trigger_message_id. The store no-ops on per-token AGENT_STREAM
        // after the first streaming transition, so direct feed is safe.
        getMessageDelegationStore().handleEvent(type, payload);
      }
    });
    const unsubscribeStatus = socket.onStatus((status: TransportStatus) => {
      // Mirror transport status into the connection store so the shell can
      // show live connection/reconnection state (#1816).
      const connection = useConnectionStore.getState();
      if (status === 'connected') {
        connection.setConnected(true);
        connection.setReconnecting(false);
      } else if (status === 'reconnecting') {
        connection.setConnected(false);
        connection.setReconnecting(true);
      } else {
        connection.setConnected(false);
        connection.setReconnecting(false);
      }
      if (status === 'disconnected') {
        liveBatcher.flush();
      }
    });

    // #2101 G4-②: shared resync trigger for gap and reconnect events.
    // Uses incremental syncMessages(after_seq) per cached session when possible;
    // falls back to full invalidation of the transcript family otherwise.
    // #2252: Web transcripts are cached at `webQueryKeys.messages.of(<id>)`,
    // so the shared helper needs Web's family to discover them at all.
    const hubClientForResync = createHubClient({ getToken });
    const triggerWebResync = (): void => {
      void resyncMessagesAfterReconnect({
        queryClient,
        hubClient: hubClientForResync,
        messageKeys: webHubMessagesFamily,
      }).catch((err) => {
        console.error('[webHubRealtime] resync failed:', err);
      });
    };

    // #2101 G1: seq_id gap → trigger message resync.
    const unsubscribeGap = socket.onGap?.(() => {
      triggerWebResync();
    });

    // #2101 G4-②: reconnect auth completion → trigger message resync.
    const unsubscribeReconnected = socket.onReconnected?.(() => {
      triggerWebResync();
    });

    socket.connect();
    return () => {
      unsubscribe();
      unsubscribeStatus();
      unsubscribeDeviceKicked();
      unsubscribeGap?.();
      unsubscribeReconnected?.();
      liveBatcher.dispose();
      if (liveBatcherRef.current === liveBatcher) {
        liveBatcherRef.current = null;
      }
      invalidation.dispose();
      socket.close();
      // The socket is gone — never leave a stale "connected" flag behind.
      const connection = useConnectionStore.getState();
      connection.setConnected(false);
      connection.setReconnecting(false);
    };
  }, [createSocket, createTransport, enabled, getToken, liveBatchWindowMs, queryClient]);
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

    void queryClient.invalidateQueries({ queryKey: webQueryKeys.sessions.root });

    if (MESSAGE_EVENTS.has(eventType) || AGENT_EVENTS.has(eventType)) {
      const sessionId = readSessionId(payload);
      void queryClient.invalidateQueries({
        queryKey: sessionId
          ? webQueryKeys.messages.of(sessionId)
          : webQueryKeys.messages.root,
      });
    }
  }

  // ── Device events ──────────────────────────────
  if (DEVICE_EVENTS.has(eventType)) {
    // This block used to fire an app-scoped twin of the key below that had no
    // producer: Web caches execution targets only under
    // `hubQueryKeys.executionTargets.list(context)`, so the family root is the
    // one invalidation that can actually match (ADR-029: do not name a key
    // nothing writes).
    void queryClient.invalidateQueries({ queryKey: hubQueryKeys.executionTargets.root });
  }

  // ── Contact events ─────────────────────────────
  if (CONTACT_EVENTS.has(eventType)) {
    // Web's contact LIST is cached at `webQueryKeys.contacts.list(hubReady)`,
    // but this block used to invalidate a hand-written app-scoped key missing
    // the `hub-` segment, so it matched nothing: a friend request accepted in
    // another tab left this one's contact list stale, and that query has no
    // refetchInterval to paper over it. Both roots below are live —
    // `webQueryKeys.contacts.root` covers the list, `hubQueryKeys.contacts.root`
    // covers `useListFriendRequests`.
    void queryClient.invalidateQueries({ queryKey: webQueryKeys.contacts.root });
    void queryClient.invalidateQueries({ queryKey: hubQueryKeys.contacts.root });
  }

  // ── Team events ────────────────────────────────
  if (TEAM_EVENTS.has(eventType)) {
    // Web's only team cache is `hubQueryKeys.agentTeams.usageBoard`, so the
    // family root is the single invalidation that can match. This block used to
    // fire five more run-scoped keys (`agentTeams.runs` / `.runDetail`, each in
    // both namespaces); none of them has a Web query producer, so all five
    // matched no cache entry — the `teamId`/`teamRunId` extraction existed only
    // to build dead keys and is gone with them.
    void queryClient.invalidateQueries({ queryKey: hubQueryKeys.agentTeams.root });
  }
}

/** Trailing coalescing window for per-token AGENT_STREAM invalidation (#1352). */
export const AGENT_STREAM_INVALIDATE_WINDOW_MS = 250;

/** One display-frame window for live transcript commits (#1415). */
export const AGENT_STREAM_LIVE_BATCH_WINDOW_MS = 16;

interface WebWorkbenchHubInvalidationScheduler {
  /** Route one realtime frame: AGENT_STREAM coalesced, everything else immediate. */
  notify: (eventType: string, payload: unknown) => void;
  /** Flush any pending stream invalidation and clear the timer. */
  dispose: () => void;
}

/**
 * Query invalidation scheduler for realtime Hub frames (#1352).
 *
 * AGENT_STREAM frames arrive per token, and each invalidateWebWorkbenchHubQueries
 * call costs ~6 cache operations — api/events.md:47 requires stream output to be
 * batched instead of refreshing the UI per line. Stream frames therefore collapse
 * into one trailing flush per window (the last frame always flushes: via timer,
 * via the next non-stream frame, or via dispose). Non-stream frames invalidate
 * immediately, flushing any pending stream frame first so cache writes keep the
 * original event order (a coalesced `running` task-index write must not land
 * after a terminal AGENT_DONE/FAILED write).
 */
export function createWebWorkbenchHubInvalidationScheduler(
  queryClient: QueryClient,
  windowMs: number = AGENT_STREAM_INVALIDATE_WINDOW_MS,
): WebWorkbenchHubInvalidationScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { eventType: string; payload: unknown } | null = null;

  const flush = (): void => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const frame = pending;
    pending = null;
    if (frame) {
      invalidateWebWorkbenchHubQueries(queryClient, frame.eventType, frame.payload);
    }
  };

  return {
    notify: (eventType, payload) => {
      if (eventType !== HUB_EVENTS.AGENT_STREAM) {
        flush();
        invalidateWebWorkbenchHubQueries(queryClient, eventType, payload);
        return;
      }
      pending = { eventType, payload };
      if (timer == null) {
        timer = setTimeout(flush, windowMs);
      }
    },
    dispose: flush,
  };
}

// ── Live event micro-batch (#1415) ─────────────────────────────────────────

/**
 * Flush callback type for batched live events. Receives every original event
 * so the hook can feed them into the workbench model consumer. Synchronous
 * callbacks from the same timer turn are committed together by React.
 */
type LiveEventFlush = (events: HubRuntimeEventTranscriptInput[]) => void;

interface WebWorkbenchLiveEventBatcher {
  /** Queue one stream event; undefined still schedules an activity-only flush. */
  push: (event?: HubRuntimeEventTranscriptInput) => void;
  /** Flush pending work without disposing the batcher. */
  flush: () => void;
  /** Flush pending work, clear the timer, and reject later pushes. */
  dispose: () => void;
}

/**
 * Live event micro-batch for AGENT_STREAM events dispatched to the workbench
 * model consumer via onRuntimeEvent (#1415). The batcher never merges or drops
 * events: IDs and sequence numbers must remain intact for replay deduplication.
 * React batches all callbacks from one timer turn into one commit.
 */
export function createWebWorkbenchLiveEventBatcher(
  flush: LiveEventFlush,
  windowMs: number = AGENT_STREAM_LIVE_BATCH_WINDOW_MS,
): WebWorkbenchLiveEventBatcher {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: HubRuntimeEventTranscriptInput[] = [];
  let hasPending = false;
  let disposed = false;

  const doFlush = (): void => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
    const batch = pending;
    pending = [];
    if (!hasPending) return;
    hasPending = false;
    flush(batch);
  };

  return {
    push: (event) => {
      if (disposed) return;
      if (event) pending.push(event);
      hasPending = true;
      if (timer == null) {
        timer = setTimeout(doFlush, windowMs);
      }
    },
    flush: doFlush,
    dispose: () => {
      disposed = true;
      doFlush();
    },
  };
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

  queryClient.setQueryData(webQueryKeys.agentTask.index(taskId), task);
  if (task.sessionId) {
    queryClient.setQueryData(webQueryKeys.agentTask.active(task.sessionId), task);
  }
  void queryClient.invalidateQueries({ queryKey: webQueryKeys.agentTask.events(taskId) });
  void queryClient.invalidateQueries({ queryKey: webQueryKeys.agentTask.summary(taskId) });
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
