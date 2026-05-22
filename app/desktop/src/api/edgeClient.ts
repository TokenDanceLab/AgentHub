// Edge REST API client — typed wrappers around fetch.
// Uses @agenthub/shared for all response types and error handling.

import { EDGE_URL } from '@/config';
import type { HealthResponse, Runner, ListResponse, RunInfo } from '@shared/types';
import { parseError } from '@shared/errors';

export type { HealthResponse, Runner, ListResponse, RunInfo };

const BASE = EDGE_URL.replace(/\/+$/, '');

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/v1/health`);
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await fetch(`${BASE}/v1/runners`);
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function startRun(): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs`, { method: 'POST' });
  if (!res.ok) throw await parseError(res);
  return res.json();
}

export async function cancelRun(runId: string): Promise<RunInfo> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}:cancel`, { method: 'POST' });
  if (!res.ok) throw await parseError(res);
  return res.json();
}
