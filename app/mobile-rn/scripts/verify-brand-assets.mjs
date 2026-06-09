import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const legacyTokenDancePattern = new RegExp(`${['token', 'dance'].join('-')}[-/]`, 'i');
const forbiddenOrgAssetPattern = new RegExp(
  String.raw`(?:^|[\\/])${'token' + 'dance'}-[^\\/]+(?:\.png|\.jpg|\.jpeg|\.webp|\.svg|\.ico)`,
  'i',
);
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
const scannedTextFiles = [
  'README.md',
  'docs/handoff.md',
  'app.config.ts',
];

const checks = [];
const appConfigSource = await readProjectText('app.config.ts');

for (const asset of requiredAssets) {
  await checkFileExists(`AgentHub asset exists: ${asset}`, asset);
}

for (const ref of requiredConfigRefs) {
  check(`Expo config references ${ref}`, appConfigSource.includes(ref));
}

const assetEntries = await readdir(path.join(projectRoot, 'assets'));
check('All checked-in mobile app assets use agenthub-* names', assetEntries.every((name) => name.startsWith('agenthub-')));
check('Mobile app config has no legacy TokenDance asset filename references', !legacyTokenDancePattern.test(appConfigSource));
check('Mobile app config has no TokenDance org logo asset references', !forbiddenOrgAssetPattern.test(appConfigSource));

for (const file of scannedTextFiles) {
  const source = await readProjectText(file);
  check(`${file} has no legacy TokenDance asset filename references`, !legacyTokenDancePattern.test(source));
  check(`${file} has no TokenDance org logo asset references`, !forbiddenOrgAssetPattern.test(source));
}

const failures = checks.filter((item) => !item.ok);
process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`);

if (failures.length > 0) {
  process.stderr.write(`Brand asset verification failed:\n${failures.map((item) => `- ${item.name}`).join('\n')}\n`);
  process.exitCode = 1;
}

function check(name, ok) {
  checks.push({ name, ok: Boolean(ok) });
}

async function checkFileExists(name, relativePath) {
  try {
    await access(path.join(projectRoot, relativePath));
    check(name, true);
  } catch {
    check(name, false);
  }
}

async function readProjectText(relativePath) {
  return readFile(path.join(projectRoot, relativePath), 'utf8');
}
