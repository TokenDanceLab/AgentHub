import { useEffect, useState } from 'react';
import {
  createHubClient,
  type HubMessage,
  type HubSession,
} from '@shared/index';
import { getHubBaseUrl } from './useHubSession';

type HubIMSnapshotStatus = 'locked' | 'loading' | 'ready' | 'error';

export type HubIMSnapshot = {
  error?: string;
  messagesBySessionId: Record<string, HubMessage[]>;
  sessions: HubSession[];
  status: HubIMSnapshotStatus;
};

const emptyMessagesBySessionId: Record<string, HubMessage[]> = {};

function formatHubError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || 'Hub IM snapshot unavailable');
}

function getSessionId(session: HubSession): string {
  return session.session_id || session.id || '';
}

export function useHubIMSnapshot(token: string | null): HubIMSnapshot {
  const [snapshot, setSnapshot] = useState<HubIMSnapshot>({
    messagesBySessionId: emptyMessagesBySessionId,
    sessions: [],
    status: token ? 'loading' : 'locked',
  });

  useEffect(() => {
    if (!token) {
      setSnapshot({
        messagesBySessionId: emptyMessagesBySessionId,
        sessions: [],
        status: 'locked',
      });
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 3500);
    let cancelled = false;

    const client = createHubClient({
      baseUrl: getHubBaseUrl(),
      fetch: (input, init) => fetch(input, { ...init, signal: controller.signal }),
      getToken: () => token,
    });

    setSnapshot((current) => {
      const { error: _error, ...rest } = current;
      return {
        ...rest,
        messagesBySessionId: emptyMessagesBySessionId,
        sessions: [],
        status: 'loading',
      };
    });

    async function loadSnapshot() {
      try {
        const sessions = (await client.listSessions()).filter(
          (session) => session.type === 'private',
        );
        const messageEntries = await Promise.all(
          sessions.map(async (session) => {
            const sessionId = getSessionId(session);
            if (!sessionId) return ['', []] as const;
            const messages = await client.getMessages(sessionId, { limit: 20 });
            return [sessionId, messages] as const;
          }),
        );

        if (cancelled) return;

        setSnapshot({
          messagesBySessionId: Object.fromEntries(
            messageEntries.filter(([sessionId]) => Boolean(sessionId)),
          ),
          sessions,
          status: 'ready',
        });
      } catch (error) {
        if (cancelled) return;

        setSnapshot({
          error: controller.signal.aborted
            ? 'Hub IM snapshot timed out'
            : formatHubError(error),
          messagesBySessionId: emptyMessagesBySessionId,
          sessions: [],
          status: 'error',
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    }

    void loadSnapshot();

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [token]);

  return snapshot;
}
