/**
 * Visual QA — Web Tasks board capture (#1999, UX F13)
 * Viewport 1440x810 · themes light+dark · mock data mode (board renders in
 * fixture mode only — real mode stays on the honest coming-soon state).
 *
 * Gate assertions (hard failures, not warnings):
 * - board surface renders with >=2 board-column group titles (SSOT chrome);
 * - awaiting-review marker present (mock pool has 待评审 tasks);
 * - horizontalOverflow === false (document and tasks main surface);
 * - zero approve/merge controls on the Hub-only web surface (fail-closed).
 *
 * Usage (from app/web):
 *   node scripts/visual-qa-tasks-board.mjs
 * Env:
 *   AGENTHUB_WEB_E2E_PORT (default 5174)
 *   WEB_QA_URL / AGENTHUB_WEB_QA_URL — skip vite spawn when set
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'screenshots', 'visual-qa-tasks-board');
const port = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const baseUrl =
  process.env.AGENTHUB_WEB_QA_URL ??
  process.env.WEB_QA_URL ??
  `http://127.0.0.1:${port}/`;
const vp = { width: 1440, height: 810, label: '1440x810' };
const themes = ['light', 'dark'];
const THEME_KEY_V4 = 'agenthub-v4-theme';
const THEME_KEY_LEGACY = 'agenthub-theme';
const WORKBENCH_SHELL = '[data-testid="agenthub-workbench"]';
const TASKS_RAIL_BUTTON = 'button[data-rail-page="runs"]';
const BOARD_TAB = 'button[data-mode="board"]';
const BOARD_COLUMN_TITLE = '[data-board-column-id]';
const REVIEW_MARKER = '[data-testid="task-review-marker"]';
const REVIEW_MERGE_CONTROLS = '[data-testid="task-review-merge-controls"]';
const HUB_ONLY_NOTICE = '[data-testid="tasks-hub-only-merge-notice"]';
const hubUrlPattern =
  /https?:\/\/(?:localhost:8080|127\.0\.0.1:8080|hub\.vectorcontrol\.tech|api\.hub\.vectorcontrol\.tech)\/.*/;

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

function hubEnvelope(data) {
  return { code: 'OK', data, message: '' };
}

function json(data) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(data),
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    },
  };
}

async function installMockHub(context) {
  await context.route(hubUrlPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: json({}).headers });
    }
    if (pathname.endsWith('/health')) {
      return route.fulfill(
        json({ status: 'ok', version: 'web-visual-qa-tasks-board', uptime: '1h', checks: {} }),
      );
    }
    if (pathname === '/client/auth/me') {
      return route.fulfill(
        json(
          hubEnvelope({
            id: 'user_visual',
            username: 'visual-reviewer',
            nickname: 'Visual Reviewer',
            avatar_url: '',
          }),
        ),
      );
    }
    if (pathname === '/client/sessions') {
      return route.fulfill(json(hubEnvelope([])));
    }
    if (pathname === '/client/contacts' || pathname === '/client/notifications') {
      return route.fulfill(json(hubEnvelope([])));
    }
    // Catch-all: empty envelope for unknown routes.
    return route.fulfill(json(hubEnvelope({})));
  });
}

