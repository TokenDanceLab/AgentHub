import { useEffect, useMemo } from 'react';
import { queryClient } from '@/api/queryClient';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { createHubClient } from '@/api/hubClient';
import { findRegisteredLocalEdgeTarget, useHubExecutionTargets } from '@/api/executionTargetQueries';
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
  const hubTargets = useHubExecutionTargets({ enabled: deviceReady });
  const registeredLocalEdgeTarget = useMemo(
    () => findRegisteredLocalEdgeTarget(hubTargets.data?.items ?? [], deviceRegistration.deviceId),
    [deviceRegistration.deviceId, hubTargets.data?.items],
  );
  const dispatchTarget = useMemo(() => {
    if (!deviceRegistration.deviceId || !registeredLocalEdgeTarget) return null;
    if (!registeredLocalEdgeTarget.is_online || registeredLocalEdgeTarget.health_state !== 'healthy') {
      return null;
    }
    return {
      targetId: registeredLocalEdgeTarget.id,
      deviceId: deviceRegistration.deviceId,
    };
  }, [deviceRegistration.deviceId, registeredLocalEdgeTarget]);

  useEffect(() => {
    if (!deviceReady) return;
    void queryClient.invalidateQueries({ queryKey: ['execution-targets'] });
  }, [deviceReady, deviceRegistration.deviceId]);

  useHubIntegration({
    hubWS: deviceReady && dispatchTarget ? hubRealtime.hubWS : null,
    hubClient,
    edgeBaseUrl,
    dispatchTarget,
  });
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
