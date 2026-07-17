/** Pure field parsers / type guards for Edge event payload normalization. */

export function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const parsed = stringField(value);
    if (parsed) return parsed;
  }
  return undefined;
}

export function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cleanText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  return text || undefined;
}

export function pathFromContent(content: string | undefined): string | undefined {
  if (!content) return undefined;
  const match = content.match(/(?:^|\s)([A-Za-z]:[\\/][^\s]+|[\w./-]+\.[\w.-]+)/);
  return match?.[1];
}

export function errorPayloadMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  return (
    stringField(value.message) ??
    stringField(value.Message) ??
    stringField(value.reason) ??
    stringField(value.error)
  );
}

export function formatCost(value: number | undefined): string | undefined {
  return value == null ? undefined : `$${value.toFixed(2)}`;
}

export function durationLabel(durationMs: number | undefined): string | undefined {
  if (durationMs == null) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)}ms`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m${remainingSeconds}s`;
}

export function diffStat(patch: string, marker: '+' | '-'): number {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith(marker) && !line.startsWith(`${marker}${marker}${marker}`))
    .length;
}

export function safeAuthorId(value: string, fallbackId: string): string {
  const id = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return id || fallbackId;
}
