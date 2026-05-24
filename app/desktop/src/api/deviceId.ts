export const DEVICE_ID_KEY = 'agenthub_device_id';

export function getOrCreateDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return crypto.randomUUID();
  }

  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_KEY, id);
  return id;
}
