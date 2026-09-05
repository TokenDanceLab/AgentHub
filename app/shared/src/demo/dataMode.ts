/**
 * Data-source policy states that decide which data a platform may contact.
 *
 * Not the catalog loading type: `WorkbenchCatalogMode`
 * (loading/live/offline-snapshot/mock/unavailable) lives in
 * `../workbench/workbenchDataMode` and describes what the reducer catalog
 * currently shows. Both types share no literal values; do not cross-assign.
 *
 * @see WorkbenchCatalogMode in `../workbench/workbenchDataMode`
 */
export type WorkbenchDataMode =
  | 'auto'
  | 'mock'
  | 'fixture'
  | 'observed'
  | 'approved-real';

export interface WorkbenchDataModeContract {
  mode: WorkbenchDataMode;
  statusLabel: WorkbenchDataMode;
  allowsMockData: boolean;
  allowsFixtureData: boolean;
  allowsDemoRuntimeFallback: boolean;
  allowsLocalEdgeAutoFallback: boolean;
  allowsHubData: boolean;
  requiresLocalEdgeForDesktop: boolean;
  isRealDataMode: boolean;
}

export const WORKBENCH_DATA_MODE_STORAGE_KEY = 'agenthub.workbench.dataMode';
const WORKBENCH_DATA_MODE_EVENT = 'agenthub:workbench-data-mode';

export const WORKBENCH_DATA_MODE_CONTRACTS: Record<WorkbenchDataMode, WorkbenchDataModeContract> = {
  auto: {
    mode: 'auto',
    statusLabel: 'auto',
    allowsMockData: true,
    allowsFixtureData: true,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: true,
    allowsHubData: true,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
  },
  mock: {
    mode: 'mock',
    statusLabel: 'mock',
    allowsMockData: true,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: true,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: false,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
  },
  fixture: {
    mode: 'fixture',
    statusLabel: 'fixture',
    allowsMockData: false,
    allowsFixtureData: true,
    allowsDemoRuntimeFallback: true,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: false,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
  },
  observed: {
    mode: 'observed',
    statusLabel: 'observed',
    allowsMockData: false,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: true,
    requiresLocalEdgeForDesktop: true,
    isRealDataMode: true,
  },
  'approved-real': {
    mode: 'approved-real',
    statusLabel: 'approved-real',
    allowsMockData: false,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: true,
    requiresLocalEdgeForDesktop: true,
    isRealDataMode: true,
  },
};

export function normalizeWorkbenchDataMode(value: string | undefined): WorkbenchDataMode {
  switch (value?.trim().toLowerCase()) {
    case 'auto':
    case '自动':
      return 'auto';
    case 'mock':
    case '模拟':
      return 'mock';
    case 'demo':
    case 'fixture':
    case 'fixtures':
      return 'fixture';
    case 'observed':
    case 'observe':
    case 'replay':
      return 'observed';
    case 'real':
    case 'normal':
    case 'approved-real':
    case 'approved_real':
    case 'approved real':
    case '正常':
      return 'approved-real';
    default:
      return 'auto';
  }
}

export function getWorkbenchDataModeContract(value: string | undefined): WorkbenchDataModeContract {
  return WORKBENCH_DATA_MODE_CONTRACTS[normalizeWorkbenchDataMode(value)];
}

export function isWorkbenchFixtureDataMode(mode: string | undefined): boolean {
  const contract = getWorkbenchDataModeContract(mode);
  return contract.mode === 'mock' || contract.mode === 'fixture';
}

export function isWorkbenchRealDataMode(mode: string | undefined): boolean {
  return getWorkbenchDataModeContract(mode).isRealDataMode;
}

export function workbenchDataModeLabel(mode: string | undefined): string {
  return getWorkbenchDataModeContract(mode).statusLabel;
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
    window.localStorage.setItem(WORKBENCH_DATA_MODE_STORAGE_KEY, normalizeWorkbenchDataMode(mode));
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
