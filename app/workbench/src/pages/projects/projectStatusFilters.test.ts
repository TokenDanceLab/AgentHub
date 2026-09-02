// real_tested=true
import { describe, expect, it } from 'vitest';
import type { ProjectInfo } from './types';
import {
  filterProjectsByStatus,
  projectStatusBucket,
  resolveAvailableProjectFilters,
} from './shared';

/* ═══════════════════════════════════════════════════════════════════════
   Project status filtering (#2154 P2-3) — the nav filter chips used to be
   decorative: clicking archived only moved the highlight, so users read an
   unfiltered list as a fact about their data.
   ═══════════════════════════════════════════════════════════════════════ */

function project(id: string, status?: string): ProjectInfo {
  return {
    id,
    name: `Project ${id}`,
    description: '',
    ...(status !== undefined ? { status } : {}),
    meta: '',
    members: [],
    announcement: '',
    runs: [],
    artifacts: [],
    feed: [],
  } as ProjectInfo;
}

describe('projectStatusBucket', () => {
  it('classifies the labels the Hub/demo mappers actually emit', () => {
    expect(projectStatusBucket('Active')).toBe('running');
    expect(projectStatusBucket('running')).toBe('running');
    expect(projectStatusBucket('进行中')).toBe('running');
    expect(projectStatusBucket('研究中')).toBe('running');
    expect(projectStatusBucket('已完成')).toBe('completed');
    expect(projectStatusBucket('done')).toBe('completed');
    expect(projectStatusBucket('已归档')).toBe('archived');
    expect(projectStatusBucket('Archived')).toBe('archived');
  });

  it('returns null for labels that are not lifecycle states', () => {
    // The web projection emits Hub / Hub group, and demo data carries a
    // pending-archive label — neither may be guessed into a bucket.
    expect(projectStatusBucket('Hub')).toBeNull();
    expect(projectStatusBucket('Hub group')).toBeNull();
    expect(projectStatusBucket('待归档确认')).toBeNull();
    expect(projectStatusBucket('')).toBeNull();
    expect(projectStatusBucket('   ')).toBeNull();
    expect(projectStatusBucket(undefined)).toBeNull();
  });
});

describe('filterProjectsByStatus', () => {
  const projects = [
    project('run', 'Active'),
    project('done', '已完成'),
    project('old', '已归档'),
    project('hub', 'Hub group'),
    project('nostatus'),
  ];

  it('passes every project through for "all", including unclassifiable ones', () => {
    const all = filterProjectsByStatus(projects, 'all');
    expect(all).toBe(projects);
    expect(all.map((p) => p.id)).toEqual(['run', 'done', 'old', 'hub', 'nostatus']);
  });

  it('keeps only the matching bucket for a concrete filter', () => {
    expect(filterProjectsByStatus(projects, 'running').map((p) => p.id)).toEqual(['run']);
    expect(filterProjectsByStatus(projects, 'completed').map((p) => p.id)).toEqual(['done']);
    expect(filterProjectsByStatus(projects, 'archived').map((p) => p.id)).toEqual(['old']);
  });

  it('never drops status-less projects from "all"', () => {
    const statusless = [project('a'), project('b', '')];
    expect(filterProjectsByStatus(statusless, 'all')).toHaveLength(2);
    // …and never invents a bucket for them either.
    expect(filterProjectsByStatus(statusless, 'running')).toEqual([]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterProjectsByStatus([project('run', 'Active')], 'archived')).toEqual([]);
  });
});

/* #2154 P2-3 second half: an enabled chip that can only produce an empty list
   is a worse lie than the decorative chip it replaced, so the route publishes
   which buckets the loaded projects can actually be classified into. */
describe('resolveAvailableProjectFilters', () => {
  it('always keeps "all" available, even with no projects at all', () => {
    expect(resolveAvailableProjectFilters([])).toEqual(['all']);
  });

  it('offers nothing but "all" for the web projection labels', () => {
    const projects = [project('w1', 'Hub'), project('w2', 'Hub group')];
    expect(resolveAvailableProjectFilters(projects)).toEqual(['all']);
  });

  it('offers only running for the Active-only port/desktop projection', () => {
    const projects = [project('a1', 'Active'), project('a2', 'Active')];
    expect(resolveAvailableProjectFilters(projects)).toEqual(['all', 'running']);
  });

  it('offers every lifecycle chip when the data really spans all buckets', () => {
    const projects = [
      project('m1', '研究中'),
      project('m2', '已完成'),
      project('m3', '已归档'),
      project('m4', 'Hub group'),
    ];
    expect(resolveAvailableProjectFilters(projects)).toEqual([
      'all',
      'running',
      'completed',
      'archived',
    ]);
  });

  it('keeps FILTER_ITEMS order and never lists a bucket without a match', () => {
    const projects = [project('x1', '已归档'), project('x2', 'Hub')];
    const available = resolveAvailableProjectFilters(projects);
    expect(available).toEqual(['all', 'archived']);
    for (const filter of available) {
      if (filter === 'all') continue;
      expect(filterProjectsByStatus(projects, filter).length).toBeGreaterThan(0);
    }
  });
});
