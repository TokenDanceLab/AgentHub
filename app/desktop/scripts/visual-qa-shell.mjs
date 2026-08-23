/**
 * P74 Visual QA — Desktop shell capture matrix (#1199 / #1286)
 * Viewport 1440x810 · themes light+dark · Demo workbench entry
 *
 * CURRENT GATE MATRIX (Desktop half). Pair with:
 *   app/web/scripts/visual-qa-shell.mjs
 * Score SSOT: visual-qa-scorecard
 * Optional multi-scene battery (not gate): app/web/scripts/visual-qa.mjs
 *
 * Usage (from app/desktop):
 *   node scripts/visual-qa-shell.mjs
 *   pnpm --filter agenthub-desktop visual:qa:shell
 * Env:
 *   VISUAL_QA_DPR (default 1; set 2 for Retina capture #1308)
 *   AGENTHUB_DESKTOP_E2E_PORT (default 5199)
 *   AGENTHUB_DESKTOP_QA_URL   (skip spawning vite when set)
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'screenshots', 'visual-qa');
const port = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const baseUrl = process.env.AGENTHUB_DESKTOP_QA_URL ?? `http://127.0.0.1:${port}`;
const viewport = { width: 1440, height: 810 };
const dpr = Math.max(1, Number(process.env.VISUAL_QA_DPR ?? 1) || 1);
const dprSuffix = dpr === 1 ? '' : `@${dpr}x`;
const themes = ['light', 'dark'];
const THEME_KEY = 'agenthub-v4-theme';

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForUrl(url, timeoutMs = 45_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { method: 'GET' });
      if (res.ok || res.status === 404) return;
    } catch {
      /* retry */
    }
    await wait(400);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function maybeStartDevServer() {
  if (process.env.AGENTHUB_DESKTOP_QA_URL) {
    return { stop: async () => {} };
  }
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: projectRoot,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: { ...process.env },
    },
  );
  await waitForUrl(baseUrl);
  return {
    stop: async () => {
      if (!child.killed) {
        child.kill('SIGTERM');
      }
    },
  };
}

async function enterDemoWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  // Locale-stable demo entry (#1827): the localized title differs
  // ("Continue in Demo mode" / "使用 Demo 模式继续"), match on the common
  // "Demo" token so the capture works in both zh and en runners (CI = en).
  const demo = page.getByRole('button', { name: /Demo/ });
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
  }
  await page.getByTestId('agenthub-workbench').waitFor({ state: 'visible', timeout: 20_000 });
  // Shell loaded: main region presence is locale-independent (its aria-label
  // is localized through chatview i18n — "Workspace" / "工作区").
  await page.getByRole('main').first().waitFor({ state: 'visible', timeout: 15_000 });
}

async function captureTheme(browser, theme) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.addInitScript(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      // Shell QA must capture the workbench, not the one-time onboarding
      // dialog. Onboarding has its own component/story/unit acceptance.
      window.localStorage.setItem('agenthub_onboarding_seen', 'true');
    },
    { key: THEME_KEY, theme },
  );
  await enterDemoWorkbench(page);
  // Re-apply after navigation in case entry gate reset storage.
  await page.evaluate(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { key: THEME_KEY, theme },
  );
  await wait(200);
  const file = path.join(outDir, `desktop-shell-${theme}-1440x810${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  // #1874: emit a DOM/geometry contract next to the PNG so the gate can prove it
  // captured the workbench (not an onboarding/blank shell) with no horizontal overflow.
  const contract = await page.evaluate(() => ({
    viewport: { width: window.innerWidth, height: window.innerHeight },
    workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
    onboardingVisible: Boolean(document.querySelector('[data-testid="onboarding-overlay"]')),
    horizontalOverflow:
      document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  }));
  const contractFile = path.join(outDir, `desktop-shell-${theme}-1440x810${dprSuffix}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, contractFile, contract, applied, theme };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  // Remove the expected outputs before capture. If navigation/rendering fails,
  // a later assertion must not pass on PNGs left by an older run.
  for (const theme of themes) {
    await rm(path.join(outDir, `desktop-shell-${theme}-1440x810${dprSuffix}.png`), { force: true });
    await rm(path.join(outDir, `desktop-shell-${theme}-1440x810${dprSuffix}.json`), { force: true });
  }
  const server = await maybeStartDevServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const theme of themes) {
      results.push(await captureTheme(browser, theme));
    }
  } finally {
    await browser.close();
    await server.stop();
  }

  for (const r of results) {
    if (r.applied !== r.theme) {
      console.warn(`warn: expected data-theme=${r.theme}, got ${r.applied}`);
    }
    console.log(`wrote ${r.file}`);
    console.log(`contract ${r.contractFile} overflow=${r.contract.horizontalOverflow}`);
  }
  console.log(`Desktop visual-qa shell capture done (${results.length} shots) → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
