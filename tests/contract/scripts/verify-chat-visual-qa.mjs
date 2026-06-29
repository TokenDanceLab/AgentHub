#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const repoRoot = path.resolve(parseRepoRoot(process.argv.slice(2)));
const desktopScriptPath = path.join(repoRoot, 'app', 'desktop', 'scripts', 'manual-chat-flow-check.mjs');
const webScriptPath = path.join(repoRoot, 'app', 'web', 'scripts', 'manual-chat-flow-check.mjs');
const acceptancePath = path.join(repoRoot, 'scripts', 'verify', 'chat-acceptance.mjs');
let failed = 0;

assertVisualScriptContract('Desktop', desktopScriptPath, {
  surface: 'desktop',
  screenshot: 'desktop-1440x810-chat-flow.png',
  metrics: 'desktop-1440x810-chat-flow.metrics.json',
  report: 'desktop-chat-flow-visual-qa.json',
});

assertVisualScriptContract('Web', webScriptPath, {
  surface: 'web',
  screenshot: 'web-1440x810-chat-flow.png',
  metrics: 'web-1440x810-chat-flow.metrics.json',
  report: 'web-chat-flow-visual-qa.json',
});

assertAcceptanceContract(acceptancePath);

process.exit(failed > 0 ? 1 : 0);

function assertVisualScriptContract(label, scriptPath, expected) {
  assert(fs.existsSync(scriptPath), `${label} Visual QA script exists`);
  if (!fs.existsSync(scriptPath)) return;

  const script = fs.readFileSync(scriptPath, 'utf8');
  assert(script.includes(expected.screenshot), `${label} script keeps stable screenshot path`);
  assert(script.includes(expected.metrics), `${label} script writes stable metrics path`);
  assert(script.includes(expected.report), `${label} script writes stable report path`);
  assert(script.includes('agenthub.chat_visual_qa.v1'), `${label} script writes stable report schema`);
  assert(script.includes(`surface: '${expected.surface}'`), `${label} report records ${expected.surface} surface`);
  assert(script.includes('metricsPath'), `${label} report includes metricsPath`);
  assert(script.includes('reportPath'), `${label} report includes reportPath`);
  assert(script.includes('inspection'), `${label} report includes concise inspection instructions`);
  assert(script.includes('real_tested: false'), `${label} report records real_tested=false`);
  assert(script.includes('evidence_level: \'visual-qa\''), `${label} report records visual-qa evidence level`);
  assert(script.includes('fs.writeFileSync(metricsPath'), `${label} script persists metrics JSON`);
  assert(script.includes('fs.writeFileSync(reportPath'), `${label} script persists report JSON`);
  assert(script.includes('Visual QA screenshot:'), `${label} stdout prints screenshot path`);
  assert(script.includes('Visual QA metrics:'), `${label} stdout prints metrics path`);
  assert(script.includes('Visual QA report:'), `${label} stdout prints report path`);
  assert(!/real_tested:\s*true|approved-real.+real_tested:\s*true|pnpm\s+tauri\s+build/i.test(script), `${label} script does not claim approved-real or packaged Desktop evidence`);
}

function assertAcceptanceContract(scriptPath) {
  assert(fs.existsSync(scriptPath), 'chat acceptance runner exists');
  if (!fs.existsSync(scriptPath)) return;

  const script = fs.readFileSync(scriptPath, 'utf8');
  for (const artifact of [
    'desktop-1440x810-chat-flow.png',
    'desktop-1440x810-chat-flow.metrics.json',
    'desktop-chat-flow-visual-qa.json',
    'web-1440x810-chat-flow.png',
    'web-1440x810-chat-flow.metrics.json',
    'web-chat-flow-visual-qa.json',
  ]) {
    assert(script.includes(artifact), `chat acceptance manifest includes ${artifact}`);
  }
}

function assert(condition, message) {
  if (condition) {
    console.log(`PASS: ${message}`);
    return;
  }
  failed += 1;
  console.error(`FAIL: ${message}`);
}

function parseRepoRoot(args) {
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--repo-root' || args[i] === '-RepoRoot') {
      return args[i + 1];
    }
  }
  return '.';
}
