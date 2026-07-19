/**
 * P76 Visual QA — Desktop Chat path capture (#1314)
 * Viewport 1440x810 · themes light+dark · Demo workbench (chat default)
 *
 * Optional density gate companion (does NOT replace visual:qa:shell merge gate).
 *
 * Usage (from app/desktop):
 *   node scripts/visual-qa-chat.mjs
 *   pnpm --filter agenthub-desktop visual:qa:chat
 * Env: VISUAL_QA_DPR · AGENTHUB_DESKTOP_E2E_PORT · AGENTHUB_DESKTOP_QA_URL
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

async function enterDemoWorkbench(page) {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  const demo = page.getByRole('button', { name: '使用 Demo 模式继续' });
  if (await demo.isVisible().catch(() => false)) {
    await demo.click();
  }
  await page.getByTestId('agenthub-workbench').waitFor({ state: 'visible', timeout: 20_000 });
  await page.getByRole('main', { name: 'Workspace' }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function captureTheme(browser, theme) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  await page.addInitScript(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
    },
    { key: THEME_KEY, theme },
  );
  await enterDemoWorkbench(page);

  // Stay on chat path: click Chat rail if present, avoid Agents.
  try {
    const chatRail = page
      .locator(
        'nav[aria-label="Global rail"] button[aria-label="对话"], nav[aria-label="Global rail"] button[aria-label="消息"]',
      )
      .first();
    if (await chatRail.isVisible().catch(() => false)) {
      await chatRail.click();
    }
  } catch {
    /* demo may already be chat */
  }

  await page.evaluate(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { key: THEME_KEY, theme },
  );
  await wait(400);

  const hasComposer = await page
    .locator('textarea, [aria-label="Composer input"], [placeholder*="发消息"]')
    .first()
    .isVisible()
    .catch(() => false);
  const hasInspector = await page
    .locator('aside[aria-label="Right inspector"]')
    .first()
    .isVisible()
    .catch(() => false);

  const file = path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, applied, theme, hasComposer, hasInspector };
}

async function main() {
  await mkdir(outDir, { recursive: true });
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
    console.log(`wrote ${r.file} (composer=${r.hasComposer} inspector=${r.hasInspector})`);
  }
  console.log(`Desktop visual-qa chat capture done (${results.length} shots) → ${outDir}`);
  console.log('Optional density notes — not the Agents shell merge gate.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
