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
import { useConnectionStore } from '@/stores/connectionStore';
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
  // Product runtime inventory: agents + models + Edge health.
  // health.checks.runners stays Edge diagnostics and is intentionally not mapped.
  const localEdgeTarget = useMemo(
    () => mapLocalEdgeExecutionTarget({
      edgeOnline,
      healthStatus: edgeOnline ? (health?.status ?? 'unknown') : 'offline',
      agents: agentData?.items ?? [],
      modelCatalog,
    }),
    [agentData?.items, edgeOnline, health?.status, modelCatalog],
  );
  const registeredLocalEdgeTarget = useMemo(
    () => findRegisteredLocalEdgeTarget(hubTargets.data?.items ?? [], deviceRegistration.deviceId),
    [deviceRegistration.deviceId, hubTargets.data?.items],
  );
  const registeredSnapshot = useMemo(
    () =>
      registeredLocalEdgeTarget
        ? {
            id: String(registeredLocalEdgeTarget.id ?? ''),
            name: registeredLocalEdgeTarget.name,
            device_id: registeredLocalEdgeTarget.device_id ?? null,
            target_type: registeredLocalEdgeTarget.target_type,
            health_state: registeredLocalEdgeTarget.health_state,
            is_online: registeredLocalEdgeTarget.is_online,
          }
        : null,
    [registeredLocalEdgeTarget],
  );
  const dispatchReadiness = useMemo(
    () => resolveDesktopEdgeDispatchReadiness({
      hubSessionActive: true,
      deviceId: deviceReady ? deviceRegistration.deviceId : null,
      edgeOnline,
      localEdgeTarget,
      registeredLocalEdgeTarget: registeredSnapshot,
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
      registeredSnapshot,
    ],
  );

  useEffect(() => {
    if (!deviceReady) return;
    void queryClient.invalidateQueries({ queryKey: ['execution-targets'] });
  }, [deviceReady, deviceRegistration.deviceId]);

  // Mirror live connection health into the connection store so the shell can
  // surface real Edge/Hub status (workbench connection dot, #1816 W1): the
  // Hub WS transport status and the Local Edge health poll are the two
  // desktop-side connection signals.
  const setHubConnectionStatus = useConnectionStore((s) => s.setConnectionStatus);
  const setEdgeHealth = useConnectionStore((s) => s.setOnline);
  useEffect(() => {
    setHubConnectionStatus(hubRealtime.status);
  }, [hubRealtime.status, setHubConnectionStatus]);
  useEffect(() => {
    setEdgeHealth(edgeOnline, health);
  }, [edgeOnline, health, setEdgeHealth]);

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
      ...(registeredLocalEdgeTarget?.id ? { registeredTargetId: String(registeredLocalEdgeTarget.id) } : {}),
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

  /* eslint-disable react-hooks/exhaustive-deps -- useAuth() returns a fresh
     object each render; the granular isAuthenticated/token/tryAutoLogin deps
     below are the stable values the effect actually depends on. */
  useEffect(() => {
    if (!hubAuth.isAuthenticated && !hubAuth.token) {
      void hubAuth.tryAutoLogin();
    }
  }, [hubAuth.isAuthenticated, hubAuth.token, hubAuth.tryAutoLogin]);
  /* eslint-enable react-hooks/exhaustive-deps */

  if (!hubAuth.isAuthenticated || !hubAuth.token) {
    return null;
  }

  return <DesktopHubTaskBridgeActive />;
}
