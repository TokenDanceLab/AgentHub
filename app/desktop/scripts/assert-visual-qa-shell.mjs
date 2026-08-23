/**
 * CI assert for desktop visual:qa:shell captures (#1827).
 *
 * Desktop half of the web script (app/web/scripts/assert-visual-qa-shell.mjs).
 * Checks:
 * - expected light/dark PNGs exist under screenshots/visual-qa/
 * - each file is above a byte floor (non-blank / not empty placeholder)
 * - does NOT compare pixel goldens
 *
 * Usage (from app/desktop):
 *   node scripts/assert-visual-qa-shell.mjs
 *   pnpm --filter agenthub-desktop assert:visual:qa:shell
 * Env:
 *   VISUAL_QA_SHELL_MIN_BYTES (default 8000)
 *   VISUAL_QA_SHELL_OUT_DIR   (optional override)
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = process.env.VISUAL_QA_SHELL_OUT_DIR
  ? path.resolve(process.env.VISUAL_QA_SHELL_OUT_DIR)
  : path.join(projectRoot, 'screenshots', 'visual-qa');
const minBytes = Number(process.env.VISUAL_QA_SHELL_MIN_BYTES ?? 8000);
const expected = ['desktop-shell-light-1440x810.png', 'desktop-shell-dark-1440x810.png'];

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

  const diag = names.filter(function (n) { return n.includes('DIAGNOSTIC'); });
  if (diag.length > 0) {
    console.warn('warn: diagnostic captures present: ' + diag.join(', '));
  }

  if (failures.length > 0) {
    const details = failures.map(function (f) { return '  - ' + f; }).join(String.fromCharCode(10));
    throw new Error(
      'visual:qa:shell assert failed (non-blank + required shells only; no pixel golden):' +
        String.fromCharCode(10) +
        details,
    );
  }

  console.log(
    'visual:qa:shell assert ok (' + expected.length + ' shots, min ' + minBytes + ' bytes) -> ' + outDir,
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
