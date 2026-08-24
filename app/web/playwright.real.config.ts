import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real-services E2E lane (L3, #1678 e2e layout convergence).
//
// Runs the cross-package app/e2e/*.real specs against the web dev server wired
// to the live local stack: Hub (http://127.0.0.1:8080) + Edge (http://127.0.0.1:3210).
// These specs live at app/e2e/ (not app/web/src/__e2e__) because they reference
// the full Hub+Edge stack; the Web Hub-only boundary gate forbids Local Edge
// references under app/web/src/. Unlike playwright.config.ts (the CI stubbed-hub
// config), this config does NOT override VITE_HUB_URL / VITE_HUB_WS_URL — the dev
// server keeps its default live-local endpoints, so real login/chat flows reach
// real services.
//
// Included specs:
//   - chat-real.spec.ts            Hub/Edge API + IM lifecycle (dev-secret JWT lane)
//   - real-oidc-login.spec.ts      real browser OIDC login + chat flow (#1839 B2)
//   - private-url-preview.spec.ts  private-URL gate real-scenario (#1922 item 4)
//
// CI status: never run in CI (e2e-smoke only runs smoke.spec.ts under
// playwright.config.ts). Run locally with all services up:
//   pnpm test:e2e:real
// Evidence (report/screenshots/trace) lands in <repo>/tests/artifacts/ per
// tests/artifacts/README.md naming: report-<YYYYMMDD-HHMMSS>.json.

function runTimestamp(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..', '..');
const artifactsDir = path.join(repoRoot, 'tests', 'artifacts');
const stamp = runTimestamp();

export default defineConfig({
  testDir: '../e2e',
  // 显式列表 = 真实栈 lane 的 spec 清单（run-real-e2e-lane.sh 默认不带位置
  // 过滤运行本列表全部 spec；新增 real spec 必须在此注册）。
  testMatch: ['chat-real.spec.ts', 'real-oidc-login.spec.ts', 'private-url-preview.spec.ts'],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  retries: process.env.CI ? 2 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: path.join(artifactsDir, `report-${stamp}.json`) }],
    ['html', { outputFolder: path.join(artifactsDir, `html-${stamp}`), open: 'never' }],
  ],
  // 不按运行时间戳分目录：playwright 会多次加载配置（runner + worker），
  // 时间戳会漂移；报告/HTML 已带时间戳，这里固定目录即可（每次运行覆盖）。
  outputDir: path.join(artifactsDir, 'test-results'),
  use: {
    baseURL: 'http://127.0.0.1:5174',
    // Pin a real BCP-47 locale: some hosts expose navigator.language like
    // "en-US@posix", which crashes Intl (RangeError) inside the transcript
    // time formatter and hides chat messages.
    locale: 'en-US',
    trace: 'on',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
  webServer: {
    command: 'pnpm dev --host 127.0.0.1 --port 5174',
    url: 'http://127.0.0.1:5174',
    reuseExistingServer: !process.env.CI,
  },
});
