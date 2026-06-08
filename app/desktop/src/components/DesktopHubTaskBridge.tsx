import { useEffect, useMemo } from 'react';
import { queryClient } from '@/api/queryClient';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { createHubClient } from '@/api/hubClient';
import { getEdgeBaseUrl } from '@/config';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';

function DesktopHubTaskBridgeActive() {
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const edgeBaseUrl = useMemo(() => getEdgeBaseUrl(), []);
  const hubRealtime = useHubEventStream(getAccessToken);
  const deviceRegistration = useDeviceRegistration(hubClient);
  const deviceReady = deviceRegistration.status === 'registered';

  useEffect(() => {
    if (!deviceReady) return;
    void queryClient.invalidateQueries({ queryKey: ['execution-targets'] });
  }, [deviceReady, deviceRegistration.deviceId]);

  useHubIntegration({ hubWS: deviceReady ? hubRealtime.hubWS : null, hubClient, edgeBaseUrl });
  return null;
}

export default function DesktopHubTaskBridge() {
  const hubAuth = useAuth();

  useEffect(() => {
    if (!hubAuth.isAuthenticated && !hubAuth.token) {
      void hubAuth.tryAutoLogin();
    }
  }, [hubAuth.isAuthenticated, hubAuth.token, hubAuth.tryAutoLogin]);

  if (!hubAuth.isAuthenticated || !hubAuth.token) {
    return null;
  }

  return <DesktopHubTaskBridgeActive />;
}
