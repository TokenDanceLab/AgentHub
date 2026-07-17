// Edge REST helpers used by the Hub↔Edge integration bridge.
// Isolated from React so permission/thread helpers stay unit-testable.

import { edgeAuthHeaders } from '@/api/edgeAuth';
import type { EdgePermissionDecisionControl } from './hubIntegrationMappers';

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
