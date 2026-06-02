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
  /** Whether a reconnection was just completed (transient, resets after one read). */
  justReconnected: boolean;
}

export function useHubWSConnection(): HubWSConnectionState {
  const auth = useAuth();
  const setConnected = useConnectionStore((s) => s.setConnected);
  const setError = useConnectionStore((s) => s.setError);
  const setReconnecting = useConnectionStore((s) => s.setReconnecting);
  const addToast = useToastStore((s) => s.addToast);
  const [hubWS, setHubWS] = useState<HubWSHandle | null>(null);
  const [status, setStatus] = useState<TransportStatus>('disconnected');
  const [authenticated, setAuthenticated] = useState(false);
  const [justReconnected, setJustReconnected] = useState(false);
  const authFailToastRef = useRef(false);
  const prevStatusRef = useRef<TransportStatus>('disconnected');

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
      setReconnecting(false);
      return;
    }

    const ws = createHubWS({
      getToken: getAccessToken,
      onAuthSuccess: () => {
        authFailToastRef.current = false;
        setAuthenticated(true);
        setConnected(true);
        setError(null);
        setReconnecting(false);
        // Detect reconnection: went through reconnecting or disconnected state
        if (prevStatusRef.current === 'reconnecting' || prevStatusRef.current === 'disconnected') {
          setJustReconnected(true);
        }
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
      prevStatusRef.current = status;
      setStatus(nextStatus);
      setReconnecting(nextStatus === 'reconnecting');
      if (nextStatus !== 'connected') {
        setAuthenticated(false);
        setConnected(false);
      }
      // Reset justReconnected flag after disconnection / reconnection cycle starts
      if (nextStatus === 'disconnected' || nextStatus === 'connecting') {
        setJustReconnected(false);
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
      setReconnecting(false);
    };
  }, [addToast, auth.isAuthenticated, auth.token, setConnected, setError, setReconnecting]);

  return { hubWS, status, authenticated, justReconnected };
}
