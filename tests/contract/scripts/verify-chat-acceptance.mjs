#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(parseRepoRoot(process.argv.slice(2)));
const scriptPath = path.join(repoRoot, 'scripts', 'verify', 'chat-acceptance.mjs');
const appPackagePath = path.join(repoRoot, 'app', 'package.json');
const desktopPackagePath = path.join(repoRoot, 'app', 'desktop', 'package.json');
const webPackagePath = path.join(repoRoot, 'app', 'web', 'package.json');
const tmpRoot = path.join(repoRoot, '.tmp', 'chat-acceptance', `script-test-${process.pid}`);
let failed = 0;

assert(fs.existsSync(scriptPath), 'chat acceptance runner exists');
assert(fs.existsSync(appPackagePath), 'app package exists');
assert(fs.existsSync(desktopPackagePath), 'desktop package exists');
assert(fs.existsSync(webPackagePath), 'web package exists');

try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  fs.mkdirSync(tmpRoot, { recursive: true });

  const scriptText = fs.readFileSync(scriptPath, 'utf8');
  assert(scriptText.includes('agenthub.chat_acceptance_bundle.v1'), 'runner writes stable chat acceptance schema');
  for (const row of [
    'shared-chat-unit',
    'desktop-chat-playwright',
    'web-chat-playwright',
    'desktop-chat-visual-qa',
    'web-chat-visual-qa',
  ]) {
    assert(scriptText.includes(row), `runner includes ${row} row`);
  }
  for (const level of ['fixture-unit', 'playwright-ui', 'visual-qa']) {
    assert(scriptText.includes(level), `runner records ${level} evidence`);
  }
  assert(scriptText.includes('real_tested: false'), 'runner records real_tested=false');
  assert(scriptText.includes('packaged Tauri/Desktop installer'), 'runner names packaged Desktop exclusion');
  assert(!/real_tested:\s*true|real_tested\s*=\s*\$true|-RealTested\s+\$true/.test(scriptText), 'runner never sets real_tested=true');
  assert(!/pnpm\s+tauri\s+build|gh\s+release\s+upload|TAURI_SIGNING_PRIVATE_KEY/.test(scriptText), 'runner does not run package/sign/release commands');

  const outputPath = path.join(tmpRoot, 'chat-acceptance-manifest.json');
  const run = spawnSync(process.execPath, [
    scriptPath,
    '--repo-root', repoRoot,
    '--artifact-root', tmpRoot,
    '--output-path', outputPath,
    '--skip-shared-unit',
    '--skip-desktop-playwright',
    '--skip-web-playwright',
    '--skip-desktop-visual-qa',
    '--skip-web-visual-qa',
  ], { cwd: repoRoot, encoding: 'utf8' });
  assert(run.status === 0, 'runner can write manifest with all rows skipped', `${run.stdout}\n${run.stderr}`);
  assert(fs.existsSync(outputPath), 'runner writes output manifest');

  if (fs.existsSync(outputPath)) {
    const jsonText = fs.readFileSync(outputPath, 'utf8');
    const json = JSON.parse(jsonText);
    assert(json.schema === 'agenthub.chat_acceptance_bundle.v1', 'manifest schema is explicit');
    assert(json.status === 'skipped', 'manifest records skipped status when no gates ran');
    assert(json.real_tested === false, 'manifest records real_tested=false');
    assert(json.boundaries.real_tokendance_id_login === false, 'manifest records no real login');
    assert(json.boundaries.real_cli_or_model_api === false, 'manifest records no real CLI/model/API');
    assert(json.boundaries.packaged_desktop === false, 'manifest records no packaged Desktop');
    assert(json.rows.filter((row) => row.name === 'shared-chat-unit' && row.evidence_level === 'fixture-unit').length === 1, 'manifest has shared unit row');
    assert(json.rows.filter((row) => row.name === 'desktop-chat-playwright' && row.evidence_level === 'playwright-ui').length === 1, 'manifest has Desktop Playwright row');
    assert(json.rows.filter((row) => row.name === 'web-chat-playwright' && row.evidence_level === 'playwright-ui').length === 1, 'manifest has Web Playwright row');
    assert(json.rows.filter((row) => row.name === 'desktop-chat-visual-qa' && row.evidence_level === 'visual-qa').length === 1, 'manifest has Desktop Visual QA row');
    assert(json.rows.filter((row) => row.name === 'web-chat-visual-qa' && row.evidence_level === 'visual-qa').length === 1, 'manifest has Web Visual QA row');
    assert(!/sk-[A-Za-z0-9]|client_secret|Authorization:\s*Bearer/.test(jsonText), 'manifest is redacted');
  }

  const appPackage = JSON.parse(fs.readFileSync(appPackagePath, 'utf8'));
  const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, 'utf8'));
  const webPackage = JSON.parse(fs.readFileSync(webPackagePath, 'utf8'));
  assert(/chat-acceptance\.mjs/.test(appPackage.scripts['test:acceptance:chat-flow'] ?? ''), 'app package exposes Node chat acceptance bundle');
  assert(/test:e2e:chat-flow/.test(desktopPackage.scripts['test:acceptance:chat-flow'] ?? '') && /test:visual:chat-flow/.test(desktopPackage.scripts['test:acceptance:chat-flow'] ?? ''), 'desktop package exposes focused chat acceptance');
  assert(/test:e2e:chat-flow/.test(webPackage.scripts['test:acceptance:chat-flow'] ?? '') && /test:visual:chat-flow/.test(webPackage.scripts['test:acceptance:chat-flow'] ?? ''), 'web package exposes focused chat acceptance');
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

process.exit(failed > 0 ? 1 : 0);

function assert(condition, message, details = '') {
  if (condition) {
    console.log(`PASS: ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
  if (details) console.error(details);
}

function parseRepoRoot(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--repo-root' || args[i] === '-RepoRoot') {
      return args[i + 1];
    }
  }
  return '.';
}
