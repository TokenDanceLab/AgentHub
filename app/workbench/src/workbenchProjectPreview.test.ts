import { describe, expect, it } from 'vitest';
import type { ProjectArtifact } from './pages';
import {
  createProjectArtifactPreview,
  projectArtifactContent,
  projectArtifactDiff,
} from './workbenchProjectPreview';

function artifact(overrides: Partial<ProjectArtifact> = {}): ProjectArtifact {
  return {
    id: 'artifact-1',
    name: 'notes.md',
    ...overrides,
  } as ProjectArtifact;
}

describe('workbenchProjectPreview', () => {
  it('builds markdown project artifact previews with content and diff', () => {
    const preview = createProjectArtifactPreview('project-1', artifact({ name: 'notes.md' }));

    expect(preview.id).toBe('project:project-1:artifact-1');
    expect(preview.name).toBe('notes.md');
    expect(preview.type).toBe('md');
    expect(preview.owner).toBe('AgentHub');
    expect(preview.sourceLabel).toBe('项目产物 / project-1');
    expect(preview.content).toContain('# notes.md');
    expect(preview.content).toContain('项目：project-1');
    expect(preview.diffContent).toContain('diff --git a/notes.md b/notes.md');
  });

  it('renders spreadsheet previews as markdown tables without diffs', () => {
    const preview = createProjectArtifactPreview('project-2', artifact({
      id: 'sheet-1',
      name: 'metrics.xlsx',
    }));

    expect(preview.type).toBe('xlsx');
    expect(preview.content).toContain('| 项目 | 已索引 | project-2 |');
    expect(preview.diffContent).toBeUndefined();
    expect(projectArtifactDiff('metrics.xlsx', 'xlsx')).toBeUndefined();
  });

  it('falls back to readonly code preview for unknown file types', () => {
    const content = projectArtifactContent('project-3', 'main.ts', 'ts');

    expect(content).toContain('// main.ts');
    expect(content).toContain('projectId: "project-3"');
    expect(projectArtifactDiff('main.ts', 'ts')).toContain('+main.ts');
  });

  it('defaults missing artifact names to artifact.txt', () => {
    const preview = createProjectArtifactPreview('project-4', artifact({
      id: 'blank',
      name: undefined as unknown as string,
    }));

    expect(preview.name).toBe('artifact.txt');
    expect(preview.type).toBe('txt');
  });
});
