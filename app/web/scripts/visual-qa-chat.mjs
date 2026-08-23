/**
 * P76 Visual QA — Web Chat path capture (#1314)
 * Viewport 1440x810 · themes light+dark · mock hub · Chat main path (not Agents)
 *
 * Optional density gate companion (does NOT replace visual:qa:shell merge gate).
 * Score notes: visual-qa-scorecard §4 Chat path
 *
 * Usage (from app/web):
 *   node scripts/visual-qa-chat.mjs
 *   pnpm --filter agenthub-web visual:qa:chat
 * Env: VISUAL_QA_DPR · AGENTHUB_WEB_E2E_PORT · WEB_QA_URL / AGENTHUB_WEB_QA_URL
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
// Locale-stable rail selector: the nav aria-label resolves through chatview
// i18n (zh: 全局导航栏), so target the data-rail-page hook instead (#1826).
const CHAT_RAIL_BUTTON = 'button[data-rail-page="chat"]';
// Locale note (#1826): aria-labels resolve through chatview i18n — keep
// zh+en alternatives (or stable hooks) for every label-based selector.
const WORKSPACE = 'main#main-content, [role="main"]#main-content, main[aria-label="Workspace"], main[aria-label="工作区"]';
const COMPOSER = 'textarea, [aria-label="Composer input"], [aria-label="输入框"], [placeholder*="发消息"]';
const INSPECTOR = 'aside[aria-label="Right inspector"], aside[aria-label="右侧窗口"]';
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
        json({ status: 'ok', version: 'web-visual-qa-chat', uptime: '1h', checks: {} }),
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
              session_id: 'session_web_chat',
              type: 'group',
              name: 'Chat density review',
              owner_user_id: 'user_visual',
              created_at: '2026-05-30T01:10:00Z',
              updated_at: '2026-05-30T01:30:00Z',
            },
          ]),
        ),
      );
    }
    if (pathname.includes('/client/edges') || pathname.includes('/client/targets')) {
      return route.fulfill(
        json(
          hubEnvelope({
            items: [
              {
                id: 'target-local-edge-1',
                label: 'Alpha Desktop',
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
    viewport,
    deviceScaleFactor: dpr,
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

  const appUrl = new URL('/', baseUrl).toString();
  await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 45_000 });

  try {
    await page.waitForSelector(WORKBENCH_SHELL, { state: 'visible', timeout: 30_000 });
  } catch {
    const diagFile = path.join(outDir, `web-chat-${theme}-1440x810${dprSuffix}-DIAGNOSTIC.png`);
    await page.screenshot({ path: diagFile, fullPage: false });
    throw new Error(`Workbench shell not visible for chat theme=${theme}. Diagnostic: ${diagFile}`);
  }

  // Prefer Chat rail (not Agents) so capture shows transcript + composer + inspector.
  try {
    const chatRail = page.locator(CHAT_RAIL_BUTTON).first();
    if (await chatRail.isVisible().catch(() => false)) {
      await chatRail.click();
    }
  } catch {
    /* mock shell may already be on chat */
  }

  await page.waitForSelector(WORKSPACE, { state: 'visible', timeout: 15_000 }).catch(() => {});

  // Select first conversation in sidebar if present.
  try {
    const firstConvo = page
      .locator(
        '[aria-label="Conversation sidebar"] button, [aria-label="会话侧边栏"] button, [aria-label="Conversation sidebar"] [role="button"], [aria-label="会话侧边栏"] [role="button"], .conversation-item, [data-testid*="conversation"]',
      )
      .first();
    if (await firstConvo.isVisible().catch(() => false)) {
      await firstConvo.click();
    }
  } catch {
    /* optional */
  }

  await page.evaluate(
    ({ v4Key, legacyKey, theme: t }) => {
      window.localStorage.setItem(v4Key, t);
      window.localStorage.setItem(legacyKey, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { v4Key: THEME_KEY_V4, legacyKey: THEME_KEY_LEGACY, theme },
  );

  await page
    .waitForFunction(
      () => {
        const shell = document.querySelector('[data-testid="agenthub-workbench"]');
        const body = document.body;
        return Boolean(shell) && Boolean(body) && body.innerText.trim().length > 5;
      },
      { timeout: 12_000 },
    )
    .catch(() => {
      console.warn(`warn: chat content check inconclusive for theme=${theme}`);
    });

  // Prefer composer + inspector presence for density review shots.
  const hasComposer = await page.locator(COMPOSER).first().isVisible().catch(() => false);
  const hasInspector = await page.locator(INSPECTOR).first().isVisible().catch(() => false);
  if (!hasComposer) console.warn(`warn: composer not visible for theme=${theme}`);
  if (!hasInspector) console.warn(`warn: inspector not visible for theme=${theme}`);

  await wait(800);

  const file = path.join(outDir, `web-chat-${theme}-1440x810${dprSuffix}.png`);
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
  console.log(`Web visual-qa chat capture done (${results.length} shots) → ${outDir}`);
  console.log('Optional density notes — not the Agents shell merge gate. See scorecard §4.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
