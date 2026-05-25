import { useEffect, useRef, useState } from 'react';
import { createHubWS, type HubWSHandle } from '@/api/hubWS';
import type { TransportStatus } from '@/api/transport';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { useConnectionStore } from '@/stores/connectionStore';
import { useToastStore } from '@/stores/toastStore';

interface HubWSConnectionState {
  hubWS: HubWSHandle | null;
  status: TransportStatus;
  authenticated: boolean;
}

export function useHubWSConnection(): HubWSConnectionState {
  const auth = useAuth();
  const setConnected = useConnectionStore((s) => s.setConnected);
  const setError = useConnectionStore((s) => s.setError);
  const addToast = useToastStore((s) => s.addToast);
  const [hubWS, setHubWS] = useState<HubWSHandle | null>(null);
  const [status, setStatus] = useState<TransportStatus>('disconnected');
  const [authenticated, setAuthenticated] = useState(false);
  const authFailToastRef = useRef(false);

  useEffect(() => {
    void auth.tryAutoLogin().catch((error) => {
      addToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to complete Hub login',
      });
    });
  }, [addToast, auth.tryAutoLogin]);

  useEffect(() => {
    const token = auth.token;
    if (!auth.isAuthenticated || !token) {
      setHubWS((current) => {
        current?.close();
        return null;
      });
      setStatus('disconnected');
      setAuthenticated(false);
      setConnected(false);
      return;
    }

    const ws = createHubWS({
      getToken: getAccessToken,
      onAuthSuccess: () => {
        authFailToastRef.current = false;
        setAuthenticated(true);
        setConnected(true);
        setError(null);
      },
      onAuthFail: (reason) => {
        setAuthenticated(false);
        setConnected(false);
        setError(`Hub WebSocket auth failed: ${reason}`);
        if (!authFailToastRef.current) {
          authFailToastRef.current = true;
          addToast({ type: 'error', message: `Hub realtime auth failed: ${reason}` });
        }
      },
    });

    const unsubscribeStatus = ws.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus !== 'connected') {
        setAuthenticated(false);
        setConnected(false);
      }
    });

    setHubWS(ws);
    ws.connect();

    return () => {
      unsubscribeStatus();
      ws.close();
      setHubWS((current) => (current === ws ? null : current));
      setAuthenticated(false);
      setConnected(false);
    };
  }, [addToast, auth.isAuthenticated, auth.token, setConnected, setError]);

  return { hubWS, status, authenticated };
}