async function maybeStartDevServer() {
  if (process.env.AGENTHUB_WEB_QA_URL || process.env.WEB_QA_URL) {
    return { stop: async () => {} };
  }
  const child = spawn(
    process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    ['dev', '--host', '127.0.0.1', '--port', String(port)],
    {
      cwd: projectRoot,
      stdio: 'ignore',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        VITE_BASE_PATH: '/',
        // Board renders in fixture mode; real mode stays on coming-soon.
        VITE_AGENTHUB_DATA_MODE: 'mock',
        VITE_HUB_URL: 'http://localhost:8080',
      },
    },
  );
  await waitForUrl(baseUrl);
  return {
    stop: async () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

async function captureTheme(browser, theme) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
    colorScheme: theme,
  });
  await installMockHub(context);
  const page = await context.newPage();

  await page.addInitScript(
    ({ v4Key, legacyKey, theme: t }) => {
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      window.localStorage.setItem('agenthub-language', 'zh');
      window.localStorage.setItem('agenthub_hub_url', 'http://localhost:8080');
      window.sessionStorage.setItem('agenthub_hub_token', 'visual-qa-token');
      window.sessionStorage.setItem(
        'agenthub_hub_user',
        JSON.stringify({ userId: 'user_visual', username: 'visual-reviewer' }),
      );
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );

  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForSelector(WORKBENCH_SHELL, { state: 'visible', timeout: 30_000 });

  // Navigate to the Tasks page via the locale-stable rail hook.
  const tasksRail = page.locator(TASKS_RAIL_BUTTON).first();
  await tasksRail.waitFor({ state: 'visible', timeout: 10_000 });
  await tasksRail.click();
  await wait(400);

  // Switch the view tablist to the board.
  const boardTab = page.locator(BOARD_TAB).first();
  await boardTab.waitFor({ state: 'visible', timeout: 10_000 });
  await boardTab.click();
  await wait(400);

  // Re-apply theme attributes after hydration (parity with shell script).
  await page.evaluate(
    ({ v4Key, legacyKey, theme: t }) => {
      document.documentElement.setAttribute('data-theme', t);
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );
  await wait(250);

  const file = path.join(outDir, `web-tasks-board-${theme}-${vp.label}.png`);
  await page.screenshot({ path: file, fullPage: false });

  const contract = await page.evaluate(() => {
    function measure(el) {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        overflow: el.scrollWidth > el.clientWidth + 1,
      };
    }
    const main = document.querySelector('.tasks-page main') ?? document.querySelector('.tasks-page');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
      tasksPage: Boolean(document.querySelector('.tasks-page')),
      boardColumnTitles: Array.from(document.querySelectorAll('[data-board-column-id]')).map(
        (el) => el.getAttribute('data-board-column-id'),
      ),
      reviewMarkers: document.querySelectorAll('[data-testid="task-review-marker"]').length,
      reviewMergeControls: document.querySelectorAll(
        '[data-testid="task-review-merge-controls"]',
      ).length,
      hubOnlyNotice: Boolean(document.querySelector('[data-testid="tasks-hub-only-merge-notice"]')),
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      main: measure(main),
    };
  });

  const contractFile = path.join(outDir, `web-tasks-board-${theme}-${vp.label}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');
  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, contractFile, contract, applied, theme };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  for (const theme of themes) {
    await rm(path.join(outDir, `web-tasks-board-${theme}-${vp.label}.png`), { force: true });
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

  const failures = [];
  for (const r of results) {
    if (r.applied !== r.theme) {
      failures.push(`theme ${r.theme}: data-theme resolved to ${r.applied}`);
    }
    const c = r.contract;
    console.log(`wrote ${r.file}`);
    console.log(
      `contract ${r.contractFile} overflow=${c.horizontalOverflow} columns=[${c.boardColumnTitles.join(',')}] ` +
        `reviewMarkers=${c.reviewMarkers} mergeControls=${c.reviewMergeControls} hubOnlyNotice=${c.hubOnlyNotice}`,
    );
    if (!c.tasksPage) failures.push(`${r.theme}: tasks page not rendered`);
    if (c.boardColumnTitles.length < 2) {
      failures.push(`${r.theme}: expected >=2 board columns, got ${c.boardColumnTitles.length}`);
    }
    if (c.reviewMarkers < 1) failures.push(`${r.theme}: awaiting-review marker missing`);
    if (c.horizontalOverflow !== false) failures.push(`${r.theme}: document horizontal overflow`);
    if (c.main && c.main.overflow) failures.push(`${r.theme}: tasks main surface overflow`);
    if (c.reviewMergeControls !== 0) {
      failures.push(`${r.theme}: Hub-only web surface rendered merge controls (fail-closed gate)`);
    }
    // Web is Hub-only: the honesty notice must be present on the board.
    if (!c.hubOnlyNotice) failures.push(`${r.theme}: Hub-only merge notice missing`);
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`FAIL: ${failure}`);
    process.exit(1);
  }
  console.log(`Web tasks-board visual QA passed (${results.length} themes) -> ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
