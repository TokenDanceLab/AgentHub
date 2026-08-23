/**
 * P74 Visual QA — Web shell capture matrix (#1199 / #1219 / #1242 / #1286)
 * Viewport 1440x810 · themes light+dark · authenticated mock hub
 *
 * CURRENT GATE MATRIX (Web half). Pair with:
 *   app/desktop/scripts/visual-qa-shell.mjs
 * Score SSOT: visual-qa-scorecard
 *
 * Captures the frosted Agents page surface (glass chrome from #1226/#1235),
 * not only bare chat workbench.
 *
 * Usage (from app/web):
 *   node scripts/visual-qa-shell.mjs
 *   pnpm --filter agenthub-web visual:qa:shell
 * Env:
 *   VISUAL_QA_DPR (default 1; set 2 for Retina capture #1308)
 *   AGENTHUB_WEB_E2E_PORT (default 5174)
 *   WEB_QA_URL / AGENTHUB_WEB_QA_URL — skip vite spawn when set
 *
 * Optional / legacy multi-scene battery: visual-qa.mjs (NOT the P74 gate).
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outDir = path.join(projectRoot, 'screenshots', 'visual-qa');
const port = Number(process.env.AGENTHUB_WEB_E2E_PORT ?? 5174);
const baseUrl =
  process.env.AGENTHUB_WEB_QA_URL ??
  process.env.WEB_QA_URL ??
  `http://127.0.0.1:${port}/`;
const viewport = { width: 1440, height: 810 };
const dpr = Math.max(1, Number(process.env.VISUAL_QA_DPR ?? 1) || 1);
const dprSuffix = dpr === 1 ? '' : `@${dpr}x`;
const themes = ['light', 'dark'];
const THEME_KEY_V4 = 'agenthub-v4-theme';
const THEME_KEY_LEGACY = 'agenthub-theme';
const WORKBENCH_SHELL = '[data-testid="agenthub-workbench"]';
// Frosted Agents page surface (#1226 / #1242) — prefer over bare chat workbench.
const AGENTS_PAGE = 'section.agents-page, .agents-page';
// Locale-stable rail selector: aria-label resolves through chatview i18n
// (zh: 全局导航栏), so target the data-rail-page hook instead (#1826).
const AGENTS_RAIL_BUTTON = 'button[data-rail-page="agents"]';
const hubUrlPattern =
  /https?:\/\/(?:localhost:8080|127\.0\.0\.1:8080|hub\.vectorcontrol\.tech|api\.hub\.vectorcontrol\.tech)\/.*/;

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
        json({ status: 'ok', version: 'web-visual-qa-shell', uptime: '1h', checks: {} }),
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
      return route.fulfill(
        json(
          hubEnvelope([
            {
              session_id: 'session_web_design',
              type: 'group',
              name: 'Web design convergence',
              owner_user_id: 'user_visual',
              created_at: '2026-05-30T01:10:00Z',
              updated_at: '2026-05-30T01:30:00Z',
            },
          ]),
        ),
      );
    }
    if (pathname === '/client/contacts' || pathname === '/client/notifications') {
      return route.fulfill(json(hubEnvelope([])));
    }
    if (pathname === '/web/agent-profiles') {
      // #1275: multi-row installed list so Hierarchy/Empty score on dual-scroll layout
      return route.fulfill(
        json(
          hubEnvelope({
            items: [
              {
                id: 'profile_codex',
                name: 'Codex',
                description: '视觉验收主配置',
                runtime_id: 'codex',
                provider: 'openai',
                model: 'gpt-5',
                version: 1,
              },
              {
                id: 'profile_claude',
                name: 'Claude Code',
                description: '视觉验收次配置',
                runtime_id: 'claude-code',
                provider: 'anthropic',
                model: 'claude-opus-4-5',
                version: 1,
              },
              {
                id: 'profile_opencode',
                name: 'OpenCode',
                description: '视觉验收第三配置',
                runtime_id: 'opencode',
                provider: 'openai',
                model: 'gpt-5-mini',
                version: 1,
              },
            ],
            page: { hasMore: false },
          }),
        ),
      );
    }
    // Session pins — needed by conversation sidebar
    if (pathname.match(/^\/client\/sessions\/[^/]+\/pins$/)) {
      return route.fulfill(json(hubEnvelope([])));
    }
    // Session messages
    if (pathname.match(/^\/client\/sessions\/[^/]+\/messages$/)) {
      return route.fulfill(
        json(
          hubEnvelope([
            {
              id: 'msg_1',
              session_id: 'session_web_design',
              sender_id: 'user_visual',
              sender_type: 'user',
              content_type: 'text',
              content: 'Shell visual QA baseline.',
              seq_id: 1,
              created_at: '2026-05-30T01:20:00Z',
            },
          ]),
        ),
      );
    }
    // Execution targets — needed by composer target picker
    if (pathname === '/web/execution-targets') {
      return route.fulfill(
        json(
          hubEnvelope({
            items: [
              {
                id: 'target_local_edge',
                name: 'Local Edge',
                kind: 'local',
                status: 'online',
                updated_at: '2026-05-30T01:25:00Z',
              },
            ],
            page: { hasMore: false },
          }),
        ),
      );
    }
    // Catch-all: empty envelope for unknown routes (agent-tasks, public-skills, etc.)
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
        // Pin mock data mode so workbench renders with demo agents/conversations
        VITE_AGENTHUB_DATA_MODE: 'mock',
        // Pin hub URL so the app routes all calls through Playwright mock
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
    viewport,
    deviceScaleFactor: dpr,
    serviceWorkers: 'block',
    // Match prefers-color-scheme so system-theme resolution is predictable
    colorScheme: theme,
  });
  await installMockHub(context);
  const page = await context.newPage();

  // Set storage BEFORE navigation so auth + theme are ready on first load
  await page.addInitScript(
    ({ v4Key, legacyKey, theme: t }) => {
      // Theme: dual-write both v4 (SSOT) and legacy keys for any component that reads either
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      window.localStorage.setItem('agenthub-language', 'zh');
      window.localStorage.setItem('agenthub_hub_url', 'http://localhost:8080');
      // Auth: hub access token + user profile in sessionStorage
      window.sessionStorage.setItem('agenthub_hub_token', 'visual-qa-token');
      window.sessionStorage.setItem(
        'agenthub_hub_user',
        JSON.stringify({ userId: 'user_visual', username: 'visual-reviewer' }),
      );
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );

  // Navigate to the app root with absolute URL (#1216 pattern)
  const appUrl = new URL('/', baseUrl).toString();
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 45_000 });

  // Wait for the workbench shell to appear — confirms React mounted without crash
  try {
    await page.waitForSelector(WORKBENCH_SHELL, { state: 'visible', timeout: 30_000 });
  } catch {
    // Diagnostic capture on failure
    const diagFile = path.join(outDir, `web-shell-${theme}-1440x810${dprSuffix}-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    const pageUrl = page.url();
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() =>
      (document.body?.innerText ?? '(no body)').slice(0, 500),
    );
    throw new Error(
      `Workbench shell not visible for theme=${theme}. ` +
        `URL: ${pageUrl}, Title: "${pageTitle}". ` +
        `Body: ${bodyText.slice(0, 200)}. ` +
        `Diagnostic: ${diagFile}`,
    );
  }

  // Navigate to Agents via global rail so capture shows frosted page chrome
  // (Agents list glass from #1226/#1235), not only bare chat workbench (#1242).
  try {
    const agentsRail = page.locator(AGENTS_RAIL_BUTTON).first();
    await agentsRail.waitFor({ state: 'visible', timeout: 10_000 });
    await agentsRail.click();
    await page.waitForSelector(AGENTS_PAGE, { state: 'visible', timeout: 15_000 });
  } catch {
    const diagFile = path.join(outDir, `web-shell-${theme}-1440x810${dprSuffix}-AGENTS-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    const pageUrl = page.url();
    const bodyText = await page.evaluate(() =>
      (document.body?.innerText ?? '(no body)').slice(0, 500),
    );
    throw new Error(
      `Agents frosted page not visible for theme=${theme}. ` +
        `URL: ${pageUrl}. Body: ${bodyText.slice(0, 200)}. ` +
        `Diagnostic: ${diagFile}`,
    );
  }

  // Re-apply theme attributes after React hydration to guarantee correctness
  await page.evaluate(
    ({ v4Key, legacyKey, theme: t }) => {
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );

  // Wait for meaningful painted content: body must have text and not be pure black
  await page.waitForFunction(
    () => {
      const body = document.body;
      if (!body || body.innerText.trim().length < 5) return false;
      const bg = window.getComputedStyle(body).backgroundColor;
      // Reject pure-black background (often means CSS not loaded or crash)
      if (bg === 'rgb(0, 0, 0)' || bg === 'rgba(0, 0, 0, 1)') return false;
      // Require Agents page chrome so we do not capture bare chat by accident
      return Boolean(document.querySelector('section.agents-page, .agents-page'));
    },
    { timeout: 15_000 },
  ).catch(() => {
    // Non-fatal: a valid dark theme might use near-black; capture anyway
    console.warn(`warn: body content check inconclusive for theme=${theme}, capturing anyway`);
  });

  // #1275: wait for installed list rows (or empty glass) and pin scroll to top
  // so tall detail focus cannot scroll the short list out of the 1440×810 frame.
  try {
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll('.agent-config-row, button.agent-config-row');
        const empty = document.querySelector('.agent-empty-compact, [class*="agent-empty"]');
        return rows.length > 0 || Boolean(empty);
      },
      { timeout: 12_000 },
    );
  } catch {
    console.warn(`warn: installed list rows not detected for theme=${theme}, capturing anyway`);
  }

  await page.evaluate(() => {
    const main = document.querySelector('.agent-main, main.agent-main, main.workbench-main');
    if (main instanceof HTMLElement) main.scrollTop = 0;
    const list = document.querySelector('.agent-config-list');
    if (list instanceof HTMLElement) list.scrollTop = 0;
    const detail = document.querySelector('.agent-detail, aside.agent-detail');
    if (detail instanceof HTMLElement) detail.scrollTop = 0;
    window.scrollTo(0, 0);
  });

  // Extra settle time for CSS transitions, fonts, and lazy async chunks
  await wait(800);

  const file = path.join(outDir, `web-shell-${theme}-1440x810${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, applied, theme };
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
    console.log(`wrote ${r.file}`);
  }
  console.log(`Web visual-qa shell capture done (${results.length} shots) → ${outDir}`);
  console.log('Score with visual-qa-scorecard');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
