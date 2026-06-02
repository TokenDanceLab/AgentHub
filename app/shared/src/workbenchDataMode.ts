import type { WorkbenchState } from './workbenchState';

export type WorkbenchDataMode =
  | 'loading'
  | 'live'
  | 'offline-snapshot'
  | 'mock'
  | 'unavailable';

export type WorkbenchCatalogTone =
  | 'green'
  | 'cyan'
  | 'purple'
  | 'amber'
  | 'neutral';

export interface WorkbenchCatalogState {
  mode: WorkbenchDataMode;
  label: string;
  tone: WorkbenchCatalogTone;
  message: string;
  hasLiveCatalog: boolean;
}

export interface WorkbenchSectionSource {
  label: string;
  tone: WorkbenchCatalogTone;
}

export interface WorkbenchSectionSourceInput {
  mode: WorkbenchDataMode;
  hasSectionSnapshot: boolean;
  hasLocalDryRun?: boolean;
}

export const workbenchDataModeLabels: Record<WorkbenchDataMode, string> = {
  loading: 'Loading catalog',
  live: 'Live',
  'offline-snapshot': 'Offline snapshot',
  mock: 'Mock fallback',
  unavailable: 'Snapshot unavailable',
};

export const workbenchDataModeTones: Record<WorkbenchDataMode, WorkbenchCatalogTone> = {
  loading: 'cyan',
  live: 'green',
  'offline-snapshot': 'purple',
  mock: 'amber',
  unavailable: 'neutral',
};

export function getWorkbenchDataMode(state: WorkbenchState): WorkbenchDataMode {
  const hasSnapshot = hasWorkbenchSnapshotData(state);

  if (state.connection.status === 'loading') return 'loading';
  if (state.connection.status === 'connected' && hasSnapshot) return 'live';
  if (
    (state.connection.status === 'disconnected' ||
      state.connection.status === 'error') &&
    hasSnapshot
  ) {
    return 'offline-snapshot';
  }
  if (
    state.connection.status === 'error' ||
    state.connection.status === 'disconnected'
  ) {
    return 'mock';
  }
  return 'unavailable';
}

export function getWorkbenchCatalogState(
  state: WorkbenchState,
): WorkbenchCatalogState {
  const mode = getWorkbenchDataMode(state);

  return {
    mode,
    label: workbenchDataModeLabels[mode],
    tone: workbenchDataModeTones[mode],
    message: workbenchDataModeMessage(mode, state.connection.error),
    hasLiveCatalog: mode === 'live' || mode === 'offline-snapshot',
  };
}

export function getWorkbenchSectionSource({
  mode,
  hasSectionSnapshot,
  hasLocalDryRun = false,
}: WorkbenchSectionSourceInput): WorkbenchSectionSource {
  const baseSource = getWorkbenchSnapshotSectionSource(mode, hasSectionSnapshot);

  if (!hasLocalDryRun) {
    return baseSource;
  }

  return { label: `Local dry-run / ${baseSource.label}`, tone: 'cyan' };
}

function hasWorkbenchSnapshotData(state: WorkbenchState): boolean {
  return (
    state.projects.length > 0 ||
    state.threads.length > 0 ||
    state.runners.length > 0 ||
    state.runs.length > 0 ||
    state.artifacts.length > 0 ||
    state.approvals.length > 0 ||
    state.previews.length > 0
  );
}

function getWorkbenchSnapshotSectionSource(
  mode: WorkbenchDataMode,
  hasSectionSnapshot: boolean,
): WorkbenchSectionSource {
  if (hasSectionSnapshot) {
    if (mode === 'offline-snapshot') {
      return { label: 'Offline snapshot', tone: 'purple' };
    }

    return { label: 'Edge snapshot', tone: 'green' };
  }

  if (mode === 'loading') {
    return { label: 'Loading snapshot', tone: 'cyan' };
  }

  if (mode === 'mock') {
    return { label: 'Mock fallback', tone: 'amber' };
  }

  return { label: 'Snapshot unavailable', tone: 'neutral' };
}

function workbenchDataModeMessage(
  mode: WorkbenchDataMode,
  error?: string,
): string {
  switch (mode) {
    case 'live':
      return 'Edge catalog is loaded from the live snapshot.';
    case 'offline-snapshot':
      return 'Edge is offline; preserving the last loaded reducer snapshot.';
    case 'mock':
      return `Edge catalog unavailable: ${error ?? 'no snapshot loaded'}. Showing mock demo data.`;
    case 'loading':
      return 'Loading Edge catalog snapshot...';
    case 'unavailable':
      return 'No Edge snapshot is available yet.';
    default:
      return 'No Edge snapshot is available yet.';
  }
}
