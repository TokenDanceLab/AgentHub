import { describe, expect, it } from 'vitest';
import {
  createMockPlatform,
  createMockWorkspaceFilesPort,
  createMockWorkspaceGitPort,
} from './createMockPlatform';

describe('workspace host ports (#1191)', () => {
  it('mock files port lists seeded entries', async () => {
    const files = createMockWorkspaceFilesPort([
      { path: 'src/a.ts', kind: 'file' },
      { path: 'src', kind: 'dir' },
    ]);
    await expect(files.list?.()).resolves.toHaveLength(2);
  });

  it('mock git port lists changes and log', async () => {
    const git = createMockWorkspaceGitPort({
      changes: [{ path: 'a.ts', status: 'M' }],
      commits: [{ hash: 'abcdef123', subject: 'init' }],
    });
    await expect(git.listChanges?.()).resolves.toEqual([{ path: 'a.ts', status: 'M' }]);
    await expect(git.listLog?.(undefined, 1)).resolves.toEqual([
      { hash: 'abcdef123', subject: 'init' },
    ]);
  });

  it('createMockPlatform accepts workspace ports on seed', async () => {
    const platform = createMockPlatform({
      workspaceFiles: createMockWorkspaceFilesPort([{ path: 'x', kind: 'file' }]),
      workspaceGit: createMockWorkspaceGitPort({
        changes: [{ path: 'x', status: 'A' }],
      }),
    });
    await expect(platform.workspaceFiles?.list?.()).resolves.toHaveLength(1);
    await expect(platform.workspaceGit?.listChanges?.()).resolves.toHaveLength(1);
  });
});
