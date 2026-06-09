import { mobileFixture } from '@/data/mobileFixtures';
import type { MobileAppFixture } from '@/types';

type AccessTokenProvider = () => Promise<string | null | undefined> | string | null | undefined;
type HubFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface CreateHubClientOptions {
  baseUrl: string;
  getAccessToken?: AccessTokenProvider;
  fetchImpl?: HubFetch;
}

export interface HubClient {
  getMobileSnapshot: () => Promise<MobileAppFixture>;
}

export interface HubErrorDetails {
  code: string;
  message: string;
  status?: number;
  retryable: boolean;
  cause?: unknown;
}

export class HubApiError extends Error {
  code: string;
  status: number;
  retryable: boolean;

  constructor(details: Omit<HubErrorDetails, 'cause'> & { status: number }) {
    super(details.message);
    this.name = 'HubApiError';
    this.code = details.code;
    this.status = details.status;
    this.retryable = details.retryable;
  }
}

export class HubNetworkError extends Error {
  code = 'network_error';
  retryable = true;
  cause?: unknown;

  constructor(message = 'Network request to AgentHub failed', cause?: unknown) {
    super(message);
    this.name = 'HubNetworkError';
    this.cause = cause;
  }
}

export type HubWsEventType =
  | 'snapshot.updated'
  | 'thread.updated'
  | 'run.updated'
  | 'approval.updated'
  | 'presence.updated'
  | 'error';

export interface HubWsEvent<TPayload = unknown> {
  id: string;
  type: HubWsEventType;
  createdAt: string;
  payload: TPayload;
}

export interface HubWsUrlOptions {
  since?: string;
}

export function createMockHubClient(delayMs = 80): HubClient {
  return {
    async getMobileSnapshot() {
      await new Promise((resolve) => {
        setTimeout(resolve, delayMs);
      });

      return mobileFixture;
    },
  };
}

export function createHubClient(options: CreateHubClientOptions): HubClient {
  const fetchImpl = options.fetchImpl ?? getGlobalFetch();

  return {
    async getMobileSnapshot() {
      return requestJson<MobileAppFixture>({
        baseUrl: options.baseUrl,
        fetchImpl,
        getAccessToken: options.getAccessToken,
        path: '/v1/mobile/snapshot',
      });
    },
  };
}

export function createHubWsUrl(baseUrl: string, options: HubWsUrlOptions = {}): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = '/v1/events';
  url.search = '';

  if (options.since) {
    url.searchParams.set('since', options.since);
  }

  return url.toString();
}

async function requestJson<TBody>({
  baseUrl,
  fetchImpl,
  getAccessToken,
  path,
}: {
  baseUrl: string;
  fetchImpl: HubFetch;
  getAccessToken: AccessTokenProvider | undefined;
  path: string;
}): Promise<TBody> {
  const headers: Record<string, string> = {
    accept: 'application/json',
  };
  const accessToken = await getAccessToken?.();

  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  let response: Response;
  try {
    response = await fetchImpl(createHubRestUrl(baseUrl, path), {
      headers,
      method: 'GET',
    });
  } catch (error) {
    throw new HubNetworkError('Network request to AgentHub failed', error);
  }

  const body = await parseJsonBody(response);

  if (!response.ok) {
    throw createApiError(response, body);
  }

  return body as TBody;
}

function createHubRestUrl(baseUrl: string, path: string): string {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;

  return new URL(normalizedPath, normalizedBase).toString();
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function createApiError(response: Response, body: unknown): HubApiError {
  const parsedError = parseErrorBody(body);
  const message = redactSensitiveErrorText(
    parsedError.message ?? response.statusText ?? `AgentHub request failed with ${response.status}`,
  );
  const code = redactSensitiveErrorText(parsedError.code ?? `http_${response.status}`);

  return new HubApiError({
    code,
    message,
    retryable: response.status >= 500 || response.status === 429,
    status: response.status,
  });
}

function redactSensitiveErrorText(text: string): string {
  return text
    .replace(/Authorization:\s*Bearer\s+[^\s,;]+/gi, 'Authorization: Bearer [redacted]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .replace(/(access_token|refresh_token|id_token|client_secret|session_token)=([^&\s]+)/gi, '$1=[redacted]')
    .replace(/(access_token|refresh_token|id_token|client_secret|session_token)["']?\s*[:=]\s*["']?[^"',\s}]+/gi, '$1=[redacted]');
}

function parseErrorBody(body: unknown): Partial<Pick<HubErrorDetails, 'code' | 'message'>> {
  if (!body || typeof body !== 'object') {
    return {};
  }

  const record = body as Record<string, unknown>;
  const nestedError = record.error && typeof record.error === 'object' ? (record.error as Record<string, unknown>) : undefined;
  const source = nestedError ?? record;
  const code = typeof source.code === 'string' ? source.code : undefined;
  const message = typeof source.message === 'string' ? source.message : undefined;
  const parsed: Partial<Pick<HubErrorDetails, 'code' | 'message'>> = {};

  if (code) {
    parsed.code = code;
  }

  if (message) {
    parsed.message = message;
  }

  return parsed;
}

function getGlobalFetch(): HubFetch {
  if (typeof globalThis.fetch !== 'function') {
    throw new HubNetworkError('No fetch implementation is available for AgentHub requests');
  }

  return globalThis.fetch.bind(globalThis) as HubFetch;
}
