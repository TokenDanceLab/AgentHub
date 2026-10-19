import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const requiredAssets = [
  'assets/agenthub-icon.png',
  'assets/agenthub-adaptive-icon.png',
  'assets/agenthub-splash-icon.png',
  'assets/agenthub-favicon.png',
  'assets/agenthub-notification-icon.png',
];

const requiredConfigRefs = [
  "icon: './assets/agenthub-icon.png'",
  "image: './assets/agenthub-splash-icon.png'",
  "foregroundImage: './assets/agenthub-adaptive-icon.png'",
  "favicon: './assets/agenthub-favicon.png'",
  "icon: './assets/agenthub-notification-icon.png'",
];

describe('Mobile app contracts', () => {
  it('ships the AgentHub brand assets under agenthub-* names', async () => {
    for (const asset of requiredAssets) {
      await expect(access(path.join(projectRoot, asset))).resolves.toBeUndefined();
    }
    const assets = await readdir(path.join(projectRoot, 'assets'));
    expect(assets.filter((name) => !name.startsWith('agenthub-'))).toEqual([]);
  });

  it('points the Expo config at those assets', async () => {
    const config = await readFile(path.join(projectRoot, 'app.config.ts'), 'utf8');
    for (const reference of requiredConfigRefs) {
      expect(config).toContain(reference);
    }
  });

  it('keeps Metro resolving the @/ alias and the shared workspace package', async () => {
    const metro = await readFile(path.join(projectRoot, 'metro.config.cjs'), 'utf8');
    expect(metro).toContain("moduleName.startsWith('@/')");
    expect(metro).toContain("path.join(__dirname, 'src'");
    expect(metro).toContain('@agenthub/shared');
  });
});
