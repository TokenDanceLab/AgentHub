import { EDGE_AUTH_TOKEN } from '@/config';

const EDGE_AUTH_STORAGE_KEY = 'agenthub:edge_auth_token';

let runtimeEdgeAuthToken = '';

export function setEdgeAuthToken(token: string | null | undefined): void {
  runtimeEdgeAuthToken = token?.trim() ?? '';
  try {
    if (runtimeEdgeAuthToken) {
      sessionStorage.setItem(EDGE_AUTH_STORAGE_KEY, runtimeEdgeAuthToken);
    } else {
      sessionStorage.removeItem(EDGE_AUTH_STORAGE_KEY);
    }
  } catch {
    // Session storage can be unavailable in restricted previews.
  }
}

export function getEdgeAuthToken(): string {
  if (EDGE_AUTH_TOKEN) return EDGE_AUTH_TOKEN;
  if (runtimeEdgeAuthToken) return runtimeEdgeAuthToken;
  try {
    const token = sessionStorage.getItem(EDGE_AUTH_STORAGE_KEY)?.trim();
    if (token) return token;
  } catch {
    // Fall through to legacy localStorage.
  }
  try {
    return localStorage.getItem(EDGE_AUTH_STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function edgeAuthHeaders(base?: HeadersInit): HeadersInit | undefined {
  const token = getEdgeAuthToken();
  if (!token) return base;
  return {
    ...headersToRecord(base),
    Authorization: `Bearer ${token}`,
  };
}

export function withEdgeAuthQuery(url: string): string {
  const token = getEdgeAuthToken();
  if (!token) return url;
  const parsed = new URL(url);
  parsed.searchParams.set('access_token', token);
  return parsed.toString();
}

function headersToRecord(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return { ...headers };
}
