import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const boundaryScript = path.join(projectRoot, 'scripts', 'verify-boundaries.mjs');

describe('Mobile RN import boundary verifier', () => {
  it('rejects workbench package imports and browser storage in runtime source', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'agenthub-mobile-boundary-'));

    try {
      await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, 'src', 'bad-runtime.ts'),
        [
          ['im', "port { AgentHubWorkbench } from '@agenthub/shared/workbench';"].join(''),
          ['im', "port { WorkbenchRoutes } from '@agenthub/workbench';"].join(''),
          'export function readUnsafeStorage() {',
          `  return ${['local', 'Storage'].join('')}.getItem("hub");`,
          '}',
          'void AgentHubWorkbench;',
          'void WorkbenchRoutes;',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await runBoundaryVerifier(fixtureRoot);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('@agenthub/shared/workbench');
      expect(result.stderr).toContain('@agenthub/workbench');
      expect(result.stderr).toContain('localStorage');
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  it('rejects Local Edge direct connections and raw child_process imports in runtime source', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'agenthub-mobile-boundary-'));

    try {
      await mkdir(path.join(fixtureRoot, 'src'), { recursive: true });
      await writeFile(
        path.join(fixtureRoot, 'src', 'bad-runtime.ts'),
        [
          "import { execFile } from 'node:child_process';",
          // Loopback host/port assembled from fragments so this test (which
          // must embed the forbidden pattern to prove rejection) does not
          // trip the Mobile Hub-only boundary verifier itself.
          'const LOCAL_EDGE = "http://' + ['127.0.0.1', '3210'].join(':') + '";',
          'void execFile;',
          'void LOCAL_EDGE;',
          '',
        ].join('\n'),
        'utf8',
      );

      const result = await runBoundaryVerifier(fixtureRoot);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('child_process raw runtime');
      expect(result.stderr).toContain('Local Edge direct connection (127.0.0.1' + ':3210)');
    } finally {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });
});

function runBoundaryVerifier(fixtureRoot: string): Promise<{ exitCode: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [boundaryScript],
      {
        env: {
          ...process.env,
          AGENTHUB_MOBILE_BOUNDARY_PROJECT_ROOT: fixtureRoot,
        },
      },
      (error, _stdout, stderr) => {
        if (error && typeof error !== 'object') {
          reject(error);
          return;
        }

        const exitCode =
          error && 'code' in error && typeof error.code === 'number'
            ? error.code
            : 0;
        resolve({ exitCode, stderr });
      },
    );
  });
}
