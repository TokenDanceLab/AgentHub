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
// config), Vite proxies same-origin browser /client and /web calls to the
// configured Hub. Browser cookies/CSRF remain on the Web origin. Native Edge
// API calls use the separate provisioned native credential lane.
//
// Included specs:
//   - chat-real.spec.ts            Hub/Edge API + IM lifecycle (dev-secret JWT lane)
//   - real-oidc-login.spec.ts      real browser OIDC login + chat flow
//   - private-url-preview.spec.ts  private-URL gate real scenario
//   - golden-flows.spec.ts         Golden Flows：真登录真数据 / regenerate 真
//                                  task identity / demo 诚实门 / edge 回调后自动刷新
//
// CI status: not a PR check; the dispatch-only real-e2e-stack lane runs this
// config. Run locally with all services up:
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
const configuredWebBaseUrl = process.env.AGENTHUB_E2E_WEB_BASE_URL?.trim().replace(/\/+$/, '');
const webBaseUrl = configuredWebBaseUrl || 'http://127.0.0.1:5174';

export default defineConfig({
  testDir: '../e2e',
  // 显式列表 = 真实栈 lane 的 spec 清单（run-real-e2e-lane.sh 默认不带位置
  // 过滤运行本列表全部 spec；新增 real spec 必须在此注册）。
  testMatch: ['chat-real.spec.ts', 'real-oidc-login.spec.ts', 'private-url-preview.spec.ts', 'golden-flows.spec.ts'],
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
    baseURL: webBaseUrl,
    // Pin a real BCP-47 locale: some hosts expose navigator.language like
    // "en-US@posix", which crashes Intl (RangeError) inside the transcript
    // time formatter and hides chat messages.
    locale: 'en-US',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
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
  ...(configuredWebBaseUrl
    ? {}
    : {
        webServer: {
          command: 'pnpm dev --host 127.0.0.1 --port 5174',
          env: { ...process.env, AGENTHUB_WEB_DEV_PROXY_TARGET: process.env.AGENTHUB_E2E_HUB_BASE_URL || 'http://127.0.0.1:8080' },
          url: 'http://127.0.0.1:5174',
          reuseExistingServer: !process.env.CI,
        },
      }),
});
