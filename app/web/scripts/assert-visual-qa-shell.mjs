/**
 * CI assert for visual:qa:shell captures (#1287).
 *
 * Checks:
 * - expected light/dark PNGs exist under screenshots/visual-qa/
 * - each file is above a byte floor (non-blank / not empty placeholder)
 * - a DOM/geometry contract (web-shell-<theme>-<label>.json emitted by
 *   visual-qa-shell.mjs) proves the capture hit the Agents workbench shell
 *   (not an onboarding overlay or blank page) and has no horizontal overflow
 *   (#1866 / #1874). No pixel goldens.
 *
 * Usage (from app/web):
 *   node scripts/assert-visual-qa-shell.mjs
 * Env:
 *   VISUAL_QA_SHELL_MIN_BYTES (default 8000)
 *   VISUAL_QA_SHELL_OUT_DIR   (optional override)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = process.env.VISUAL_QA_SHELL_OUT_DIR
  ? path.resolve(process.env.VISUAL_QA_SHELL_OUT_DIR)
  : path.join(projectRoot, 'screenshots', 'visual-qa');
const minBytes = Number(process.env.VISUAL_QA_SHELL_MIN_BYTES ?? 8000);
const expected = [
  'web-shell-light-1440x810.png',
  'web-shell-dark-1440x810.png',
  'web-shell-light-768x900.png',
  'web-shell-dark-768x900.png',
];

async function readContract(names, name) {
  if (!names.includes(name)) {
    return { name, missing: true };
  }
  const raw = await readFile(path.join(outDir, name), 'utf8');
  const contract = JSON.parse(raw);
  return { name, missing: false, contract };
}

async function main() {
  let names;
  try {
    names = await readdir(outDir);
  } catch (err) {
    throw new Error('visual-qa shell output dir missing: ' + outDir + ' (' + err.message + ')');
  }

  const failures = [];
  for (const name of expected) {
    if (!names.includes(name)) {
      failures.push('missing screenshot: ' + name);
      continue;
    }
    const filePath = path.join(outDir, name);
    const info = await stat(filePath);
    if (!info.isFile()) {
      failures.push('not a file: ' + name);
      continue;
    }
    if (info.size < minBytes) {
      failures.push(
        'blank/undersized screenshot: ' + name + ' is ' + info.size + ' bytes (min ' + minBytes + ')',
      );
      continue;
    }
    console.log('ok ' + name + ' (' + info.size + ' bytes)');
  }

  // Every captured viewport emits a contract. Require the gate shots and fail
  // closed on any horizontal overflow across every captured width (#1866).
  const contractNames = names.filter(function (n) { return /^web-shell-.*\.json$/.test(n); });
  if (contractNames.length === 0) {
    failures.push('no DOM/geometry contract found (expected web-shell-*.json next to PNGs)');
  }
  for (const name of contractNames) {
    const raw = await readFile(path.join(outDir, name), 'utf8');
    let contract;
    try {
      contract = JSON.parse(raw);
    } catch {
      failures.push('unparseable contract: ' + name);
      continue;
    }
    if (contract.horizontalOverflow !== false) {
      failures.push('horizontal overflow captured in ' + name);
    }
  }

  // Gate shots must prove the Agents workbench shell (not onboarding/blank).
  for (const base of ['web-shell-light-1440x810', 'web-shell-dark-1440x810']) {
    const name = base + '.json';
    if (!names.includes(name)) {
      failures.push('missing contract: ' + name);
      continue;
    }
    const contract = JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
    if (contract.workbenchShell !== true) {
      failures.push(name + ': workbench shell not captured');
    }
    if (contract.agentsPage !== true) {
      failures.push(name + ': Agents page not captured');
    }
    // #1874 Slice 3: 三 Pane 几何合同——rail / 已安装列表 / 编辑详情必须真实
    // 存在且宽度 > 0，避免把缺详情面板的空壳或 onboarding 误判为已捕获。
    const panes = contract.panes;
    if (!panes || !panes.rail?.exists || !panes.list?.exists || !panes.detail?.exists) {
      failures.push(name + ': three-pane geometry incomplete (rail/list/detail must exist)');
    } else if (
      !(panes.rail.width > 0) ||
      !(panes.list.width > 0) ||
      !(panes.detail.width > 0)
    ) {
      failures.push(name + ': three-pane geometry has a zero-width pane');
    }
  }

  const diag = names.filter(function (n) { return n.includes('DIAGNOSTIC'); });
  if (diag.length > 0) {
    console.warn('warn: diagnostic captures present: ' + diag.join(', '));
  }

  if (failures.length > 0) {
    const details = failures.map(function (f) { return '  - ' + f; }).join(String.fromCharCode(10));
    throw new Error(
      'visual:qa:shell assert failed (non-blank + DOM/geometry contract; no pixel golden):' +
        String.fromCharCode(10) +
        details,
    );
  }

  console.log(
    'visual:qa:shell assert ok (' + expected.length + ' shots + ' + contractNames.length + ' contracts, min ' + minBytes + ' bytes) -> ' + outDir,
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
