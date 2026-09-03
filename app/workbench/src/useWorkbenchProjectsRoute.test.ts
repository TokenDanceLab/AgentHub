import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ProjectDraft, ProjectInfo } from './pages';
import {
  useWorkbenchProjectsRoute,
  type WorkbenchProjectsStatus,
} from './useWorkbenchProjectsRoute';

/* ═══════════════════════════════════════════════════════════════════════
   useWorkbenchProjectsRoute — 数据源解析与状态过滤。

   项目数据只有两个来源：父级（两个 shell 各自用 react-query 拉 Hub workspace
   projects 后传 `projects`/`projectsStatus`/`projectsActions`），或 fixture
   模式下的 mock 池。曾经还有第三条——#1546 的 `projectsPort` 内部取数分支
   （含游标分页与 load-more 重试）——但它在两个 shell 里都结构性不可达
   （`portProjectsEnabled = Boolean(port) && !projects`，而 shell 只在
   `hubReady` 时注入 port，此时 `projects` 必为数组），已随端口一起删除。
   ═══════════════════════════════════════════════════════════════════════ */

function project(id: string, name = `Project ${id}`): ProjectInfo {
  return {
    id,
    name,
    description: `${name} description`,
    status: 'Active',
    meta: 'Hub project',
    members: [],
    announcement: '',
    runs: [],
    artifacts: [],
    feed: [],
  };
}

describe('useWorkbenchProjectsRoute — 数据源解析', () => {
  it('prefers parent-managed projects and passes their status through', () => {
    const managedStatus: WorkbenchProjectsStatus = { loading: true };
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projects: [project('managed')],
      projectsStatus: managedStatus,
      realDataMode: true,
    }));

    expect(result.current.sourceProjects).toHaveLength(1);
    expect(result.current.sourceProjects[0]!.id).toBe('managed');
    expect(result.current.effectiveProjectsStatus).toBe(managedStatus);
  });

  it('falls back to mock projects in fixture mode', () => {
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      realDataMode: false,
    }));
    expect(result.current.sourceProjects.length).toBeGreaterThan(0);
    expect(result.current.effectiveProjectsStatus).toBeUndefined();
  });

  it('shows an empty list in real mode before the parent has projects', () => {
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      realDataMode: true,
    }));
    expect(result.current.sourceProjects).toEqual([]);
  });

  it('reports mutation affordances only from parent-provided callbacks', async () => {
    const { result, rerender } = renderHook(
      ({ onCreate }: { onCreate?: ((draft: ProjectDraft) => Promise<ProjectInfo | void>) | undefined }) =>
        useWorkbenchProjectsRoute({
          projects: [project('p1')],
          realDataMode: true,
          ...(onCreate ? { onProjectCreate: onCreate } : {}),
        }),
      { initialProps: { onCreate: undefined } },
    );

    expect(result.current.canMutateProject).toBe(false);
    // 没有父级回调时 create 是 no-op：不抛、不写状态（端口删除前后一致，
    // 因为两个 shell 在 hubReady 时总会给回调，demo 模式下端口本来就是 undefined）
    await expect(
      result.current.handleProjectCreate({ name: 'ignored' } as ProjectDraft),
    ).resolves.toBeUndefined();
    expect(result.current.effectiveProjectsStatus).toBeUndefined();

    rerender({ onCreate: async () => undefined });
    expect(result.current.canMutateProject).toBe(true);
  });
});

describe('useWorkbenchProjectsRoute — status filter (#2154 P2-3)', () => {
  it('filters the rendered list while leaving sourceProjects untouched', () => {
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projects: [project('p1'), project('p2')],
      realDataMode: true,
    }));
    expect(result.current.sourceProjects).toHaveLength(2);

    // 'all' is a pass-through, including projects whose status we cannot
    // classify (they must never be dropped by filtering).
    expect(result.current.visibleProjects).toEqual(result.current.sourceProjects);
    // The fixtures carry status 'Active' → only running is satisfiable.
    expect(result.current.availableProjectFilters).toEqual(['all', 'running']);

    act(() => {
      result.current.setProjectFilter('running');
    });
    expect(result.current.projectFilter).toBe('running');
    expect(result.current.visibleProjects.map((p) => p.id)).toEqual(['p1', 'p2']);
    // Selection keeps reading the unfiltered source list.
    expect(result.current.sourceProjects).toHaveLength(2);
    expect(result.current.projectId).toBe('p1');

    // A bucket this data source cannot satisfy is not selectable: the route
    // falls straight back to 'all' instead of parking on a list that is empty
    // by construction (#2154 P2-3 — no enabled-but-always-empty chip).
    act(() => {
      result.current.setProjectFilter('archived');
    });
    expect(result.current.projectFilter).toBe('all');
    expect(result.current.visibleProjects).toEqual(result.current.sourceProjects);
  });

  it('publishes which filters the loaded projects can satisfy (#2154 P2-3)', () => {
    const { result, rerender } = renderHook(
      ({ projects }: { projects: ProjectInfo[] }) =>
        useWorkbenchProjectsRoute({ projects, realDataMode: true }),
      {
        initialProps: {
          projects: [{ ...project('m1'), status: 'Active' }, { ...project('m2'), status: '已归档' }],
        },
      },
    );

    expect(result.current.availableProjectFilters).toEqual(['all', 'running', 'archived']);

    // Data refresh drops every archived project → the bucket disappears.
    rerender({ projects: [{ ...project('m1'), status: 'Active' }] });
    expect(result.current.availableProjectFilters).toEqual(['all', 'running']);
  });

  it('falls back to "all" when the selected bucket stops being available', () => {
    const { result, rerender } = renderHook(
      ({ projects }: { projects: ProjectInfo[] }) =>
        useWorkbenchProjectsRoute({ projects, realDataMode: true }),
      {
        initialProps: {
          projects: [{ ...project('m1'), status: 'Active' }, { ...project('m2'), status: '已归档' }],
        },
      },
    );

    act(() => {
      result.current.setProjectFilter('archived');
    });
    expect(result.current.projectFilter).toBe('archived');
    expect(result.current.visibleProjects.map((p) => p.id)).toEqual(['m2']);

    // The archived project disappears (delete / reload / paging): parking the
    // user on an empty list is exactly the false fact this gate removes.
    rerender({ projects: [{ ...project('m1'), status: 'Active' }] });

    expect(result.current.projectFilter).toBe('all');
    expect(result.current.visibleProjects.map((p) => p.id)).toEqual(['m1']);
    // Selection still reads the unfiltered source list.
    expect(result.current.sourceProjects.map((p) => p.id)).toEqual(['m1']);
  });

  it('keeps parent-managed projects with an unknown status under "all" only', () => {
    const managed = [
      { ...project('m1'), status: 'Hub group' },
      { ...project('m2'), status: '已归档' },
    ];
    const { result } = renderHook(() => useWorkbenchProjectsRoute({
      projects: managed,
      realDataMode: true,
    }));

    expect(result.current.visibleProjects).toHaveLength(2);

    act(() => {
      result.current.setProjectFilter('archived');
    });
    expect(result.current.visibleProjects.map((p) => p.id)).toEqual(['m2']);

    act(() => {
      result.current.setProjectFilter('all');
    });
    expect(result.current.visibleProjects.map((p) => p.id)).toEqual(['m1', 'm2']);
  });
});
