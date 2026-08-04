import { describe, expect, it } from 'vitest';
import { workspaceProjectToProjectInfo } from './hubDataMapping';

/* ═══════════════════════════════════════════════════════════════════════
   hubDataMapping — Hub workspace project DTO → Workbench ProjectInfo.

   Both platform projects ports (#1546) and both workbench models map through
   this shared function, so the mapping contract is exercised here once.
   ═══════════════════════════════════════════════════════════════════════ */

describe('workspaceProjectToProjectInfo', () => {
  it('maps id/name/description and defaults the description', () => {
    const info = workspaceProjectToProjectInfo({
      id: 'p1',
      name: 'Alpha',
      description: '  Desc  ',
    });

    expect(info).toMatchObject({
      id: 'p1',
      name: 'Alpha',
      description: 'Desc',
      status: 'Active',
      meta: 'Hub project',
      members: [],
      runs: [],
      artifacts: [],
      feed: [],
    });
  });

  it('trims the name and falls back to the default project name', () => {
    const info = workspaceProjectToProjectInfo({ id: 'p2', name: '   ' });

    expect(info.name).toBe('未命名项目');
    expect(info.description).toBe('Hub workspace project');
  });

  it('surfaces the creation time in meta when present', () => {
    const info = workspaceProjectToProjectInfo({
      id: 'p3',
      name: 'Gamma',
      created_at: '2026-08-04T08:00:00Z',
    });

    expect(info.meta.startsWith('Created ')).toBe(true);
  });
});
