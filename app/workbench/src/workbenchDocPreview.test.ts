import { describe, expect, it } from 'vitest';
import type { DocRow } from './pages';
import { createDocPreview } from './workbenchDocPreview';

function doc(overrides: Partial<DocRow> = {}): DocRow {
  return {
    id: 'doc-1',
    title: 'Release Notes',
    owner: 'Alice',
    location: 'Workspace / Docs',
    time: '今天 10:00',
    ...overrides,
  } as DocRow;
}

describe('workbenchDocPreview', () => {
  it('builds document previews with markdown content and inferred filename', () => {
    const preview = createDocPreview(doc({ tag: 'release' }));

    expect(preview.id).toBe('doc:doc-1');
    expect(preview.name).toBe('Release Notes.md');
    expect(preview.type).toBe('md');
    expect(preview.owner).toBe('Alice');
    expect(preview.sourceLabel).toBe('Workspace / Docs');
    expect(preview.content).toContain('# Release Notes');
    expect(preview.content).toContain('- 所有者：Alice');
    expect(preview.content).toContain('- 标签：release');
  });

  it('marks untagged documents as 未标记', () => {
    const preview = createDocPreview(doc({ tag: undefined as unknown as string }));

    expect(preview.content).toContain('- 标签：未标记');
  });

  it('preserves titles that already include an extension', () => {
    const preview = createDocPreview(doc({
      id: 'doc-2',
      title: 'metrics.xlsx',
    }));

    expect(preview.name).toBe('metrics.xlsx');
    expect(preview.type).toBe('xlsx');
  });
});
