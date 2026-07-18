/**
 * P74 Visual QA — Web shell capture matrix (#1199)
 * Viewport 1440x810 · themes light+dark · authenticated mock hub
 *
 * Usage (from app/web):
 *   node scripts/visual-qa-shell.mjs
 * Env:
 *   AGENTHUB_WEB_E2E_PORT (default 5174)
 *   WEB_QA_URL / AGENTHUB_WEB_QA_URL — skip vite spawn when set
 *
 * Full multi-scene battery remains visual-qa.mjs; this file is the P74 gate matrix.
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
const themes = ['light', 'dark'];
const THEME_KEY = 'agenthub-v4-theme';
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
      return route.fulfill(
        json(
          hubEnvelope({
            items: [
              {
                id: 'profile_codex',
                name: 'Codex',
                description: 'Shell visual QA profile',
                runtime_id: 'codex',
                provider: 'openai',
                model: 'gpt-5',
                version: 1,
              },
            ],
            page: { hasMore: false },
          }),
        ),
      );
    }
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

async function captureTheme(browser, theme) {
  const context = await browser.newContext({
    viewport,
    serviceWorkers: 'block',
  });
  await installMockHub(context);
  const page = await context.newPage();
  await page.addInitScript(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      window.localStorage.setItem('agenthub-language', 'en');
      window.localStorage.setItem('agenthub_hub_url', 'http://localhost:8080');
      window.sessionStorage.setItem('agenthub_hub_token', 'visual-qa-token');
      window.sessionStorage.setItem(
        'agenthub_hub_user',
        JSON.stringify({ userId: 'user_visual', username: 'visual-reviewer' }),
      );
    },
    { key: THEME_KEY, theme },
  );
  await page.goto(new URL('/', baseUrl).toString(), { waitUntil: 'networkidle' });
  await page.evaluate(
    ({ key, theme: t }) => {
      window.localStorage.setItem(key, t);
      document.documentElement.setAttribute('data-theme', t);
      document.documentElement.style.colorScheme = t;
    },
    { key: THEME_KEY, theme },
  );
  await wait(300);
  const file = path.join(outDir, `web-shell-${theme}-1440x810.png`);
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
  console.log('Score with docs/analysis/visual-qa-scorecard.md');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
