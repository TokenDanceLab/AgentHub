// real_tested=true
import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '../../__tests__/setup';
import { useTestI18nLanguage } from '@shared/testing/i18n';
import { ProjectsPage } from '../ProjectsPage';
import { useWorkbenchProjectsRoute } from '../../useWorkbenchProjectsRoute';
import { buildProjectsPageProps } from '../../workbenchRoutesHelpers';
import { filterProjectsByStatus } from './shared';
import type { ProjectFilter, ProjectInfo } from './types';

/* ═══════════════════════════════════════════════════════════════════════
   Project filter chip availability (#2154 P2-3).

   Invariant under test — **no filter chip may be clickable when the current
   data source can only ever produce an empty list for it.** Before this gate
   the chips were decorative; making them filter without the availability gate
   would have been worse, because an enabled chip that returns nothing reads as
   a fact about the user's data ("I have no archived projects").

   Rendered through the real path (route hook → buildProjectsPageProps →
   ProjectsPage → ProjectNav → FilterList) so the invariant is pinned on the
   wiring, not on one component in isolation.
   ═══════════════════════════════════════════════════════════════════════ */

beforeAll(async () => {
  await useTestI18nLanguage('zh');
});

const UNAVAILABLE_TITLE = '当前数据源没有可归入该状态的项目（Hub 尚未提供项目生命周期字段）';
const LIFECYCLE_FILTERS: ProjectFilter[] = ['running', 'completed', 'archived'];

function project(id: string, status: string): ProjectInfo {
  return {
    id,
    name: `Project ${id}`,
    description: `${id} description`,
    status,
    meta: 'Hub project',
    members: [],
    announcement: '',
    runs: [],
    artifacts: [],
    feed: [],
  };
}

/** The three status shapes the production mappers actually emit. */
const DATA_SHAPES: Record<string, ProjectInfo[]> = {
  // web/src/platform/webWorkbenchProjects.ts — status is a projection label,
  // not a lifecycle state, so nothing can be classified.
  'web projection (Hub / Hub group)': [project('w1', 'Hub'), project('w2', 'Hub group')],
  // workbench hubDataMapping / projects port — every project is 'Active'.
  'port + desktop projection (Active)': [project('a1', 'Active'), project('a2', 'Active')],
  // demo data + any future Hub lifecycle field.
  'mixed lifecycle labels': [
    project('m1', 'Active'),
    project('m2', '已完成'),
    project('m3', '已归档'),
    project('m4', 'Hub group'),
  ],
};

function renderProjectsPage(projects: ProjectInfo[]) {
  const { result } = renderHook(() => useWorkbenchProjectsRoute({ projects, realDataMode: true }));
  const props = buildProjectsPageProps(result.current, []);
  const rendered = render(<ProjectsPage {...props} />);
  return { ...rendered, route: result.current };
}

function chipsOf(container: HTMLElement): Array<{ filter: ProjectFilter; el: HTMLButtonElement }> {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('[data-filter-id]')).map((el) => ({
    filter: el.getAttribute('data-filter-id') as ProjectFilter,
    el,
  }));
}

