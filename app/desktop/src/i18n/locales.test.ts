import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import en from './locales/en.json';
import zh from './locales/zh.json';

const srcRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settingsRoots = [
  join(srcRoot, 'components', 'SettingsPage.tsx'),
  join(srcRoot, 'components', 'settings'),
];

const runtimeSettingsKeys = [
  'settings.dataCategory.settings',
  'settings.dataCategory.modelSettings',
  'settings.dataCategory.appearance',
  'settings.dataCategory.auth',
  'settings.dataCategory.device',
  'settings.dataCategory.config',
  'settings.dataCategory.shortcuts',
  'settings.dataCategory.agents',
  'settings.dataCategory.workspace',
  'settings.dataCategory.draft',
  'settings.dataCategory.offlineQueue',
  'settings.dataCategory.threadState',
  'settings.dataCategory.uiState',
  'settings.dataCategory.promptCache',
  'settings.dataCategory.other',
];

function listSourceFiles(path: string): string[] {
  const stat = statSync(path);
  if (stat.isFile()) {
    return /\.(ts|tsx)$/.test(path) && !/\.(test|spec|stories)\.(ts|tsx)$/.test(path) ? [path] : [];
  }

  return readdirSync(path).flatMap((entry) => listSourceFiles(join(path, entry)));
}

function collectStaticSettingsKeys(): string[] {
  const keys = new Set<string>();
  const callPattern = /\bt\(\s*['"]([^'"]+)['"]/g;

  for (const file of settingsRoots.flatMap(listSourceFiles)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(callPattern)) {
      const key = match[1];
      if (key) keys.add(key);
    }
  }

  for (const key of runtimeSettingsKeys) keys.add(key);
  return [...keys].sort();
}

describe('Desktop settings i18n locales', () => {
  it('defines every static settings translation key in zh and en', () => {
    const keys = collectStaticSettingsKeys();
    const zhKeys = new Set(Object.keys(zh));
    const enKeys = new Set(Object.keys(en));

    expect(keys.filter((key) => !zhKeys.has(key))).toEqual([]);
    expect(keys.filter((key) => !enKeys.has(key))).toEqual([]);
  });

  it('does not render settings keys as their own fallback text', () => {
    for (const key of collectStaticSettingsKeys()) {
      expect(zh[key as keyof typeof zh], `zh ${key}`).toBeTruthy();
      expect(en[key as keyof typeof en], `en ${key}`).toBeTruthy();
      expect(zh[key as keyof typeof zh], `zh ${key}`).not.toBe(key);
      expect(en[key as keyof typeof en], `en ${key}`).not.toBe(key);
    }
  });
});
