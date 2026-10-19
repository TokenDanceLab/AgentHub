import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourceRoot = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(sourceRoot, '..');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const explicitScanFiles = [
  path.join(projectRoot, 'app.config.ts'),
  path.join(projectRoot, 'eas.json'),
  path.join(projectRoot, 'README.md'),
];
const scanRoots = [
  sourceRoot,
  path.join(projectRoot, 'scripts'),
];
const pemBoundaryPrefix = ['-----', 'BEGIN'].join('');
const privateKeyBlockTerm = ['PRIVATE', 'KEY'].join(' ');
const realNameMarker = ['真实', '姓名'].join('');
const realNameEnglish = ['real', 'name'].join(' ');
const forbiddenSecretPatterns = [
  { label: 'authorization_bearer', pattern: /Authorization:\s*Bearer\s+[A-Za-z0-9._~+/=-]+/i },
  { label: 'access_token', pattern: /\baccess_token\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { label: 'refresh_token', pattern: /\brefresh_token\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { label: 'session_token', pattern: /\bsession_token\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { label: 'api_key', pattern: /\bapi[_-]?key\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { label: 'password', pattern: /\bpassword\s*[=:]\s*['"]?[^'"\s,}]{8,}/i },
  { label: 'client_secret', pattern: /\bclient_secret\s*[=:]\s*['"]?[A-Za-z0-9._~+/=-]{8,}/i },
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { label: 'private_key', pattern: new RegExp(`${pemBoundaryPrefix} [A-Z ]*${privateKeyBlockTerm}-----`) },
  { label: 'real_name_marker', pattern: new RegExp(`(${realNameMarker}|${realNameEnglish})`, 'i') },
];

describe('AgentHub mobile privacy sanitization', () => {
  it('keeps scanned source, docs, config, and scripts free of inline secrets', async () => {
    const files = await listScanFiles();
    const findings: string[] = [];

    for (const file of files) {
      const content = await readFile(file, 'utf8');
      for (const { label, pattern } of forbiddenSecretPatterns) {
        if (pattern.test(content)) {
          findings.push(`${path.relative(projectRoot, file)}: ${label}`);
        }
      }
    }

    expect(findings).toEqual([]);
  });
});

async function listScanFiles(): Promise<string[]> {
  const rootFiles = await Promise.all(scanRoots.map((root) => listSourceFiles(root)));
  const existingExplicitFiles = [];

  for (const file of explicitScanFiles) {
    try {
      await readFile(file, 'utf8');
      existingExplicitFiles.push(file);
    } catch {
      // Optional config files are scanned when present.
    }
  }

  return [...rootFiles.flat(), ...existingExplicitFiles];
}

async function listSourceFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(root, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(entryPath);
      }

      if (entry.isFile() && sourceExtensions.has(path.extname(entry.name))) {
        return [entryPath];
      }

      return [];
    }),
  );

  return files.flat();
}
