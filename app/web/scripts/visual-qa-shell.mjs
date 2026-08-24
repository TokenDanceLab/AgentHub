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
import { mkdir, rm, writeFile } from 'node:fs/promises';
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
// #1866: narrow-tier evidence alongside the 1440×810 gate. The gate
// assertion still only requires the 1440 shots; these extra captures are
// review artifacts for the 768px responsive tier.
const VIEWPORTS = [
  { width: 1440, height: 810, label: '1440x810' },
  { width: 768, height: 900, label: '768x900' },
];
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
        // The capture navigates the origin root. Override the production
        // /workbench/ asset base so the standalone Vite server mounts there,
        // matching the renderer Playwright contract.
        VITE_BASE_PATH: '/',
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

async function captureTheme(browser, theme, vp = { width: 1440, height: 810, label: '1440x810' }) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
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

  // Respect an explicitly supplied QA path while the default spawned server
  // mounts at the origin root through VITE_BASE_PATH above.
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Wait for the workbench shell to appear — confirms React mounted without crash
  try {
    await page.waitForSelector(WORKBENCH_SHELL, { state: 'visible', timeout: 30_000 });
  } catch {
    // Diagnostic capture on failure
    const diagFile = path.join(outDir, `web-shell-${theme}-${vp.label}${dprSuffix}-DIAGNOSTIC.png`);
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
    const diagFile = path.join(outDir, `web-shell-${theme}-${vp.label}${dprSuffix}-AGENTS-DIAGNOSTIC.png`);
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

  const file = path.join(outDir, `web-shell-${theme}-${vp.label}${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });

  // #1866: emit a DOM/geometry contract alongside the PNG so the gate can
  // prove it captured the Agents workbench (not an onboarding/blank shell) and
  // that the page has no horizontal overflow.
  const contract = await page.evaluate(() => {
    // #1874 Slice 3: 证明三 Pane（rail / 已安装列表 / 编辑详情）都真实存在且
    // 有正宽度，而不只是页面存在一个空壳。避免把 onboarding / blank shell
    // 或缺少详情面板的页面误判为已捕获。
    const measure = (el) => {
      if (!el) return { exists: false };
      const rect = el.getBoundingClientRect();
      return { exists: true, width: Math.round(rect.width), height: Math.round(rect.height) };
    };
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
      agentsPage: Boolean(document.querySelector('section.agents-page, .agents-page')),
      activePane: 'installed',
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      panes: {
        // CSS Modules 会哈希类名，不能用 .agent-config-list / aside.agent-detail；
        // 改用全局类 + 语义选择器定位三栏（rail / 中间列表 / 右侧编辑详情）。
        rail: measure(document.querySelector('button[data-rail-page="agents"]')?.closest('nav')),
        list: measure(document.querySelector('.agent-config-row')?.parentElement),
        // #1874: 精确指向编辑详情面板（data-testid），而非第一个 <aside>
        // （第一个 aside 是配置导航 rail，会误把 rail 当作详情面板）。
        detail: measure(document.querySelector('[data-testid="agent-edit-detail"]')),
      },
      // 详情面板是否可内部滚动（内容超高时保存 CTA 可滚动到达）。
      detailScrollable: (() => {
        const el = document.querySelector('[data-testid="agent-edit-detail"]');
        return el ? el.scrollHeight > el.clientHeight + 1 : false;
      })(),
      // 保存 CTA（保存配置/保存中）是否存在且可达：要么在视口内，要么
      // 某个可滚动祖先（桌面详情面板或窄屏页面）能滚动到它（#1874）。
      saveCta: (() => {
        const el = document.querySelector('[data-testid="agent-edit-detail"]');
        const btn = el ? Array.from(el.querySelectorAll('button')).find((b) => /\u4fdd\u5b58/.test(b.textContent || '')) : null;
        if (!btn) return { exists: false };
        const rect = btn.getBoundingClientRect();
        let node = btn.parentElement;
        let scrollable = false;
        while (node) {
          if (node.scrollHeight > node.clientHeight + 1) {
            const oy = getComputedStyle(node).overflowY;
            if (oy === 'auto' || oy === 'scroll') { scrollable = true; break; }
          }
          node = node.parentElement;
        }
        if (!scrollable) {
          scrollable = document.documentElement.scrollHeight > document.documentElement.clientHeight + 1;
        }
        return { exists: true, reachable: rect.bottom <= window.innerHeight || scrollable };
      })(),
    };
  });
  const contractFile = path.join(outDir, `web-shell-${theme}-${vp.label}${dprSuffix}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');

  // #1874: cover three structurally-different panes (Installed/Tools/Audit) at
  // the gate viewport so the shell gate proves more than a single surface.
  if (vp.label === '1440x810') {
    for (const paneId of ['tools', 'audit']) {
      await capturePane(page, theme, vp, paneId, dprSuffix);
    }
  }

  const applied = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
  await context.close();
  return { file, contractFile, contract, applied, theme };
}

async function capturePane(page, theme, vp, paneId, dprSuffix) {
  if (paneId !== 'installed') {
    const btn = page.locator(`button[data-pane-id="${paneId}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 10_000 });
    await btn.click();
    await wait(400);
  }
  const file = path.join(outDir, `web-shell-${theme}-${vp.label}-${paneId}${dprSuffix}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const contract = await page.evaluate((pane) => {
    const heading = document.querySelector('section.agents-page h1');
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      workbenchShell: Boolean(document.querySelector('[data-testid="agenthub-workbench"]')),
      agentsPage: Boolean(document.querySelector('section.agents-page, .agents-page')),
      activePane: pane,
      paneHeading: heading ? heading.textContent.trim() : '',
      horizontalOverflow:
        document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  }, paneId);
  const contractFile = path.join(outDir, `web-shell-${theme}-${vp.label}-${paneId}${dprSuffix}.json`);
  await writeFile(contractFile, JSON.stringify(contract, null, 2) + '\n');
  return { file, contractFile, contract };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  // Remove the expected outputs before capture. If navigation/rendering fails,
  // a later assertion must not pass on PNGs left by an older run.
  for (const theme of themes) {
    await rm(path.join(outDir, `web-shell-${theme}-1440x810${dprSuffix}.png`), { force: true });
  }
  const server = await maybeStartDevServer();
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const vp of VIEWPORTS) {
      for (const theme of themes) {
        results.push(await captureTheme(browser, theme, vp));
      }
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
  console.log(`Web visual-qa shell capture done (${results.length} shots) → ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
