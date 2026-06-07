export type WorkbenchDataMode = 'auto' | 'demo' | 'real';

export const WORKBENCH_DATA_MODE_STORAGE_KEY = 'agenthub.workbench.dataMode';
const WORKBENCH_DATA_MODE_EVENT = 'agenthub:workbench-data-mode';

export function normalizeWorkbenchDataMode(value: string | undefined): WorkbenchDataMode {
  switch (value?.trim().toLowerCase()) {
    case 'auto':
    case '自动':
      return 'auto';
    case 'demo':
    case 'mock':
    case '模拟':
      return 'demo';
    case 'real':
    case 'normal':
    case '正常':
      return 'real';
    default:
      return 'auto';
  }
}

export function readWorkbenchDataModeOverride(): WorkbenchDataMode | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    const raw = window.localStorage.getItem(WORKBENCH_DATA_MODE_STORAGE_KEY);
    if (!raw) return undefined;
    return normalizeWorkbenchDataMode(raw);
  } catch {
    return undefined;
  }
}

export function writeWorkbenchDataModeOverride(mode: WorkbenchDataMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new Event(WORKBENCH_DATA_MODE_EVENT));
  } catch {
    // Storage can be unavailable in hardened browser contexts.
  }
}

export function getWorkbenchDataModeOverrideSnapshot(): WorkbenchDataMode | undefined {
  return readWorkbenchDataModeOverride();
}

export function subscribeWorkbenchDataModeOverride(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const handleStorage = (event: StorageEvent) => {
    if (event.key === WORKBENCH_DATA_MODE_STORAGE_KEY) listener();
  };

  window.addEventListener(WORKBENCH_DATA_MODE_EVENT, listener);
  window.addEventListener('storage', handleStorage);

  return () => {
    window.removeEventListener(WORKBENCH_DATA_MODE_EVENT, listener);
    window.removeEventListener('storage', handleStorage);
  };
}

export function resolveWorkbenchDataMode(
  envValue: string | undefined,
  override = readWorkbenchDataModeOverride(),
): WorkbenchDataMode {
  return override ?? normalizeWorkbenchDataMode(envValue);
}
