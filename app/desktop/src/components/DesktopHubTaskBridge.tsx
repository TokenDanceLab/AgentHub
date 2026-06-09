import { useEffect, useMemo, useRef } from 'react';
import { queryClient } from '@/api/queryClient';
import { getAccessToken, useAuth } from '@/hooks/useAuth';
import { createHubClient } from '@/api/hubClient';
import {
  findRegisteredLocalEdgeTarget,
  useHubExecutionTargets,
  useSyncLocalEdgeExecutionTarget,
} from '@/api/executionTargetQueries';
import { useAgentList } from '@/api/agentQueries';
import { getEdgeBaseUrl } from '@/config';
import { useDeviceRegistration } from '@/hooks/useDeviceRegistration';
import { useHubEventStream } from '@/hooks/useHubEventStream';
import { useHubIntegration } from '@/hooks/useHubIntegration';
import { useHealth } from '@/hooks/useHealth';
import { useModelCatalog } from '@/api/modelCatalogQueries';
import { mapLocalEdgeExecutionTarget, resolveDesktopEdgeDispatchReadiness } from '@/platform/edgeCapabilityMapper';

function DesktopHubTaskBridgeActive() {
  const hubClient = useMemo(() => createHubClient({ getToken: getAccessToken }), []);
  const edgeBaseUrl = useMemo(() => getEdgeBaseUrl(), []);
  const hubRealtime = useHubEventStream(getAccessToken);
  const deviceRegistration = useDeviceRegistration(hubClient);
  const deviceReady = deviceRegistration.status === 'registered';
  const { online: edgeOnline, health } = useHealth();
  const { data: agentData } = useAgentList(edgeOnline);
  const { data: modelCatalog } = useModelCatalog(edgeOnline);
  const hubTargets = useHubExecutionTargets({ enabled: deviceReady });
  const syncLocalEdgeTarget = useSyncLocalEdgeExecutionTarget();
  const lastAutoSyncKey = useRef<string | null>(null);
  const localEdgeTarget = useMemo(
    () => mapLocalEdgeExecutionTarget({
      edgeOnline,
      healthStatus: edgeOnline ? (health?.status ?? 'unknown') : 'offline',
      runners: health?.checks?.runners?.items ?? [],
      agents: agentData?.items ?? [],
      modelCatalog,
    }),
    [agentData?.items, edgeOnline, health?.checks?.runners?.items, health?.status, modelCatalog],
  );
  const registeredLocalEdgeTarget = useMemo(
    () => findRegisteredLocalEdgeTarget(hubTargets.data?.items ?? [], deviceRegistration.deviceId),
    [deviceRegistration.deviceId, hubTargets.data?.items],
  );
  const dispatchReadiness = useMemo(
    () => resolveDesktopEdgeDispatchReadiness({
      hubSessionActive: true,
      deviceId: deviceReady ? deviceRegistration.deviceId : null,
      edgeOnline,
      localEdgeTarget,
      registeredLocalEdgeTarget,
      hubTargetsLoading: hubTargets.isLoading,
      hubTargetsError: hubTargets.isError,
      hubTargetsPaginationLimited: hubTargets.data?.page.hasMore === true,
    }),
    [
      deviceRegistration.deviceId,
      deviceReady,
      edgeOnline,
      hubTargets.data?.page.hasMore,
      hubTargets.isError,
      hubTargets.isLoading,
      localEdgeTarget,
      registeredLocalEdgeTarget,
    ],
  );

  useEffect(() => {
    if (!deviceReady) return;
    void queryClient.invalidateQueries({ queryKey: ['execution-targets'] });
  }, [deviceReady, deviceRegistration.deviceId]);

  useEffect(() => {
    if (!deviceReady || !deviceRegistration.deviceId || !edgeOnline) return;
    if (hubTargets.isLoading || hubTargets.isError || hubTargets.data?.page.hasMore) return;
    if (syncLocalEdgeTarget.isPending) return;
    if (registeredLocalEdgeTarget?.is_online && registeredLocalEdgeTarget.health_state === 'healthy') {
      lastAutoSyncKey.current = null;
      return;
    }

    const autoSyncKey = [
      deviceRegistration.deviceId,
      registeredLocalEdgeTarget?.id ?? 'missing',
      registeredLocalEdgeTarget?.is_online ? 'online' : 'offline',
      registeredLocalEdgeTarget?.health_state ?? 'unknown',
      localEdgeTarget.status,
    ].join(':');
    if (lastAutoSyncKey.current === autoSyncKey) return;
    lastAutoSyncKey.current = autoSyncKey;

    void syncLocalEdgeTarget.mutateAsync({
      deviceId: deviceRegistration.deviceId,
      localEdgeTarget,
      ...(registeredLocalEdgeTarget ? { registeredTargetId: registeredLocalEdgeTarget.id } : {}),
    });
  }, [
    deviceReady,
    deviceRegistration.deviceId,
    edgeOnline,
    hubTargets.data?.page.hasMore,
    hubTargets.isError,
    hubTargets.isLoading,
    localEdgeTarget,
    registeredLocalEdgeTarget,
    syncLocalEdgeTarget,
  ]);

  useHubIntegration({
    hubWS: deviceReady && dispatchReadiness.dispatchReady ? hubRealtime.hubWS : null,
    hubClient,
    edgeBaseUrl,
    dispatchTarget: dispatchReadiness.dispatchTarget,
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