describe('project filter chip availability (#2154 P2-3)', () => {
  it('disables all three lifecycle chips for the web projection shape', () => {
    const { container, route } = renderProjectsPage(DATA_SHAPES['web projection (Hub / Hub group)']);

    expect(route.availableProjectFilters).toEqual(['all']);
    const chips = chipsOf(container);
    expect(chips).toHaveLength(4);

    const all = chips.find((chip) => chip.filter === 'all');
    expect(all?.el).toBeEnabled();
    expect(all?.el).not.toHaveAttribute('title');

    for (const filter of LIFECYCLE_FILTERS) {
      const chip = chips.find((c) => c.filter === filter);
      expect(chip?.el, `${filter} chip`).toBeDisabled();
      expect(chip?.el).toHaveAttribute('title', UNAVAILABLE_TITLE);
    }
  });

  it('enables only 运行中 for the Active-only projection shape', () => {
    const { container, route } = renderProjectsPage(DATA_SHAPES['port + desktop projection (Active)']);

    expect(route.availableProjectFilters).toEqual(['all', 'running']);
    const chips = chipsOf(container);
    expect(chips.find((c) => c.filter === 'all')?.el).toBeEnabled();
    expect(chips.find((c) => c.filter === 'running')?.el).toBeEnabled();
    for (const filter of ['completed', 'archived'] as ProjectFilter[]) {
      expect(chips.find((c) => c.filter === filter)?.el).toBeDisabled();
      expect(chips.find((c) => c.filter === filter)?.el).toHaveAttribute('title', UNAVAILABLE_TITLE);
    }
  });

  it('enables every chip when the data really spans all three buckets', () => {
    const { container, route } = renderProjectsPage(DATA_SHAPES['mixed lifecycle labels']);

    expect(route.availableProjectFilters).toEqual(['all', 'running', 'completed', 'archived']);
    for (const chip of chipsOf(container)) {
      expect(chip.el, `${chip.filter} chip`).toBeEnabled();
      expect(chip.el).not.toHaveAttribute('title');
    }
  });

  it('still filters when an available chip is clicked', () => {
    const projects = DATA_SHAPES['mixed lifecycle labels'];
    const { container, route } = renderProjectsPage(projects);

    const archived = chipsOf(container).find((c) => c.filter === 'archived');
    expect(archived?.el).toBeEnabled();
    act(() => {
      archived?.el.click();
    });

    expect(route.sourceProjects).toHaveLength(4);
    expect(filterProjectsByStatus(route.sourceProjects, 'archived').map((p) => p.id)).toEqual(['m3']);
    // Selection/paging keep reading the unfiltered source list.
    expect(route.projectId).toBe('m1');
  });
});

/* The invariant, asserted mechanically for every data shape: walk the rendered
   chips and require that each ENABLED one can actually match something. */
describe.each(Object.entries(DATA_SHAPES))(
  'enabled-but-always-empty invariant — %s',
  (shape, projects) => {
    it('offers no clickable chip whose result must be empty', () => {
      const { container } = renderProjectsPage(projects);
      const chips = chipsOf(container);
      expect(chips.length).toBe(4);

      const enabled = chips.filter((chip) => !chip.el.disabled);
      expect(enabled.length, 'at least 全部 stays clickable').toBeGreaterThan(0);

      for (const { filter, el } of enabled) {
        if (filter === 'all') {
          // `all` never filters, so it is empty only when there is no data at all.
          expect(projects.length, 'all chip on an empty data source').toBeGreaterThan(0);
          continue;
        }
        const matches = filterProjectsByStatus(projects, filter);
        expect(
          matches.length,
          `chip "${filter}" is enabled but matches nothing in shape "${shape}"`,
        ).toBeGreaterThan(0);
        // Disabled chips must carry the reason, enabled ones must not.
        expect(el).not.toHaveAttribute('title');
      }

      for (const { filter, el } of chips.filter((chip) => chip.el.disabled)) {
        expect(filter).not.toBe('all');
        expect(filterProjectsByStatus(projects, filter)).toEqual([]);
        expect(el).toHaveAttribute('title', UNAVAILABLE_TITLE);
      }
    });
  },
);

describe('filter availability copy', () => {
  it('keeps the 全部 chip label and the disabled reason localized', () => {
    const { container } = renderProjectsPage(DATA_SHAPES['web projection (Hub / Hub group)']);

    expect(screen.getByRole('button', { name: '全部项目' })).toBeEnabled();
    // The reason is user copy, not an engineering id.
    const disabled = chipsOf(container).filter((chip) => chip.el.disabled);
    expect(disabled).toHaveLength(3);
    for (const { el } of disabled) {
      expect(el.getAttribute('title')).not.toMatch(/Hub'|'Hub group|bucket|null/);
    }
  });
});
