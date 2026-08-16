#!/usr/bin/env node
// design CSS syntax gate (#1720) — fail-closed, syntax-only.
//
// 核心 token/theme/preset CSS 被 .stylelintignore 排除在 Stylelint 之外，
// 真实的注释 `*/` 语法错误因此假绿。本脚本只调用 Stylelint 的 parser
// （config: { rules: {} }），不检查任何 style rule —— 约 920 条历史规则债
// 另立任务，不属于本 gate。
//
// fail-closed 合同（任一违反即非零退出）：
// - 零扫描（没有匹配 tokens*/themes*/presets*.css 的文件）
// - required 文件缺失（当前 10 个关键路径，为 minimum，不是上限）
// - 读文件失败（权限/竞态删除）
// - Stylelint 异常（lint 调用抛错）或未知结果（缺 results / 缺 warnings /
//   出现规则以外形状的 warning / errored 与 warnings 不一致）
// - 未知命令行参数
// - 任何 CssSyntaxError
//
// 结构：collector（扫描合同内文件）→ lint（Stylelint 语法解析）→
// verify（fail-closed 判定）→ CLI（参数解析 + --self-test 真实链路自测）。

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import stylelint from 'stylelint';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_APP_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const SKIPPED_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.turbo', '.git']);
const DESIGN_CSS_NAME = /^(?:tokens|themes|presets).*\.css$/i;
const SYNTAX_ONLY_CONFIG = { rules: {} };

// 当前 10 个关键路径（相对 appRoot）。required minimum：新增匹配文件自动
// 加入扫描，不把 10 设为上限；这些路径缺失则必须失败。
const REQUIRED_FILES = [
  'shared/src/chatview/design/tokens.css',
  'shared/src/styles/presets-base.css',
  'shared/src/styles/themes.css',
  'shared/src/styles/tokens-base.css',
  'desktop/src/styles/presets.css',
  'desktop/src/styles/themes.css',
  'desktop/src/styles/tokens.css',
  'web/src/styles/presets.css',
  'web/src/styles/themes.css',
  'web/src/styles/tokens.css',
];

// ── collector ────────────────────────────────────────────────────────────

