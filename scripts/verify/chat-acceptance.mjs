#!/usr/bin/env node
/*
 * Focused chat workflow acceptance bundle.
 *
 * Runs the merge-useful Desktop/Web chat gates and writes a machine-readable
 * manifest. This is Vite/browser/fixture evidence only unless a future task
 * adds a separate approved-real or packaged-release row.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = parseArgs(process.argv.slice(2));
const repoRoot = path.resolve(args.repoRoot ?? '.');
const artifactRoot = path.resolve(repoRoot, args.artifactRoot ?? path.join('.tmp', 'chat-acceptance', `run-${process.pid}`));
const outputPath = path.resolve(repoRoot, args.outputPath ?? path.join(path.relative(repoRoot, artifactRoot), 'chat-acceptance-manifest.json'));
const timeoutMs = Number(args.commandTimeoutSec ?? 300) * 1000;

fs.mkdirSync(artifactRoot, { recursive: true });

const startedAt = new Date();
const corepack = process.platform === 'win32' ? 'corepack.cmd' : 'corepack';

const rows = [];

const sharedUnitTests = [
  'src/chatview/adapter.test.ts',
  'src/chatview/components/AgentGroup.rendering.test.tsx',
  'src/chatview/components/UserMessage.rendering.test.tsx',
  'src/chatview/components/Transcript.autoscroll.test.tsx',
  'src/chatview/components/Transcript.css.test.ts',
  'src/transcript/runtimeDiagnostics.test.ts',
  'src/workbench/AgentHubWorkbench.test.tsx',
];

await runGate({
  name: 'shared-chat-unit',
  surface: 'shared',
  evidenceLevel: 'fixture-unit',
  claim: 'Shared transcript ordering, optimistic send, markdown/table, diagnostic filtering, and card grouping unit coverage',
  cwd: path.join(repoRoot, 'app', 'shared'),
  command: corepack,
  args: ['pnpm', '--dir', path.join(repoRoot, 'app', 'shared'), 'exec', 'vitest', 'run', ...sharedUnitTests],
  skip: args.skipSharedUnit,
  skipReason: 'skipped by --skip-shared-unit',
});

await runGate({
  name: 'desktop-chat-playwright',
  surface: 'desktop',
  evidenceLevel: 'playwright-ui',
  claim: 'Desktop Vite renderer chat flow Playwright coverage; not packaged Desktop',
  cwd: path.join(repoRoot, 'app', 'desktop'),
  command: corepack,
  args: ['pnpm', '--dir', path.join(repoRoot, 'app', 'desktop'), 'run', 'test:e2e:chat-flow'],
  skip: args.skipDesktopPlaywright,
  skipReason: 'skipped by --skip-desktop-playwright',
});

await runGate({
  name: 'web-chat-playwright',
  surface: 'web',
  evidenceLevel: 'playwright-ui',
  claim: 'Web Vite renderer chat flow Playwright coverage; Hub-shaped stubs are not real login or model execution',
  cwd: path.join(repoRoot, 'app', 'web'),
  command: corepack,
  args: ['pnpm', '--dir', path.join(repoRoot, 'app', 'web'), 'run', 'test:e2e:chat-flow'],
  skip: args.skipWebPlaywright,
  skipReason: 'skipped by --skip-web-playwright',
});

await runGate({
  name: 'desktop-chat-visual-qa',
  surface: 'desktop',
  evidenceLevel: 'visual-qa',
  claim: 'Desktop chat Visual QA screenshot and geometry checks at 1440x810',
  cwd: path.join(repoRoot, 'app', 'desktop'),
  command: corepack,
  args: ['pnpm', '--dir', path.join(repoRoot, 'app', 'desktop'), 'run', 'test:visual:chat-flow'],
  artifacts: ['app/desktop/.tmp/manual-chat-flow-uiux/desktop-1440x810-chat-flow.png'],
  skip: args.skipDesktopVisualQa,
  skipReason: 'skipped by --skip-desktop-visual-qa',
});

await runGate({
  name: 'web-chat-visual-qa',
  surface: 'web',
  evidenceLevel: 'visual-qa',
  claim: 'Web chat Visual QA screenshot and geometry checks at 1440x810',
  cwd: path.join(repoRoot, 'app', 'web'),
  command: corepack,
  args: ['pnpm', '--dir', path.join(repoRoot, 'app', 'web'), 'run', 'test:visual:chat-flow'],
  artifacts: ['app/web/.tmp/manual-chat-flow-uiux/web-1440x810-chat-flow.png'],
  skip: args.skipWebVisualQa,
  skipReason: 'skipped by --skip-web-visual-qa',
});

const endedAt = new Date();
const counts = {
  passed: rows.filter((row) => row.status === 'passed').length,
  failed: rows.filter((row) => row.status === 'failed').length,
  skipped: rows.filter((row) => row.status === 'skipped').length,
  total: rows.length,
};
const status = counts.failed > 0 ? 'failed' : counts.passed === 0 ? 'skipped' : counts.skipped > 0 ? 'passed_with_skips' : 'passed';
const executedRows = rows.filter((row) => row.status !== 'skipped');
const manifest = {
  schema: 'agenthub.chat_acceptance_bundle.v1',
  status,
  real_tested: false,
  evidence_levels: unique(executedRows.map((row) => row.evidence_level)),
  planned_evidence_levels: unique(rows.map((row) => row.evidence_level)),
  generated_at: endedAt.toISOString(),
  started_at: startedAt.toISOString(),
  ended_at: endedAt.toISOString(),
  duration_ms: endedAt.getTime() - startedAt.getTime(),
  artifact_root: artifactRoot,
  counts,
  boundaries: {
    real_tokendance_id_login: false,
    real_cli_or_model_api: false,
    packaged_desktop: false,
    signing: false,
    release_upload: false,
    production_deploy: false,
  },
  exclusions: [
    'real TokenDance ID login',
    'real CLI/model/API execution',
    'packaged Tauri/Desktop installer',
    'sidecar packaging proof',
    'signing',
    'release upload',
    'production deployment',
  ],
  rows,
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`\nChat acceptance status: ${status}`);
console.log(`Manifest: ${outputPath}`);
console.log('Evidence boundary: real_tested=false; no real login, model/API execution, packaged Desktop, signing, release upload, or production deploy.');

if (counts.failed > 0) {
  process.exitCode = 1;
}

async function runGate(gate) {
  const commandText = [gate.command, ...gate.args].map(quoteArg).join(' ');
  const artifacts = (gate.artifacts ?? []).filter(Boolean);

  if (gate.skip) {
    rows.push({
      name: gate.name,
      surface: gate.surface,
      evidence_level: gate.evidenceLevel,
      real_tested: false,
      status: 'skipped',
      exit_code: null,
      duration_ms: 0,
      command: commandText,
      working_directory: gate.cwd,
      claim: gate.claim,
      evidence: gate.skipReason,
      artifacts,
    });
    console.log(`SKIP  ${gate.name} - ${gate.skipReason}`);
    return;
  }

  console.log(`RUN   ${gate.name}`);
  const started = Date.now();
  const result = await runCommand(gate.command, gate.args, gate.cwd);
  const status = result.exitCode === 0 ? 'passed' : 'failed';
  rows.push({
    name: gate.name,
    surface: gate.surface,
    evidence_level: gate.evidenceLevel,
    real_tested: false,
    status,
    exit_code: result.exitCode,
    duration_ms: Date.now() - started,
    command: commandText,
    working_directory: gate.cwd,
    claim: gate.claim,
    evidence: shortenText(`${result.stdout}\n${result.stderr}`),
    artifacts,
  });
  console.log(`${status === 'passed' ? 'PASS' : 'FAIL'}  ${gate.name}${status === 'failed' ? ` - exit ${result.exitCode}` : ''}`);
}

function runCommand(command, commandArgs, cwd) {
  return new Promise((resolve) => {
    const spawnCommand = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : command;
    const spawnArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', [command, ...commandArgs].map(quoteArg).join(' ')]
      : commandArgs;
    let child;
    try {
      child = spawn(spawnCommand, spawnArgs, {
      cwd,
      shell: false,
      windowsHide: true,
      env: {
        ...process.env,
        AGENTHUB_EDGE_AUTH_TOKEN: '',
        AGENTHUB_CHAT_ACCEPTANCE_ARTIFACT_ROOT: artifactRoot,
      },
      });
    } catch (error) {
      resolve({ exitCode: 127, stdout: '', stderr: error instanceof Error ? error.message : String(error) });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1000).unref();
    }, timeoutMs);

    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ exitCode: 127, stdout, stderr: `${stderr}\n${error.message}` });
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        resolve({ exitCode: 124, stdout, stderr: `${stderr}\nTimed out after ${timeoutMs / 1000} seconds; signal=${signal ?? 'none'}` });
        return;
      }
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function redactSecretLike(value) {
  return value
    .replace(/(Authorization:\s*Bearer\s+)[^"'\s,}]+/gi, '$1<redacted-token>')
    .replace(/\b(bearer\s+)[a-z0-9._-]{12,}/gi, '$1<redacted-token>')
    .replace(/\b(sk|ghp|gho|ghu|ghs|glpat|xox[baprs])-[-_A-Za-z0-9]{8,}/gi, '<redacted-token>')
    .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)\s*[=:]\s*)[^"'\s,}]+/gi, '$1<redacted-secret>')
    .replace(/("?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|client_secret|password)"?\s*:\s*")[^"]+/gi, '$1<redacted-secret>');
}

function shortenText(value, max = 4000) {
  const safe = redactSecretLike(value);
  return safe.length <= max ? safe : `${safe.slice(0, max)}\n...<truncated>...`;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function quoteArg(value) {
  if (!value) return '""';
  return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function parseArgs(rawArgs) {
  const parsed = {};
  for (let i = 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === '--') {
      continue;
    }
    switch (arg) {
      case '--repo-root':
      case '-RepoRoot':
        parsed.repoRoot = rawArgs[++i];
        break;
      case '--artifact-root':
      case '-ArtifactRoot':
        parsed.artifactRoot = rawArgs[++i];
        break;
      case '--output-path':
      case '-OutputPath':
        parsed.outputPath = rawArgs[++i];
        break;
      case '--command-timeout-sec':
      case '-CommandTimeoutSec':
        parsed.commandTimeoutSec = rawArgs[++i];
        break;
      case '--skip-shared-unit':
      case '-SkipSharedUnit':
        parsed.skipSharedUnit = true;
        break;
      case '--skip-desktop-playwright':
      case '-SkipDesktopPlaywright':
        parsed.skipDesktopPlaywright = true;
        break;
      case '--skip-web-playwright':
      case '-SkipWebPlaywright':
        parsed.skipWebPlaywright = true;
        break;
      case '--skip-desktop-visual-qa':
      case '-SkipDesktopVisualQa':
        parsed.skipDesktopVisualQa = true;
        break;
      case '--skip-web-visual-qa':
      case '-SkipWebVisualQa':
        parsed.skipWebVisualQa = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}
