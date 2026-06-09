import {
  createHubEventStream,
  type CreateHubEventStreamOptions,
  type HubEventStream,
  type HubEventStreamError,
  type HubEventStreamStatus,
} from './hubEvents';
import type { HubWsEvent } from './hubClient';

export type MobileAppStateStatus = 'active' | 'background' | 'inactive' | 'unknown' | 'extension';
export type HubLifecycleStatus = HubEventStreamStatus | 'suspended' | 'resync_required';
export type HubLifecycleResyncReason = 'foreground' | 'stream_closed';

export interface MobileAppStateSubscriptionLike {
  remove: () => void;
}

export interface MobileAppStateLike {
  currentState: MobileAppStateStatus;
  addEventListener: (
    event: 'change',
    listener: (state: MobileAppStateStatus) => void,
  ) => MobileAppStateSubscriptionLike;
}

export interface HubLifecycleResync {
  reason: HubLifecycleResyncReason;
  since?: string;
}

export interface StartHubLifecycleOptions
  extends Pick<CreateHubEventStreamOptions, 'baseUrl' | 'createWebSocket'> {
  appState: MobileAppStateLike;
  token?: string;
  initialSince?: string;
  onEvent?: (event: HubWsEvent) => void;
  onError?: (error: HubEventStreamError) => void;
  onStatusChange?: (status: HubLifecycleStatus) => void;
  onResyncRequired?: (resync: HubLifecycleResync) => void;
}

export interface HubLifecycleBridge {
  stop: () => void;
  getCursor: () => string | undefined;
}

export function startHubLifecycleBridge(options: StartHubLifecycleOptions): HubLifecycleBridge {
  let stopped = false;
  let currentAppState = options.appState.currentState;
  let stream: HubEventStream | undefined;
  let eventCursor = options.initialSince;
  let closingForLifecycle = false;

  const connect = () => {
    if (stopped || stream || !isForeground(currentAppState)) {
      return;
    }

    const streamOptions: CreateHubEventStreamOptions = {
      baseUrl: options.baseUrl,
      createWebSocket: options.createWebSocket,
      ...(options.token ? { token: options.token } : {}),
      ...(eventCursor ? { since: eventCursor } : {}),
      onEvent(event) {
        if (typeof event.seq_id === 'number') {
          eventCursor = String(event.seq_id);
        }
        options.onEvent?.(event);
      },
      onStatusChange(status) {
        options.onStatusChange?.(status);

        if (status === 'closed') {
          stream = undefined;

          if (!stopped && !closingForLifecycle && isForeground(currentAppState)) {
            requireResync('stream_closed');
            connect();
          }
        }
      },
    };

    if (options.onError) {
      streamOptions.onError = options.onError;
    }

    stream = createHubEventStream(streamOptions);
  };

  const suspend = () => {
    if (!stream) {
      options.onStatusChange?.('suspended');
      return;
    }

    closingForLifecycle = true;
    stream.close();
    stream = undefined;
    closingForLifecycle = false;
    options.onStatusChange?.('suspended');
  };

  const requireResync = (reason: HubLifecycleResyncReason) => {
    const resync = {
      reason,
      ...(eventCursor ? { since: eventCursor } : {}),
    };

    options.onStatusChange?.('resync_required');
    options.onResyncRequired?.(resync);
  };

  const subscription = options.appState.addEventListener('change', (nextState) => {
    const wasForeground = isForeground(currentAppState);
    const isNowForeground = isForeground(nextState);
    currentAppState = nextState;

    if (isNowForeground) {
      if (!wasForeground) {
        requireResync('foreground');
      }
      connect();
      return;
    }

    if (wasForeground || stream) {
      suspend();
    }
  });

  if (isForeground(currentAppState)) {
    connect();
  } else {
    options.onStatusChange?.('suspended');
  }

  return {
    stop() {
      if (stopped) {
        return;
      }

      stopped = true;
      subscription.remove();
      closingForLifecycle = true;
      stream?.close();
      stream = undefined;
      closingForLifecycle = false;
    },
    getCursor() {
      return eventCursor;
    },
  };
}

function isForeground(state: MobileAppStateStatus): boolean {
  return state === 'active';
}
