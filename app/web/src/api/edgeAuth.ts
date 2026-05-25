// Stub — Web is Hub-only, no Edge auth needed
export function getEdgeAuthToken(): string | null { return null; }
export function edgeAuthHeaders(base?: Record<string, string>): Record<string, string> { return base ?? {}; }
export function withEdgeAuthQuery(url: string): string { return url; }
