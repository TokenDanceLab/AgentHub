export const DEVICE_ID_KEY = 'agenthub_device_id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeDeviceId(value: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed || !UUID_RE.test(trimmed)) return null;
  return trimmed.toLowerCase();
}

export function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return crypto.randomUUID();
  }

  const existing = normalizeDeviceId(localStorage.getItem(DEVICE_ID_KEY));
  if (existing) {
    localStorage.setItem(DEVICE_ID_KEY, existing);
    return existing;
  }

  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
