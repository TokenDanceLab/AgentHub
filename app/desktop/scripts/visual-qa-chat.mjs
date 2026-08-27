/**
 * Visual QA — Desktop Chat path capture (gate half, #1940)
 * Viewport 1440x810 · themes light+dark · Demo workbench (chat default)
 *
 * Merge-gate companion of visual-qa-shell.mjs (desktop half): captures the
 * chat content surface (demo builder transcript + composer) and emits a
 * DOM/geometry contract JSON next to each PNG. The assert step
 * (scripts/assert-visual-qa-chat.mjs) fails closed on missing shots or a
 * broken contract. No pixel goldens.
 *
 * Transcript source: the shared demo fixtures (builder conversation — the
 * demo fallback id), which render completed tool cards. The demo transcript
 * is a finished state, so the contract pins "no typing indicator". Fenced
 * code blocks are covered by the web chat lane (stubbed-Hub replay); the
 * shared demo fixtures carry none and product demo source stays untouched.
 *
 * Usage (from app/desktop):
 *   node scripts/visual-qa-chat.mjs
 *   pnpm --filter agenthub-desktop visual:qa:chat
 * Env: VISUAL_QA_DPR · AGENTHUB_DESKTOP_E2E_PORT · AGENTHUB_DESKTOP_QA_URL
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
// Locale-stable rail selector: aria-labels resolve through chatview i18n,
// so target the data-rail-page hook instead (#1826).
const CHAT_RAIL_BUTTON = 'button[data-rail-page="chat"]';
const TRANSCRIPT_LOG = '[role="log"]';

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
      // Chat QA must capture the workbench transcript, not the one-time
      // onboarding dialog (same policy as visual-qa-shell.mjs desktop half).
      window.localStorage.setItem('agenthub_onboarding_seen', 'true');
    },
    { key: THEME_KEY, theme },
  );
  await enterDemoWorkbench(page);

  // Stay on chat path: click Chat rail via the locale-stable hook.
  try {
    const chatRail = page.locator(CHAT_RAIL_BUTTON).first();
    if (await chatRail.isVisible().catch(() => false)) {
      await chatRail.click();
    }
  } catch {
    /* demo may already be on chat */
  }

  // Fail closed with a diagnostic if the demo transcript cards do not
  // materialize — the assert step trusts only captures that reached this
  // contract (builder demo conversation renders completed tool cards).
  try {
    await page.waitForSelector(TRANSCRIPT_LOG, { state: 'visible', timeout: 20_000 });
    await page.waitForFunction(
      () => {
        const log = document.querySelector('[role="log"]');
        return Boolean(log) && log.querySelectorAll('.row-hd').length > 0;
      },
      undefined,
      { timeout: 20_000 },
    );
  } catch {
    const diagFile = path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}-CONTENT-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    const bodyText = await page.evaluate(() => (document.body?.innerText ?? '(no body)').slice(0, 300));
    throw new Error(
      `Chat transcript cards not rendered for theme=${theme}. ` +
        `Body: ${bodyText.slice(0, 200)}. Diagnostic: ${diagFile}`,
    );
  }

  // Re-apply after navigation in case entry gate reset storage.
  await page.evaluate(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { key: THEME_KEY, theme },
  );

  // Settle for CSS transitions and fonts.
  await wait(600);

  const file = path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });

  // DOM/geometry contract (no pixel goldens): proves the capture hit the
  // chat content surface with at least one completed card row, no typing
  // indicator (demo transcript is a finished state), no overflow.
  const contract = await page.evaluate(() => {
    const measure = (el) => {
      if (!el) return { exists: false };
      const rect = el.getBoundingClientRect();
      return { exists: true, width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    const log = document.querySelector('[role="log"]');
    const cardHeaders = log ? Array.from(log.querySelectorAll('.row-hd')) : [];
    const firstCard = cardHeaders.length > 0 ? cardHeaders[0].closest('[data-block-id]') ?? cardHeaders[0] : null;
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      appliedTheme: document.documentElement.getAttribute('data-theme'),
      workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
      onboardingVisible: Boolean(document.querySelector('[data-testid="onboarding-overlay"]')),
      chatLog: measure(log),
      cardCount: cardHeaders.length,
      firstCard: measure(firstCard),
      streamingEnded: {
        typingIndicator: Boolean(document.querySelector('.typingIndicator')),
      },
      composer: measure(document.querySelector('textarea')),
      // UX F8 (#1998): the demo builder transcript carries a goal arc
      // (create_goal + update_goal complete), so the goal banner must be
      // projected in the chat header surface.
      goalBanner: measure(document.querySelector('section[data-goal-status]')),
      goalStatus: document.querySelector('section[data-goal-status]')?.getAttribute('data-goal-status') ?? '',
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });
  const contractFile = path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, contractFile, contract, applied, theme };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  // Remove expected outputs before capture so a failed run cannot pass the
  // assert step on stale files from an older run (same policy as the shell gate).
  for (const theme of themes) {
    await rm(path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}.png`), { force: true });
    await rm(path.join(outDir, `desktop-chat-${theme}-1440x810${dprSuffix}.json`), { force: true });
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
    console.log(
      `contract ${r.contractFile} cards=${r.contract.cardCount} overflow=${r.contract.horizontalOverflow}`,
    );
  }
  console.log(`Desktop visual-qa chat capture done (${results.length} shots) → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