async function collectDesignCss(appRoot) {
  const files = [];
  for (const entry of await readdir(appRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIPPED_DIRS.has(entry.name)) continue;
    const full = path.join(appRoot, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectDesignCss(full)));
    } else if (entry.isFile() && DESIGN_CSS_NAME.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

// ── lint ──────────────────────────────────────────────────────────────────

async function lintCssSyntax(filePath, ignoreFilePath) {
  let code;
  try {
    code = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new Error(`design CSS syntax verifier: failed to read ${filePath}: ${error.message}`);
  }

  let result;
  try {
    result = await stylelint.lint({
      code,
      codeFilename: filePath,
      config: SYNTAX_ONLY_CONFIG,
      // .stylelintignore 排除 **/tokens*.css 等路径，stylelint 连 API 的
      // code+codeFilename 输入也会按该 ignore 静默跳过（results=0）——
      // 这正是本 gate 要消除的假绿。显式给一个空 ignore 文件覆盖之，
      // 强制真实解析；若 stylelint 仍跳过输入，下方 results.length !== 1
      // 检查会 fail-closed。（不用 os.devnull：Node 24 ESM 不导出 devnull。）
      ignorePath: ignoreFilePath,
    });
  } catch (error) {
    throw new Error(`design CSS syntax verifier: stylelint threw for ${filePath}: ${error.message}`);
  }

  if (!result || !Array.isArray(result.results) || result.results.length !== 1) {
    throw new Error(`design CSS syntax verifier: stylelint returned unknown result shape for ${filePath}`);
  }
  const entry = result.results[0];
  if (!entry || !Array.isArray(entry.warnings)) {
    throw new Error(`design CSS syntax verifier: stylelint returned unknown warnings shape for ${filePath}`);
  }

  const syntaxErrors = [];
  for (const warning of entry.warnings) {
    if (!warning || typeof warning !== 'object' || typeof warning.rule !== 'string') {
      throw new Error(`design CSS syntax verifier: stylelint returned malformed warning for ${filePath}`);
    }
    if (warning.rule === 'CssSyntaxError') {
      syntaxErrors.push(warning);
      continue;
    }
    // config 是 { rules: {} }：只允许 parser 语法错误，其他任何 rule 警告都
    // 属于未知结果（例如配置漂移、stylelint 版本行为变化），fail-closed。
    throw new Error(
      `design CSS syntax verifier: unexpected stylelint warning for ${filePath}: ` +
        `${warning.rule} (syntax-only config must produce no rule warnings)`,
    );
  }
  if (entry.errored && syntaxErrors.length === 0) {
    throw new Error(
      `design CSS syntax verifier: stylelint reported errored result without CssSyntaxError for ${filePath}`,
    );
  }
  return syntaxErrors;
}

// ── verify ────────────────────────────────────────────────────────────────

async function verifyDesignCss(appRoot, ignoreFilePath) {
  let files;
  try {
    files = (await collectDesignCss(appRoot)).sort();
  } catch (error) {
    throw new Error(`design CSS syntax verifier: directory scan failed under ${appRoot}: ${error.message}`);
  }

  if (files.length === 0) {
    throw new Error(
      `design CSS syntax verifier: zero scan — no token/theme/preset CSS files found under ${appRoot}`,
    );
  }

  for (const relative of REQUIRED_FILES) {
    const absolute = path.join(appRoot, relative);
    if (files.includes(absolute)) continue;
    let reason = 'missing from disk';
    try {
      await readFile(absolute, 'utf8');
      reason = 'present on disk but not scanned';
    } catch {
      // missing from disk — keep default reason
    }
    throw new Error(`design CSS syntax verifier: required design CSS file ${reason}: ${relative}`);
  }

  let failed = false;
  for (const file of files) {
    const syntaxErrors = await lintCssSyntax(file, ignoreFilePath);
    for (const warning of syntaxErrors) {
      failed = true;
      console.error(
        `${path.relative(appRoot, file)}:${warning.line}:${warning.column}: ${warning.text}`,
      );
    }
  }

  if (failed) {
    throw new Error('design CSS syntax verifier: CssSyntaxError detected in token/theme/preset CSS');
  }
  return files.length;
}

// ── CLI ───────────────────────────────────────────────────────────────────

function usageError(message) {
  process.stderr.write(
    `design CSS syntax verifier: ${message}\n` +
      'usage: node verify-design-css-syntax.mjs [--app-root <dir>] [--self-test]\n',
  );
  process.exit(2);
}

function parseArgs(argv) {
  let appRoot = DEFAULT_APP_ROOT;
  let selfTest = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--self-test') {
      selfTest = true;
    } else if (argument === '--app-root') {
      index += 1;
      if (argv[index] === undefined) usageError('--app-root requires a value');
      appRoot = path.resolve(argv[index]);
    } else {
      usageError(`unknown argument: ${argument}`);
    }
  }
  return { appRoot, selfTest };
}

