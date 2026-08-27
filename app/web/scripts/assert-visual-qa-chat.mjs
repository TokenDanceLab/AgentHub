/**
 * CI assert for visual:qa:chat captures (#1940).
 *
 * Chat-half companion of assert-visual-qa-shell.mjs. Checks:
 * - expected light/dark chat PNGs exist under screenshots/visual-qa/
 * - each file is above a byte floor (non-blank / not empty placeholder)
 * - a DOM/geometry contract (web-chat-<theme>-1440x810.json emitted by
 *   visual-qa-chat.mjs) proves the capture hit the chat content surface:
 *   transcript log, one user message, one fenced code block message, one
 *   completed tool card, streaming-ENDED state (no typing indicator, Send
 *   not Stop), no horizontal overflow. No pixel goldens.
 *
 * Usage (from app/web):
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
  'web-chat-light-1440x810.png',
  'web-chat-dark-1440x810.png',
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
  const contractNames = names.filter(function (n) { return /^web-chat-.*\.json$/.test(n); });
  if (contractNames.length === 0) {
    failures.push('no DOM/geometry contract found (expected web-chat-*.json next to PNGs)');
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
  // transcript + user message + fenced code block + completed tool card +
  // streaming-ended composer state.
  for (const theme of ['light', 'dark']) {
    const name = 'web-chat-' + theme + '-1440x810.json';
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
    positiveBox(contract.chatLog, 'chat transcript log', failures, name);
    if (!(contract.userMessage?.count > 0)) {
      failures.push(name + ': no user message bubble captured');
    }
    positiveBox(contract.codeBlock, 'fenced code block message', failures, name);
    positiveBox(contract.toolCard, 'tool card', failures, name);
    const ended = contract.streamingEnded;
    if (!ended) {
      failures.push(name + ': streamingEnded contract missing');
    } else {
      if (ended.typingIndicator !== false) {
        failures.push(name + ': typing indicator still visible (streaming not ended)');
      }
      if (ended.sendVisible !== true) {
        failures.push(name + ': Send control not visible in streaming-ended state');
      }
      if (ended.stopVisible !== false) {
        failures.push(name + ': Stop control visible (streaming still running)');
      }
    }
  }

  // UX F8 goal scene (#1998): every goal contract must prove the banner
  // rendered with positive geometry in the active state.
  const goalContractNames = contractNames.filter(function (n) { return /^web-chat-goal-.*\.json$/.test(n); });
  if (goalContractNames.length === 0) {
    failures.push('no goal-scene contracts found (expected web-chat-goal-*.json)');
  }
  for (const name of goalContractNames) {
    const contract = JSON.parse(await readFile(path.join(outDir, name), 'utf8'));
    if (!contract.goalBanner || contract.goalBanner.exists !== true) {
      failures.push(name + ': goal banner not captured');
    } else if (!(contract.goalBanner.width > 0) || !(contract.goalBanner.height > 0)) {
      failures.push(name + ': goal banner has a zero-size box (' + contract.goalBanner.width + 'x' + contract.goalBanner.height + ')');
    }
    if (contract.goalStatus !== 'active') {
      failures.push(name + ': expected active goal status, got ' + (contract.goalStatus || '(none)'));
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
