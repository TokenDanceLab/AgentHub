// Pure parse/record helpers for the Hub↔Edge integration bridge.
// Kept free of React / Hub client / Edge fetch so unit tests stay light.

export function parseRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function compactRecord<T>(value: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

/** Extract a string value that may be in a legacy DispatchPayload shape. */
export function getString(data: Record<string, unknown>, key: string): string {
  const v = data[key];
  return typeof v === 'string' ? v : '';
}

export function getFirstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return undefined;
}

export function getFirstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
  }
  return undefined;
}

export function getFirstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function parseStringArray(value: unknown): string[] | undefined {
  let source = value;
  if (typeof value === 'string') {
    try {
      source = JSON.parse(value);
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(source)) return undefined;
  const values = source.filter(
    (item): item is string => typeof item === 'string' && item.trim() !== '',
  );
  return values.length > 0 ? values : undefined;
}

export function parseStringRecord(value: unknown): Record<string, string> | undefined {
  const record = parseRecord(value);
  const entries = Object.entries(record).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function boolValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
