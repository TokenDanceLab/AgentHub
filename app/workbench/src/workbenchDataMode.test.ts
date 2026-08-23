import { describe, expect, it } from 'vitest';
import {
  getWorkbenchCatalogState,
  getWorkbenchDataMode,
  getWorkbenchSectionSource,
  type WorkbenchCatalogMode,
} from './workbenchDataMode';
import type { WorkbenchState } from './workbenchState';

function state(
  overrides: Partial<WorkbenchState> = {},
): WorkbenchState {
  return {
    projects: [],
    threads: [],
    runners: [],
    runs: [],
    threadItems: [],
    approvals: [],
    artifacts: [],
    previews: [],
    runLogs: {},
    connection: { status: 'idle' },
    lastSeq: 0,
    ...overrides,
  };
}

describe('workbenchDataMode', () => {
  it.each<[string, WorkbenchState, WorkbenchCatalogMode]>([
    ['loading while Edge snapshot is pending', state({ connection: { status: 'loading' } }), 'loading'],
    [
      'live when connected with snapshot data',
      state({
        connection: { status: 'connected' },
        projects: [{ id: 'project-1', name: 'AgentHub', createdAt: '2026-05-24T10:00:00.000Z' }],
      }),
      'live',
    ],
    [
      'offline snapshot when disconnected with reducer data',
      state({
        connection: { status: 'disconnected', error: 'socket closed' },
        runs: [
          {
            runId: 'run-1',
            projectId: 'project-1',
            threadId: 'thread-1',
            status: 'running',
            createdAt: '2026-05-24T10:00:00.000Z',
          },
        ],
      }),
      'offline-snapshot',
    ],
    [
      'mock fallback when Edge failed before snapshot data loaded',
      state({ connection: { status: 'error', error: 'network down' } }),
      'mock',
    ],
    ['unavailable before a load begins', state(), 'unavailable'],
  ])('%s', (_label, input, expected) => {
    expect(getWorkbenchDataMode(input)).toBe(expected);
  });

  it('keeps mock fallback visually distinct from live catalog data', () => {
    const catalogState = getWorkbenchCatalogState(
      state({ connection: { status: 'error', error: 'network down' } }),
    );

    expect(catalogState).toMatchObject({
      mode: 'mock',
      label: 'Mock fallback',
      tone: 'amber',
      hasLiveCatalog: false,
    });
    expect(catalogState.message).toContain('Showing mock demo data.');
  });

  it('marks offline snapshots as reusable catalog data without calling them live', () => {
    const catalogState = getWorkbenchCatalogState(
      state({
        connection: { status: 'error', error: 'network down' },
        projects: [{ id: 'project-1', name: 'AgentHub', createdAt: '2026-05-24T10:00:00.000Z' }],
      }),
    );

    expect(catalogState).toMatchObject({
      mode: 'offline-snapshot',
      label: 'Offline snapshot',
      tone: 'purple',
      hasLiveCatalog: true,
    });
  });

  it('does not treat Edge runner diagnostics alone as product live-catalog evidence', () => {
    expect(
      getWorkbenchDataMode(
        state({
          connection: { status: 'connected' },
          runners: [{ id: 'runner-1', name: 'Local Runner', status: 'online' }],
        }),
      ),
    ).toBe('unavailable');
  });

  it.each([
    [
      'loading section without snapshot data',
      { mode: 'loading', hasSectionSnapshot: false },
      { label: 'Loading snapshot', tone: 'cyan' },
    ],
    [
      'unavailable section without snapshot data',
      { mode: 'unavailable', hasSectionSnapshot: false },
      { label: 'Snapshot unavailable', tone: 'neutral' },
    ],
    [
      'mock section without snapshot data',
      { mode: 'mock', hasSectionSnapshot: false },
      { label: 'Mock fallback', tone: 'amber' },
    ],
    [
      'offline section with snapshot data',
      { mode: 'offline-snapshot', hasSectionSnapshot: true },
      { label: 'Offline snapshot', tone: 'purple' },
    ],
    [
      'available snapshot mode with section data',
      { mode: 'live', hasSectionSnapshot: true },
      { label: 'Edge snapshot', tone: 'green' },
    ],
    [
      'local dry-run layered over the base section source',
      { mode: 'mock', hasSectionSnapshot: false, hasLocalDryRun: true },
      { label: 'Local dry-run / Mock fallback', tone: 'cyan' },
    ],
  ] as const)('%s', (_label, input, expected) => {
    expect(getWorkbenchSectionSource(input)).toEqual(expected);
  });

  it('describes live, loading and unavailable catalog states with distinct messages', () => {
    const live = getWorkbenchCatalogState(
      state({
        connection: { status: 'connected' },
        projects: [{ id: 'p1', name: 'AgentHub', createdAt: '2026-05-24T10:00:00.000Z' }],
      }),
    );
    expect(live).toMatchObject({ mode: 'live', hasLiveCatalog: true });
    expect(live.message).toBe('Edge catalog is loaded from the live snapshot.');

    const loading = getWorkbenchCatalogState(state({ connection: { status: 'loading' } }));
    expect(loading).toMatchObject({ mode: 'loading', hasLiveCatalog: false });
    expect(loading.message).toBe('Loading Edge catalog snapshot...');

    const unavailable = getWorkbenchCatalogState(state());
    expect(unavailable).toMatchObject({ mode: 'unavailable', hasLiveCatalog: false });
    expect(unavailable.message).toBe('No Edge snapshot is available yet.');
  });
});
