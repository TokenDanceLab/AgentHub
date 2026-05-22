// Edge REST API client — typed wrappers around fetch.

import { EDGE_URL } from '@/config';

const BASE = EDGE_URL.replace(/\/+$/, '');

// ── Types ──────────────────────────────────────────

export interface HealthResponse {
  status: string;
  version: string;
  edgeId: string;
}

export interface Runner {
  id: string;
  name: string;
  status: string;
  capabilities?: string;
}

export interface PageInfo {
  nextCursor?: string;
  hasMore: boolean;
}

export interface ListResponse<T> {
  items: T[];
  page: PageInfo;
}

// ── Functions ──────────────────────────────────────

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${BASE}/v1/health`);
  if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
  return res.json();
}

export async function fetchRunners(): Promise<ListResponse<Runner>> {
  const res = await fetch(`${BASE}/v1/runners`);
  if (!res.ok) throw new Error(`Failed to fetch runners: ${res.status}`);
  return res.json();
}

export async function startRun(): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${BASE}/v1/runs`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to start run: ${res.status}`);
  return res.json();
}

export async function cancelRun(runId: string): Promise<{ runId: string; status: string }> {
  const res = await fetch(`${BASE}/v1/runs/${encodeURIComponent(runId)}:cancel`, { method: 'POST' });
  if (!res.ok) throw new Error(`Failed to cancel run: ${res.status}`);
  return res.json();
}
