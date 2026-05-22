import { useCallback, useEffect, useRef, useState } from 'react';
import { EVENT_LOG_MAX } from '@/config';
import { createEventStream } from '@/api/eventClient';
import { createWorkbenchState, reduceWorkbenchEvent, type WorkbenchState } from '@/state/workbenchState';

export interface WorkbenchEventsState {
  connected: boolean;
  state: WorkbenchState;
  clearEvents(): void;
}

export function useWorkbenchEvents(online: boolean): WorkbenchEventsState {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<WorkbenchState>(() => createWorkbenchState());
  const mountedRef = useRef(true);

  const clearEvents = useCallback(() => {
    setState(createWorkbenchState());
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!online) {
      setConnected(false);
      return;
    }

    const stream = createEventStream({ cursor: state.lastSeq || undefined });
    const unsubscribeStatus = stream.onStatusChange((nextConnected) => {
      if (mountedRef.current) setConnected(nextConnected);
    });
    const unsubscribeEvents = stream.subscribe((event) => {
      if (!mountedRef.current) return;
      setState((previous) => {
        const reduced = reduceWorkbenchEvent(previous, event);
        if (reduced.events.length <= EVENT_LOG_MAX) return reduced;
        return {
          ...reduced,
          events: reduced.events.slice(-EVENT_LOG_MAX),
        };
      });
    });

    return () => {
      mountedRef.current = false;
      unsubscribeStatus();
      unsubscribeEvents();
      stream.close();
    };
    // The stream owns cursor replay internally after this initial subscription.
    // Re-subscribing on every seq would create unnecessary sockets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  return { connected, state, clearEvents };
}
