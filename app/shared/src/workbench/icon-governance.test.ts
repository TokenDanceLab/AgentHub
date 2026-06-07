import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKBENCH_ROOT = dirname(fileURLToPath(import.meta.url));
const ICON_REGISTRY = join(WORKBENCH_ROOT, 'designIcons.tsx');
const TEST_FILES = new Set([
  'designIcons.test.tsx',
  'icon-governance.test.ts',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return sourceFiles(path);
    if (!/\.(ts|tsx)$/.test(entry)) return [];
    if (TEST_FILES.has(entry)) return [];
    return [path];
  });
}

function cssModuleFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return cssModuleFiles(path);
    return /\.module\.css$/.test(entry) ? [path] : [];
  });
}

describe('workbench icon governance', () => {
  it('keeps Workbench icons behind the design icon registry', () => {
    const offenders = sourceFiles(WORKBENCH_ROOT).flatMap((path) => {
      if (path === ICON_REGISTRY) return [];
      const source = readFileSync(path, 'utf8');
      const hasDirectSvg = /<svg[\s>]/.test(source);
      const hasExternalIconImport = /from ['"](?:lucide-react|@lobehub\/icons|react-icons[^'"]*)['"]/.test(source);
      return hasDirectSvg || hasExternalIconImport
        ? [`${relative(WORKBENCH_ROOT, path)}${hasDirectSvg ? ' uses <svg>' : ''}${hasExternalIconImport ? ' imports external icons' : ''}`]
        : [];
    });

    expect(offenders).toEqual([]);
  });

  it('keeps Workbench file icon CSS compatible with the design demo', () => {
    const offenders = cssModuleFiles(WORKBENCH_ROOT).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      if (!/\.fileIcon\s*\{/.test(source)) return [];
      const relativePath = relative(WORKBENCH_ROOT, path);
      const fileIconBlocks = Array.from(source.matchAll(/\.fileIcon\s*\{(?<body>[^}]*)\}/g));
      return fileIconBlocks.flatMap((match) => {
        const body = match.groups?.body ?? '';
        const issues = [];
        if (/border-radius\s*:\s*0\b/.test(body)) issues.push('uses border-radius: 0');
        if (/color\s*:[^;]+!important/.test(body)) issues.push('overrides design icon color');
        return issues.map((issue) => `${relativePath} ${issue}`);
      });
    });

    expect(offenders).toEqual([]);
  });
});
