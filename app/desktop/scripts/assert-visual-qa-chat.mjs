/**
 * CI assert for desktop visual:qa:chat captures (#1940).
 *
 * Chat-half companion of assert-visual-qa-shell.mjs (desktop side). Checks:
 * - expected light/dark chat PNGs exist under screenshots/visual-qa/
 * - each file is above a byte floor (non-blank / not empty placeholder)
 * - a DOM/geometry contract (desktop-chat-<theme>-1440x810.json emitted by
 *   visual-qa-chat.mjs) proves the capture hit the chat content surface:
 *   transcript log, at least one completed card row, finished state (no
 *   typing indicator), no onboarding overlay, no horizontal overflow.
 *   No pixel goldens.
 *
 * Fenced code blocks are covered by the web chat lane (stubbed-Hub replay);
 * the shared demo fixtures rendered here carry none (see capture script).
 *
 * Usage (from app/desktop):
 *   node scripts/assert-visual-qa-chat.mjs
 * Env:
 *   VISUAL_QA_CHAT_MIN_BYTES (default 8000)
 *   VISUAL_QA_CHAT_OUT_DIR   (optional override)
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = process.env.VISUAL_QA_CHAT_OUT_DIR
  ? path.resolve(process.env.VISUAL_QA_CHAT_OUT_DIR)
  : path.join(projectRoot, 'screenshots', 'visual-qa');
const minBytes = Number(process.env.VISUAL_QA_CHAT_MIN_BYTES ?? 8000);
const expected = [
  'desktop-chat-light-1440x810.png',
  'desktop-chat-dark-1440x810.png',
];

function positiveBox(value, label, failures, name) {
  if (!value || value.exists !== true) {
    failures.push(name + ': ' + label + ' not captured');
    return;
  }
  if (!(value.width > 0) || !(value.height > 0)) {
    failures.push(name + ': ' + label + ' has a zero-size box (' + value.width + 'x' + value.height + ')');
  }
}

async function main() {
  let names;
  try {
    names = await readdir(outDir);
  } catch (err) {
    throw new Error('visual-qa chat output dir missing: ' + outDir + ' (' + err.message + ')');
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

  // Every captured chat shot emits a contract; fail closed on any horizontal
  // overflow across all of them (same policy as the shell gate).
  const contractNames = names.filter(function (n) { return /^desktop-chat-.*\.json$/.test(n); });
  if (contractNames.length === 0) {
    failures.push('no DOM/geometry contract found (expected desktop-chat-*.json next to PNGs)');
  }
  for (const name of contractNames) {
    let contract;
    try {
      contract = JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
    } catch {
      failures.push('unparseable contract: ' + name);
      continue;
    }
    if (contract.horizontalOverflow !== false) {
      failures.push('horizontal overflow captured in ' + name);
    }
  }

  // Gate shots must prove the chat content surface in both themes:
  // transcript log + completed card rows + finished state (no typing).
  for (const theme of ['light', 'dark']) {
    const name = 'desktop-chat-' + theme + '-1440x810.json';
    if (!names.includes(name)) {
      failures.push('missing contract: ' + name);
      continue;
    }
    const contract = JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
    if (contract.appliedTheme !== theme) {
      failures.push(name + ': theme mismatch (expected ' + theme + ', got ' + contract.appliedTheme + ')');
    }
    if (contract.workbenchShell !== true) {
      failures.push(name + ': workbench shell not captured');
    }
    if (contract.onboardingVisible !== false) {
      failures.push(name + ': onboarding overlay visible (onboarding-seen flag did not take effect)');
    }
    positiveBox(contract.chatLog, 'chat transcript log', failures, name);
    if (!(contract.cardCount > 0)) {
      failures.push(name + ': no transcript card rows captured');
    }
    positiveBox(contract.firstCard, 'first transcript card', failures, name);
    if (contract.streamingEnded?.typingIndicator !== false) {
      failures.push(name + ': typing indicator visible (transcript not in finished state)');
    }
    // UX F8 (#1998): demo builder transcript goal arc must project the banner.
    if (!contract.goalBanner || contract.goalBanner.exists !== true) {
      failures.push(name + ': goal banner not captured');
    } else if (!(contract.goalBanner.width > 0) || !(contract.goalBanner.height > 0)) {
      failures.push(name + ': goal banner has a zero-size box (' + contract.goalBanner.width + 'x' + contract.goalBanner.height + ')');
    }
  }

  const diag = names.filter(function (n) { return n.includes('DIAGNOSTIC'); });
  if (diag.length > 0) {
    console.warn('warn: diagnostic captures present: ' + diag.join(', '));
  }

  if (failures.length > 0) {
    const details = failures.map(function (f) { return '  - ' + f; }).join(String.fromCharCode(10));
    throw new Error(
      'visual:qa:chat assert failed (non-blank + DOM/geometry contract; no pixel golden):' +
        String.fromCharCode(10) +
        details,
    );
  }

  console.log(
    'visual:qa:chat assert ok (' + expected.length + ' shots + ' + contractNames.length + ' contracts, min ' + minBytes + ' bytes) -> ' + outDir,
  );
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