function runCli(appRoot, args = []) {
  const result = spawnSync(process.execPath, [SCRIPT_PATH, '--app-root', appRoot, ...args], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.error) {
    throw new Error(`design CSS syntax verifier self-test: failed to spawn CLI: ${result.error.message}`);
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { exitCode: result.status ?? 1, output };
}

function expectCli(appRoot, expectedExitCode, outputFragment, caseName) {
  const { exitCode, output } = runCli(appRoot);
  if (exitCode !== expectedExitCode) {
    throw new Error(
      `design CSS syntax verifier self-test failed (${caseName}): expected exit ${expectedExitCode}, ` +
        `got ${exitCode}\n--- output ---\n${output}`,
    );
  }
  if (outputFragment && !output.includes(outputFragment)) {
    throw new Error(
      `design CSS syntax verifier self-test failed (${caseName}): output missing ` +
        `"${outputFragment}"\n--- output ---\n${output}`,
    );
  }
  return output;
}

// ── self-test ─────────────────────────────────────────────────────────────

const VALID_CSS = {
  'shared/src/chatview/design/tokens.css': '.chatview { --chat-sp-sm: 8px; }\n',
  'shared/src/styles/presets-base.css': ':root { --preset-x: 1px; }\n',
  'shared/src/styles/themes.css': ':root { --theme-x: 1px; }\n',
  'shared/src/styles/tokens-base.css': ':root { --token-x: 1px; }\n',
  'desktop/src/styles/presets.css': ':root { --preset-x: 1px; }\n',
  'desktop/src/styles/themes.css': ':root { --theme-x: 1px; }\n',
  'desktop/src/styles/tokens.css': ':root { --token-x: 1px; }\n',
  'web/src/styles/presets.css': ':root { --preset-x: 1px; }\n',
  'web/src/styles/themes.css': ':root { --theme-x: 1px; }\n',
  'web/src/styles/tokens.css': ':root { --token-x: 1px; }\n',
};

const MALFORMED_CSS = '.broken { color: red; */ }\n';

async function writeFixtureFiles(appRoot) {
  for (const [relative, content] of Object.entries(VALID_CSS)) {
    const absolute = path.join(appRoot, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }
}

async function runSelfTest() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'agenthub-design-css-syntax-'));
  try {
    const fixtureApp = path.join(tempRoot, 'app');
    await writeFixtureFiles(fixtureApp);

    // 正向：10 个 required 文件全部可解析 → 0，且输出证明扫描覆盖 10 个。
    // VALID_CSS 里没有任何 style rule 违规被上报的机制（config 为
    // { rules: {} }），所以本用例同时证明「只检查语法、不检查 style rules」。
    const validOutput = expectCli(fixtureApp, 0, 'design CSS syntax ok (10 files)', 'valid fixture');
    if (validOutput.includes('CssSyntaxError') || validOutput.includes('ERROR:')) {
      throw new Error(
        'design CSS syntax verifier self-test failed (valid fixture): unexpected error output\n' +
          `--- output ---\n${validOutput}`,
      );
    }

    // 负向 1：malformed target → 非零，且必须报 CssSyntaxError。
    const targetPath = path.join(fixtureApp, 'shared/src/styles/tokens-base.css');
    await writeFile(targetPath, MALFORMED_CSS, 'utf8');
    expectCli(fixtureApp, 1, 'CssSyntaxError', 'malformed target');
    await writeFixtureFiles(fixtureApp);

    // 负向 2：删除 required 文件 → 非零，且必须报 required missing。
    const requiredPath = path.join(fixtureApp, 'web/src/styles/themes.css');
    await rm(requiredPath, { force: true });
    expectCli(fixtureApp, 1, 'required design CSS file missing', 'required file deleted');
    await writeFixtureFiles(fixtureApp);

    // 负向 3：malformed non-target 被忽略（合同外的 CSS 不参与扫描）→ 0。
    await writeFile(path.join(fixtureApp, 'web/src/styles/component.css'), MALFORMED_CSS, 'utf8');
    expectCli(fixtureApp, 0, 'design CSS syntax ok (10 files)', 'malformed non-target ignored');

    // 负向 4：零扫描（真正空的 appRoot）→ 非零。
    const emptyRoot = path.join(tempRoot, 'empty-app');
    await mkdir(emptyRoot, { recursive: true });
    await expectCli(emptyRoot, 1, 'zero scan', 'zero scan');

    // 负向 5：未知参数 → 非零（exit 2）。
    const unknown = runCli(fixtureApp, ['--bogus']);
    if (unknown.exitCode !== 2 || !unknown.output.includes('unknown argument')) {
      throw new Error(
        `design CSS syntax verifier self-test failed (unknown argument): expected exit 2 with ` +
          `"unknown argument", got ${unknown.exitCode}\n--- output ---\n${unknown.output}`,
      );
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
  console.log('design CSS syntax verifier self-test ok');
}

// ── main ──────────────────────────────────────────────────────────────────

async function main() {
  const { appRoot, selfTest } = parseArgs(process.argv.slice(2));
  if (selfTest) {
    await runSelfTest();
    return;
  }
  // 每个 CLI 进程创建一次空 ignore 文件（.stylelintignore 的显式覆盖），
  // 结束即清理。文件必须真实存在：getFileIgnorer 对不存在的 ignorePath
  // 会静默跳过并回退到默认 .stylelintignore —— 那正是假绿来源。
  const ignoreDir = await mkdtemp(path.join(os.tmpdir(), 'agenthub-design-css-ignore-'));
  try {
    const ignoreFilePath = path.join(ignoreDir, '.stylelintignore');
    await writeFile(ignoreFilePath, '', 'utf8');
    const fileCount = await verifyDesignCss(appRoot, ignoreFilePath);
    console.log(`design CSS syntax ok (${fileCount} files)`);
  } finally {
    await rm(ignoreDir, { recursive: true, force: true });
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`ERROR: ${error.message}\n`);
  process.exit(1);
}
