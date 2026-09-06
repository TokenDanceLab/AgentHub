// Edge REST helpers used by the Hub↔Edge integration bridge.
// Isolated from React so permission/thread helpers stay unit-testable.

import { edgeAuthHeaders } from '@/api/edgeAuth';
import type { EdgePermissionDecisionControl } from './hubIntegrationMappers';
import { parseRecord } from './hubIntegrationParseHelpers';

export function edgeRequestInit(init: RequestInit = {}, baseHeaders?: HeadersInit): RequestInit {
  const headers = edgeAuthHeaders(baseHeaders);
  return headers ? { ...init, headers } : init;
}

export async function postEdgePermissionDecision(
  edgeBaseUrl: string,
  control: EdgePermissionDecisionControl,
): Promise<void> {
  const resp = await fetch(
    `${edgeBaseUrl}/v1/permissions/decide`,
    edgeRequestInit(
      {
        method: 'POST',
        body: JSON.stringify(control),
      },
      { 'Content-Type': 'application/json' },
    ),
  );
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Edge POST /v1/permissions/decide returned ${resp.status}: ${errorText}`);
  }
}

export async function ensureEdgeThread(
  edgeBaseUrl: string,
  threadId: string,
  title: string,
): Promise<void> {
  const resp = await fetch(
    `${edgeBaseUrl}/v1/threads`,
    edgeRequestInit(
      {
        method: 'POST',
        body: JSON.stringify({
          projectId: 'proj_local',
          threadId,
          title,
        }),
      },
      { 'Content-Type': 'application/json' },
    ),
  );
  if (!resp.ok) {
    const errorText = await resp.text().catch(() => 'Unknown error');
    throw new Error(`Edge POST /v1/threads returned ${resp.status}: ${errorText}`);
  }
}

export interface EdgeRunCallbackCapabilityProbe {
  supported: boolean;
  reason?: string;
}

/**
 * Fail-closed capability gate for Desktop-managed callback ownership.
 * Only a new Edge that explicitly publishes runCallbackOwnership=true is
 * allowed to receive a Hub dispatch; unknown, missing, false, or failed
 * health probes are treated as unusable for this route.
 */
export async function probeEdgeRunCallbackOwnership(
  edgeBaseUrl: string,
): Promise<EdgeRunCallbackCapabilityProbe> {
  let response: Response;
  try {
    response = await fetch(`${edgeBaseUrl.replace(/\/$/, '')}/v1/health`);
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  if (!response.ok) {
    return {
      supported: false,
      reason: `Edge /v1/health returned ${response.status}`,
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch (error) {
    return {
      supported: false,
      reason: error instanceof Error ? error.message : 'Edge /v1/health returned non-JSON',
    };
  }

  const root = parseRecord(raw);
  const health = parseRecord(root.data);
  const source = Object.keys(health).length > 0 ? health : root;
  const capabilities = parseRecord(source.capabilities);
  if (capabilities.runCallbackOwnership !== true) {
    return {
      supported: false,
      reason: 'Edge /v1/health does not publish runCallbackOwnership=true',
    };
  }
  return { supported: true };
}
