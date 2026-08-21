import type { RuntimeSessionImportItem } from '@shared/workbench';

/**
 * Desktop host: Edge GET /v1/runtime-sessions via typed fetch.
 * The Edge REST path lives on the Desktop platform adapter only — shared
 * code consumes this data through `HostDiagnosticsPort.listRuntimeSessions`.
 */
export type FetchDesktopRuntimeSessionsOptions = {
  edgeBaseUrl: string;
  limit?: number;
  fetchImpl?: typeof fetch;
};

type Envelope = {
  data?: { items?: RuntimeSessionImportItem[] } | RuntimeSessionImportItem[];
  items?: RuntimeSessionImportItem[];
};

export async function fetchDesktopRuntimeSessions(
  opts: FetchDesktopRuntimeSessionsOptions,
): Promise<RuntimeSessionImportItem[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.edgeBaseUrl.replace(/\/$/, '');
  const limit = opts.limit && opts.limit > 0 ? opts.limit : 50;
  const res = await fetchImpl(`${base}/v1/runtime-sessions?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Edge GET /v1/runtime-sessions failed: ${res.status}`);
  }
  const body = (await res.json()) as Envelope;
  if (Array.isArray(body.items)) return body.items;
  if (body.data && Array.isArray(body.data)) return body.data;
  if (body.data && typeof body.data === 'object' && Array.isArray(body.data.items)) {
    return body.data.items;
  }
  return [];
}
