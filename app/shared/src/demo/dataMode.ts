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

export type WorkbenchDataModeTone =
  | 'neutral'
  | 'amber'
  | 'purple'
  | 'cyan'
  | 'green';

export interface WorkbenchDataModeContract {
  mode: WorkbenchDataMode;
  statusLabel: WorkbenchDataMode;
  displayLabel: 'Auto' | 'Mock' | 'Fixture' | 'Observed' | 'Approved real';
  tone: WorkbenchDataModeTone;
  title: string;
  description: string;
  desktopLabel: string;
  webLabel: string;
  allowsMockData: boolean;
  allowsFixtureData: boolean;
  allowsDemoRuntimeFallback: boolean;
  allowsLocalEdgeAutoFallback: boolean;
  allowsHubData: boolean;
  requiresHubAuthForWeb: boolean;
  requiresLocalEdgeForDesktop: boolean;
  isRealDataMode: boolean;
  isStrictRealMode: boolean;
}

export const WORKBENCH_DATA_MODE_STORAGE_KEY = 'agenthub.workbench.dataMode';
const WORKBENCH_DATA_MODE_EVENT = 'agenthub:workbench-data-mode';

export const WORKBENCH_DATA_MODE_CONTRACTS: Record<WorkbenchDataMode, WorkbenchDataModeContract> = {
  auto: {
    mode: 'auto',
    statusLabel: 'auto',
    displayLabel: 'Auto',
    tone: 'neutral',
    title: 'Prefer real data, allow development fallback',
    description: 'Uses real data when available and fixture data only for explicit development fallback paths.',
    desktopLabel: '5173: Tauri real / browser fixture',
    webLabel: '5174: authenticated real / anonymous fixture',
    allowsMockData: true,
    allowsFixtureData: true,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: true,
    allowsHubData: true,
    requiresHubAuthForWeb: false,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
    isStrictRealMode: false,
  },
  mock: {
    mode: 'mock',
    statusLabel: 'mock',
    displayLabel: 'Mock',
    tone: 'amber',
    title: 'Pinned mock workbench data',
    description: 'Uses local mock data only. Hub and local Edge are not contacted.',
    desktopLabel: '5173: demo transcript',
    webLabel: '5174: demo transcript',
    allowsMockData: true,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: true,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: false,
    requiresHubAuthForWeb: false,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
    isStrictRealMode: false,
  },
  fixture: {
    mode: 'fixture',
    statusLabel: 'fixture',
    displayLabel: 'Fixture',
    tone: 'purple',
    title: 'Pinned shared workbench fixture',
    description: 'Uses deterministic fixture data for UI and screenshot verification.',
    desktopLabel: '5173: fixture transcript',
    webLabel: '5174: fixture transcript',
    allowsMockData: false,
    allowsFixtureData: true,
    allowsDemoRuntimeFallback: true,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: false,
    requiresHubAuthForWeb: false,
    requiresLocalEdgeForDesktop: false,
    isRealDataMode: false,
    isStrictRealMode: false,
  },
  observed: {
    mode: 'observed',
    statusLabel: 'observed',
    displayLabel: 'Observed',
    tone: 'cyan',
    title: 'Hub observed replay only',
    description: 'Uses observed Hub sessions, messages, and replayed runtime events. It does not fall back to mock data.',
    desktopLabel: '5173: observed Edge snapshot',
    webLabel: '5174: observed Hub replay',
    allowsMockData: false,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: true,
    requiresHubAuthForWeb: true,
    requiresLocalEdgeForDesktop: true,
    isRealDataMode: true,
    isStrictRealMode: false,
  },
  'approved-real': {
    mode: 'approved-real',
    statusLabel: 'approved-real',
    displayLabel: 'Approved real',
    tone: 'green',
    title: 'Approved real Hub / Edge data only',
    description: 'Uses authenticated Hub and Edge data only. Empty or signed-out states stay explicit.',
    desktopLabel: '5173: Edge thread data',
    webLabel: '5174: Hub session data',
    allowsMockData: false,
    allowsFixtureData: false,
    allowsDemoRuntimeFallback: false,
    allowsLocalEdgeAutoFallback: false,
    allowsHubData: true,
    requiresHubAuthForWeb: true,
    requiresLocalEdgeForDesktop: true,
    isRealDataMode: true,
    isStrictRealMode: true,
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

export function workbenchDataModeDisplayLabel(mode: string | undefined): WorkbenchDataModeContract['displayLabel'] {
  return getWorkbenchDataModeContract(mode).displayLabel;
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
