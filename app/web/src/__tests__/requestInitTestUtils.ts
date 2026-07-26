/** Headers-safe helpers for RequestInit assertions in tests. */

export function getHeader(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) return headers.get(name);
  if (Array.isArray(headers)) {
    const hit = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return hit?.[1] ?? null;
  }
  const record = headers as Record<string, string>;
  return record[name] ?? record[name.toLowerCase()] ?? null;
}

export function getAuthorization(init?: RequestInit): string | null {
  return getHeader(init, 'Authorization');
}
