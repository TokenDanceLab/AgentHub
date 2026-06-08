import { useEffect, useMemo } from 'react';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { createHubClient } from '@/api/hubClient';
import { getEdgeBaseUrl } from '@/config';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';

function DesktopHubTaskBridgeActive() {
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const edgeBaseUrl = useMemo(() => getEdgeBaseUrl(), []);
  const hubRealtime = useHubEventStream(getAccessToken);
  useHubIntegration({ hubWS: hubRealtime.hubWS, hubClient, edgeBaseUrl });
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
