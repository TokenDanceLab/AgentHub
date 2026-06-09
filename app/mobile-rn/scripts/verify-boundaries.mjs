import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = process.env.AGENTHUB_MOBILE_BOUNDARY_PROJECT_ROOT
  ? path.resolve(process.env.AGENTHUB_MOBILE_BOUNDARY_PROJECT_ROOT)
  : path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const scriptsRoot = path.join(projectRoot, 'scripts');
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']);
const runtimeFilePattern = /\.(?:ts|tsx|js|jsx|mjs)$/;
const testFilePattern = /(?:\.test|\.spec)\.(?:ts|tsx|js|jsx|mjs)$/;
const runtimeSecretAllowlist = new Set([
  'src/api/hubClient.ts',
]);

const allowedSharedImports = new Set([
  '@agenthub/shared/designTokens',
  '@agenthub/shared/transcript',
]);

const forbiddenImportFragments = [
  'react-dom',
  '@tauri-apps/',
  '.module.css',
  '@agenthub/shared/ui',
  '@agenthub/shared/workbench',
];

const forbiddenRuntimePatterns = [
  { pattern: /\blocalStorage\b/, label: 'localStorage' },
  { pattern: /\bsessionStorage\b/, label: 'sessionStorage' },
  { pattern: /\bdocument\./, label: 'document' },
  { pattern: /\bwindow\./, label: 'window' },
  { pattern: /\baccess_token\b/, label: 'access_token in runtime source' },
  { pattern: /\bid_token\b/, label: 'id_token in runtime source' },
  { pattern: /\bproviderAccessToken\b/, label: 'providerAccessToken in runtime source' },
  { pattern: /\bclient_secret\b/, label: 'client_secret in runtime source' },
];

const importPattern = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g;

const files = [
  ...(await listSourceFiles(sourceRoot)),
  ...(await listSourceFiles(scriptsRoot)),
];
const failures = [];
const isOverrideProjectRoot = Boolean(process.env.AGENTHUB_MOBILE_BOUNDARY_PROJECT_ROOT);
const metroConfigSource = await readOptionalText(path.join(projectRoot, 'metro.config.cjs'));

if (metroConfigSource === null) {
  if (!isOverrideProjectRoot) {
    failures.push('metro.config.cjs: missing Metro config for Mobile RN runtime aliases');
  }
} else {
  if (!metroConfigSource.includes("moduleName.startsWith('@/')")) {
    failures.push('metro.config.cjs: Metro must resolve the @/ alias used by runtime source imports');
  }

  if (!metroConfigSource.includes("path.join(__dirname, 'src'")) {
    failures.push('metro.config.cjs: Metro @/ alias must resolve into the mobile-rn src directory');
  }
}

for (const file of files) {
  const relativePath = path.relative(projectRoot, file).replaceAll(path.sep, '/');
  const content = await readFile(file, 'utf8');

  for (const match of content.matchAll(importPattern)) {
    const specifier = match[1];

    if (!specifier) {
      continue;
    }

    if (specifier.startsWith('@agenthub/shared') && !allowedSharedImports.has(specifier)) {
      failures.push(`${relativePath}: shared import must be RN-safe and explicitly allowed (${specifier})`);
    }

    for (const fragment of forbiddenImportFragments) {
      if (specifier.includes(fragment)) {
        failures.push(`${relativePath}: forbidden Mobile RN import (${specifier})`);
      }
    }
  }

  const isAppRuntimeSource = file.startsWith(sourceRoot);

  if (
    isAppRuntimeSource
    &&
    !testFilePattern.test(file)
    && runtimeFilePattern.test(file)
    && !runtimeSecretAllowlist.has(relativePath)
  ) {
    for (const { pattern, label } of forbiddenRuntimePatterns) {
      if (pattern.test(content)) {
        failures.push(`${relativePath}: forbidden runtime boundary token (${label})`);
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join('\n')}\n`);
  process.exitCode = 1;
}

async function listSourceFiles(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const filesInDirectory = await Promise.all(
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

  return filesInDirectory.flat();
}

async function readOptionalText(file) {
  try {
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}
