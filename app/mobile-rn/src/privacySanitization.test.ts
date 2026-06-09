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
  path.join(projectRoot, '..', 'mobile', 'docs', 'mobile-expo-rn-migration-plan.md'),
  path.join(projectRoot, '..', 'mobile', 'docs', 'mobile-v4-plan.md'),
];
const scanRoots = [
  sourceRoot,
  path.join(projectRoot, 'scripts'),
];
const privateTermScanAllowlist = new Set([
  path.join(projectRoot, 'scripts', 'visual-qa.mjs'),
]);
const forbiddenPrivateTerms = [
  String.fromCodePoint(0x5510, 0x4e01),
  String.fromCodePoint(0x5cb3, 0x9e93),
  ['Yue', 'lu'].join(''),
  String.fromCodePoint(0x771f, 0x5b9e, 0x59d3, 0x540d),
  ['real', ' name'].join(''),
];
const pemBoundaryPrefix = ['-----', 'BEGIN'].join('');
const privateKeyBlockTerm = ['PRIVATE', 'KEY'].join(' ');
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
];

describe('AgentHub mobile privacy sanitization', () => {
  it('keeps source fixtures free of private identity placeholders', async () => {
    const files = await listScanFiles();
    const findings: string[] = [];

    for (const file of files) {
      if (privateTermScanAllowlist.has(file)) {
        continue;
      }

      const content = await readFile(file, 'utf8');
      for (const forbiddenTerm of forbiddenPrivateTerms) {
        if (content.includes(forbiddenTerm)) {
          findings.push(`${path.relative(projectRoot, file)}: private_term`);
        }
      }
    }

    expect(findings).toEqual([]);
  });

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
