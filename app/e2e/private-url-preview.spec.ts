import { test, expect, type BrowserContext, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * AgentHub 私有 URL 验证真实场景 spec — issue #1922 项4（L3，observed-local）。
 *
 * 验证对象：现有 preview scheme+capability 门禁在真实栈上的行为
 * （`app/shared/src/ui/previewSandbox.ts` isSafeRemotePreviewUrl +
 * transcript RowItem `previewExternalOpenEnabled` 双门禁 + inspector
 * BrowserPreview 的 iframe 门禁）。本 spec 不新增门禁逻辑、不新增
 * 私有主机分类器——只验证现有门禁 + 产出脱敏证据形状。
 *
 * ── 诚实边界：真实栈部分 ──
 *   - 全栈健康预检（TokenDance ID / hub / web）与缺栈 test.skip；
 *   - 真实 TokenDance ID OIDC Authorization Code + PKCE 浏览器登录
 *     （与 real-oidc-login.spec.ts 同一登录动线，无自签 JWT/旁路）；
 *   - 已认证工作台为真实 dev server 渲染的真实页面；
 *   - 被挂载的组件（RowItem / BrowserPreview）从运行中页面的模块图
 *     动态发现并导入——即真实运行 bundle 里的组件代码本体，不是
 *     单测重建；i18n 降级文案也从应用自己的 i18next 实例读取；
 *   - 网络断言为 context 级真实浏览器网络平面监听（复刻 #1884 回归
 *     语义：预览路径不得产生任何栈外第三方请求——单测 jsdom 无法
 *     观测真实网络，这正是本 spec 的增量证据价值）。
 *
 * ── 诚实边界：注入部分 ──
 *   预览 URL 本身（javascript: / data: / protocol-relative / https 各形状）
 *   是注入的，不是真实 run 产出的。原因：
 *   1. 真实 surfacing（edge-server/internal/adapters/surfacing_emit.go）
 *      只产出 Edge 相对 URL（api/runs/<runId>/artifacts/<artifactId>/preview
 *      形状，无 scheme），且需要真实 agent runtime 在 workspace 非确定地
 *      产出 .html 才可触发——lane 内不可可靠复现；
 *   2. 非安全 scheme URL 从不出现在真实 surfacing 路径上——它们是
 *      门禁防御的不可信输入形状，验证必须显式注入。
 *   注入方式 = 在已认证真实页面内挂载应用自己的组件（上述真实渲染
 *   路径），而非另起独立测试页面。
 *
 * ── 明确不验证 ──
 *   绝对 http(s) URL 的私有主机分类：当前门禁是 scheme 级
 *   （isSafeRemotePreviewUrl 只检查 ^https?:// 前缀）。已知带
 *   authority userinfo（user:pass@host 形状）的 URL 目前能通过
 *   scheme 门禁——主线已另开 issue 跟踪，本 spec 不对该形状做断言。
 *
 * 前置（本机全栈：TokenDance ID :3000 / hub :8080 / web :5174）：
 *   bash scripts/e2e/provision-real-e2e-stack.sh
 *   （供给测试账号并落凭据到 tests/artifacts/real-e2e-account.env，gitignored）
 *
 * 运行：
 *   cd app/web && pnpm exec playwright test --config playwright.real.config.ts \
 *     --project=chromium private-url-preview.spec.ts
 *
 * 证据等级：observed-local（real_tested=true 时，本地单机真栈）。
 * CI 状态：不进 CI（与 playwright.real.config.ts 同语义，仅本地真栈运行）。
 */

interface RealE2ECredentials {
  idBaseUrl: string;
  hubBaseUrl: string;
  edgeBaseUrl: string;
  webBaseUrl: string;
  userEmail: string;
  userPassword: string;
}

const SPEC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SPEC_DIR, '..', '..');
const ACCOUNT_ENV_PATH = path.join(REPO_ROOT, 'tests', 'artifacts', 'real-e2e-account.env');
const WORKBENCH_PATH = '/workbench/';

/** 挂载宿主容器 id（注入组件挂在此容器内，断言全部限定在此作用域）。 */
const MOUNT_HOST_ID = 'real-e2e-private-url-preview-host';

/**
 * 非安全 scheme 用例。protocol-relative 用例的主机名使用 RFC 保留的
 * .invalid TLD（永不可解析），且避开内网后缀（internal/local/corp/lan），
 * 保证失败信息进入报告后仍满足证据脱敏合同（#1873）。
 */
const UNSAFE_PREVIEW_CASES = [
  { caseId: 'unsafe-javascript', url: 'javascript:alert(1)' },
  { caseId: 'unsafe-data', url: 'data:text/html,<h1>blocked</h1>' },
  { caseId: 'unsafe-protocol-relative', url: '//preview-host.invalid/page.html' },
] as const;

function envValue(key: string): string {
  return process.env[key]?.trim() ?? '';
}

function readAccountEnvFile(): Record<string, string> {
  if (!fs.existsSync(ACCOUNT_ENV_PATH)) return {};
  const parsed: Record<string, string> = {};
  for (const line of fs.readFileSync(ACCOUNT_ENV_PATH, 'utf8').split('\n')) {
    const separator = line.indexOf('=');
    if (separator > 0) parsed[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return parsed;
}

/** 凭据优先级：环境变量 > tests/artifacts/real-e2e-account.env（供给脚本产物）。 */
function loadCredentials(): RealE2ECredentials | null {
  const file = readAccountEnvFile();
  const pick = (envKey: string, fileKey: string): string => envValue(envKey) || file[fileKey] || '';
  const credentials: RealE2ECredentials = {
    idBaseUrl: pick('AGENTHUB_E2E_ID_BASE_URL', 'AGENTHUB_E2E_ID_BASE_URL') || 'http://127.0.0.1:3000',
    hubBaseUrl: pick('AGENTHUB_E2E_HUB_BASE_URL', 'AGENTHUB_E2E_HUB_BASE_URL') || 'http://127.0.0.1:8080',
    edgeBaseUrl: pick('AGENTHUB_E2E_EDGE_BASE_URL', 'AGENTHUB_E2E_EDGE_BASE_URL') || 'http://127.0.0.1:3210',
    webBaseUrl: pick('AGENTHUB_E2E_WEB_BASE_URL', 'AGENTHUB_E2E_WEB_BASE_URL') || 'http://127.0.0.1:5174',
    userEmail: pick('AGENTHUB_E2E_USER_EMAIL', 'AGENTHUB_E2E_USER_EMAIL'),
    userPassword: pick('AGENTHUB_E2E_USER_PASSWORD', 'AGENTHUB_E2E_USER_PASSWORD'),
  };
  if (!credentials.userEmail || !credentials.userPassword) return null;
  return credentials;
}

async function urlReachable(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.status < 500;
  } catch {
    return false;
  }
}

/** 本 spec 只依赖 id/hub/web（预览门禁是前端面）；edge 不参与预检。 */
async function stackIsUp(credentials: RealE2ECredentials): Promise<boolean> {
  const idOk = await urlReachable(`${credentials.idBaseUrl}/.well-known/openid-configuration`);
  const hubOk = await urlReachable(`${credentials.hubBaseUrl}/health`);
  const webOk = await urlReachable(`${credentials.webBaseUrl}${WORKBENCH_PATH}`);
  return idOk && hubOk && webOk;
}

const credentials = loadCredentials();

/**
 * 本机离线环境无法加载 Cloudflare Turnstile CDN 脚本；abort 触发前端组件的
 * 错误分支从而允许提交。服务端 Turnstile 校验未配置 secret 时恒通过
 * （TokenDance ID 源码注释明示），故此处理不构成任何安全旁路。
 * （与 real-oidc-login.spec.ts 同步；被 abort 的 turnstile 请求在网络
 * 断言中按「已阻断的登录期栈外请求」豁免，见 observeNetwork。）
 */
async function blockTurnstileCdn(context: BrowserContext): Promise<void> {
  await context.route('**/challenges.cloudflare.com/**', (route) => route.abort());
}

/**
 * 真实 OIDC 浏览器登录：工作台触发 → TokenDance ID 登录页 → 提交凭据 →
 * consent 授权页 → 回调回 web → hub 交换出会话 token。
 * 返回登录后 sessionStorage 中 hub 颁发的 access token。
 * （逻辑与 real-oidc-login.spec.ts 的 performRealOidcLogin 保持同步。）
 */
async function performRealOidcLogin(page: Page, email: string, password: string, idBaseUrl: string): Promise<string> {
  await page.goto(WORKBENCH_PATH, { waitUntil: 'domcontentloaded' });

  // 未认证时工作台无直接登录按钮；在 composer 提交触发 ensureAuth 打开登录浮层。
  const composer = page.locator('textarea[data-composer-input]').first();
  await composer.click();
  await composer.fill('real-e2e: open sign-in');
  await composer.press('Enter');

  const loginButton = page.getByRole('button', { name: /Continue with TokenDance|使用 TokenDance ID 登录/i }).first();
  await expect(loginButton).toBeVisible({ timeout: 10_000 });
  await loginButton.click();

  // 真实重定向到 TokenDance ID（OIDC authorize → 302 到 /login）。
  // 用 toHaveURL 轮询而不是 waitForURL：后者绑定导航生命周期事件，
  // 在 vite 快速响应下会错过已提交的导航（实测 flake）。
  const idHost = new URL(idBaseUrl).host.replace(/\./g, '\\.');
  await expect(page).toHaveURL(new RegExp(`${idHost}/login`), { timeout: 20_000 });

  // TokenDance ID 真实登录表单。
  await expect(page.locator('#login-email')).toBeVisible({ timeout: 15_000 });
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  const submitLogin = page.locator('button.login-submit');
  await expect(submitLogin).toBeEnabled({ timeout: 20_000 });
  await submitLogin.click();

  // consent 授权页（服务端渲染；client 未信任且 prompt=consent）。
  const consentForm = page.locator('form[action="/oidc/authorize/confirm"]');
  await expect(consentForm).toBeVisible({ timeout: 20_000 });
  const approveButton = consentForm.locator('button[type="submit"]');
  await expect(approveButton).toBeVisible();

  await approveButton.click({ noWaitAfter: true });

  // web SPA 用 PKCE verifier 与 hub 交换真实会话（无旁路）。
  await expect
    .poll(() => page.evaluate((key) => sessionStorage.getItem(key), 'agenthub_hub_token'), {
      timeout: 30_000,
      message: 'waiting for hub-issued session after real OIDC code exchange',
    })
    .not.toBeNull();

  // 回调路由被清理，回到工作台。
  await expect(page).not.toHaveURL(/auth\/tokendance\/callback/, { timeout: 15_000 });
  const token = await page.evaluate((key) => sessionStorage.getItem(key), 'agenthub_hub_token');
  expect(token).toBeTruthy();
  return String(token);
}

// ── 网络观测（断言 B：#1884 回归语义的真实浏览器版）──────────────────

type LanePhase = 'login' | 'preview';

interface ObservedRequest {
  request: Request;
  host: string;
  phase: LanePhase;
}

/**
 * context 级监听：覆盖登录 + 预览两个阶段的全部请求。
 * 栈内主机 = 四个配置化 endpoint 的 host（含端口）；断言时按
 * 「预览阶段零栈外请求；全程栈外请求必须是被 route abort 的
 * turnstile（登录页已知外部依赖，已被阻断）」裁决。
 */
function observeNetwork(context: BrowserContext, stackHosts: ReadonlySet<string>) {
  const observed: ObservedRequest[] = [];
  let phase: LanePhase = 'login';
  context.on('request', (request) => {
    let host: string;
    try {
      host = new URL(request.url()).host;
    } catch {
      host = 'unparseable';
    }
    observed.push({ request, host, phase });
  });
  return {
    markPreviewPhase(): void {
      phase = 'preview';
    },
    summarize() {
      const previewPhaseOffStack: string[] = [];
      const nonAbortedOffStack: string[] = [];
      for (const entry of observed) {
        if (stackHosts.has(entry.host)) continue;
        const failed = entry.request.failure() !== null;
        const isAbortedTurnstile = entry.host === 'challenges.cloudflare.com' && failed && entry.phase === 'login';
        if (!isAbortedTurnstile && !failed) nonAbortedOffStack.push(entry.request.url());
        if (entry.phase === 'preview') previewPhaseOffStack.push(entry.request.url());
      }
      return { previewPhaseOffStack, nonAbortedOffStack, total: observed.length };
    },
  };
}

function stackHostSet(credentials: RealE2ECredentials): Set<string> {
  const hosts = new Set<string>();
  for (const base of [credentials.idBaseUrl, credentials.hubBaseUrl, credentials.edgeBaseUrl, credentials.webBaseUrl]) {
    try {
      hosts.add(new URL(base).host);
    } catch {
      // 非法 base 由预检兜底，这里忽略。
    }
  }
  return hosts;
}

// ── 模块发现与挂载（注入预览 URL 进应用自己的渲染路径）──────────────

interface AppModuleUrls {
  react: string;
  reactDomClient: string;
  rowItem: string;
  browserPreview: string;
  i18next: string;
  chatviewI18nResources: string;
}

/**
 * 从运行中页面的 resource timing 里发现真实 bundle 已加载模块的 URL。
 * 这些 URL 只在运行期内存中使用，不写入任何断言信息/报告（其中共享
 * 模块的 /@fs/ URL 含服务器绝对路径，属私有运行事实）。
 */
async function discoverAppModuleUrls(page: Page): Promise<AppModuleUrls> {
  return page.evaluate(() => {
    const urls = performance.getEntriesByType('resource').map((entry) => entry.name);
    const find = (needles: string[]): string => {
      for (const needle of needles) {
        const hit = urls.find((url) => url.includes(needle));
        if (hit) return hit;
      }
      return '';
    };
    return {
      // 首选 Vite 预构建 dep URL；fallback 为未预构建时的源模块 URL。
      react: find(['/.vite/deps/react.js', 'node_modules/react/index.js']),
      reactDomClient: find(['/.vite/deps/react-dom_client.js', 'node_modules/react-dom/client.js']),
      rowItem: find(['chatview/components/RowItem.tsx']),
      browserPreview: find(['inspector/BrowserPreview.tsx']),
      i18next: find(['/.vite/deps/i18next.js', 'node_modules/i18next/dist/']),
      chatviewI18nResources: find(['chatview/i18n/resources.ts']),
    };
  });
}

function allModuleUrlsDiscovered(urls: AppModuleUrls): boolean {
  return Object.values(urls).every((url) => url.length > 0);
}

async function waitForModuleUrls(page: Page): Promise<AppModuleUrls> {
  await expect
    .poll(async () => allModuleUrlsDiscovered(await discoverAppModuleUrls(page)), {
      timeout: 20_000,
      message: 'waiting for RowItem/BrowserPreview/react modules to appear in the running bundle module graph',
    })
    .toBe(true);
  return discoverAppModuleUrls(page);
}

interface RowItemMountCase {
  caseId: string;
  /** 预览 URL（被测注入输入）。 */
  url: string;
  /** 镜像 ConversationHost 的 platform.capabilities.browserPreview 门禁值。 */
  externalOpenEnabled: boolean;
}

interface BrowserPreviewMountCase {
  caseId: string;
  url: string;
}

interface MountPlan {
  moduleUrls: AppModuleUrls;
  rowItemCases: RowItemMountCase[];
  browserPreviewCases: BrowserPreviewMountCase[];
}

/**
 * 在真实页面内用应用自己的 React/ReactDOM 与真实组件模块挂载被测表面。
 * 返回应用自身 i18next 实例里的降级文案（browserPreview.unsafeUrl），
 * 供断言 C 使用——不硬编文案（文案不是行为合同，见 AGENTS §10）。
 */
async function mountPreviewSurfaces(page: Page, plan: MountPlan): Promise<{ downgradeText: string }> {
  return page.evaluate(async ({ moduleUrls, rowItemCases, browserPreviewCases }) => {
    for (const [name, url] of Object.entries(moduleUrls)) {
      if (!url) throw new Error(`running bundle module graph missing module: ${name}`);
    }
    const reactMod = await import(moduleUrls.react);
    const reactDomClientMod = await import(moduleUrls.reactDomClient);
    const rowItemMod = await import(moduleUrls.rowItem);
    const browserPreviewMod = await import(moduleUrls.browserPreview);
    const i18nextMod = await import(moduleUrls.i18next);
    const i18nResMod = await import(moduleUrls.chatviewI18nResources);

    const React = reactMod.default ?? reactMod;
    const i18n = i18nextMod.default ?? i18nextMod;
    const namespace = i18nResMod.CHATVIEW_I18N_NAMESPACE as string;
    const downgradeText =
      i18n && typeof i18n.t === 'function' ? String(i18n.t('browserPreview.unsafeUrl', { ns: namespace }) ?? '') : '';

    const children = [];
    for (const rowCase of rowItemCases) {
      // item 形状对齐 RowItem.test.tsx 的 preview fixture（type:'preview' + url）。
      const item = {
        id: `real-e2e-${rowCase.caseId}`,
        type: 'preview',
        label: 'Preview',
        status: 'ok',
        collapsible: true,
        open: true,
        content: 'preview',
        url: rowCase.url,
        previewDomain: '',
        previewTitle: rowCase.url,
      };
      children.push(
        React.createElement(
          'div',
          { key: `row-${rowCase.caseId}`, 'data-preview-case': rowCase.caseId },
          React.createElement(rowItemMod.RowItem, { item, previewExternalOpenEnabled: rowCase.externalOpenEnabled }),
        ),
      );
    }
    for (const bpCase of browserPreviewCases) {
      children.push(
        React.createElement(
          'div',
          { key: `bp-${bpCase.caseId}`, 'data-browser-preview-case': bpCase.caseId },
          React.createElement(browserPreviewMod.BrowserPreview, { url: bpCase.url, onClose: () => {} }),
        ),
      );
    }

    let host = document.getElementById('real-e2e-private-url-preview-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'real-e2e-private-url-preview-host';
      document.body.appendChild(host);
    }
    host.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147483647;width:420px;max-height:70vh;overflow:auto;padding:12px;';
    host.innerHTML = '';
    const root = reactDomClientMod.createRoot(host);
    root.render(React.createElement(React.Fragment, null, ...children));
    await new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    });
    return { downgradeText };
  }, plan);
}

// ── 测试 ──────────────────────────────────────────────────────────────

test.describe('私有 URL 验证真实场景 (#1922 项4)', () => {
  test.beforeEach(async () => {
    test.skip(!credentials, 'missing test credentials: run bash scripts/e2e/provision-real-e2e-stack.sh first');
    if (credentials && !(await stackIsUp(credentials))) {
      test.skip(true, 'local real stack not up: start TokenDance ID :3000 / hub :8080 / web :5174 first');
    }
  });

  test('门禁生效且栈外零请求：非安全 scheme 预览卡惰性、点击无导航', async ({ page }) => {
    test.setTimeout(180_000);
    const creds = credentials!;

    // 扩大 resource timing 缓冲：发现模块 URL 依赖完整模块加载记录。
    await page.context().addInitScript(() => {
      if (typeof performance !== 'undefined' && performance.setResourceTimingBufferSize) {
        performance.setResourceTimingBufferSize(8000);
      }
    });

    const network = observeNetwork(page.context(), stackHostSet(creds));
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => {
      dialogs.push(dialog.message());
      void dialog.dismiss();
    });

    await blockTurnstileCdn(page.context());
    const token = await performRealOidcLogin(page, creds.userEmail, creds.userPassword, creds.idBaseUrl);
    expect(token).toBeTruthy();
    network.markPreviewPhase();

    // 已认证工作台（真实会话）；chat 页面加载即载入 transcript 模块图。
    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible({ timeout: 15_000 });
    const urlBeforeMount = page.url();

    const moduleUrls = await waitForModuleUrls(page);
    const safeExternalUrl = `${creds.webBaseUrl}${WORKBENCH_PATH}`;
    await mountPreviewSurfaces(page, {
      moduleUrls,
      rowItemCases: [
        ...UNSAFE_PREVIEW_CASES.map((unsafeCase) => ({ caseId: unsafeCase.caseId, url: unsafeCase.url, externalOpenEnabled: true })),
        { caseId: 'safe-https', url: safeExternalUrl, externalOpenEnabled: true },
        { caseId: 'safe-https-capability-off', url: safeExternalUrl, externalOpenEnabled: false },
      ],
      browserPreviewCases: [],
    });

    const host = page.locator(`#${MOUNT_HOST_ID}`);

    // A1：非安全 scheme → 惰性 blocked 卡（div，不是可点击外逃的 anchor）。
    for (const unsafeCase of UNSAFE_PREVIEW_CASES) {
      const scope = host.locator(`[data-preview-case="${unsafeCase.caseId}"]`);
      await expect(scope.locator('div.preview-card.preview-card-blocked')).toHaveCount(1);
      await expect(scope.locator('a.preview-card')).toHaveCount(0);
    }

    // A2：门禁另一面——安全 http(s) + capability 开 → 外链卡（仅渲染断言，不点击）。
    const safeAnchor = host.locator('[data-preview-case="safe-https"] a.preview-card');
    await expect(safeAnchor).toHaveCount(1);
    await expect(safeAnchor).toHaveAttribute('href', safeExternalUrl);
    await expect(safeAnchor).toHaveAttribute('target', '_blank');
    expect(String(await safeAnchor.getAttribute('rel'))).toContain('noopener');

    // A3：capability 关 → 即便安全 URL 也保持惰性（能力门禁面）。
    const capabilityOffScope = host.locator('[data-preview-case="safe-https-capability-off"]');
    await expect(capabilityOffScope.locator('div.preview-card.preview-card-blocked')).toHaveCount(1);
    await expect(capabilityOffScope.locator('a.preview-card')).toHaveCount(0);

    // A4：点击 blocked 卡——无导航、无 scheme 执行（对话框为零）、无新请求。
    for (const unsafeCase of UNSAFE_PREVIEW_CASES) {
      await host.locator(`[data-preview-case="${unsafeCase.caseId}"] div.preview-card.preview-card-blocked`).click();
    }
    await page.waitForTimeout(500);
    expect(page.url()).toBe(urlBeforeMount);
    expect(dialogs).toEqual([]);

    // B：预览阶段零栈外请求；全程栈外请求必须已阻断（仅 turnstile 豁免）。
    const summary = network.summarize();
    expect(summary.previewPhaseOffStack, 'preview phase must not issue any off-stack request').toEqual([]);
    expect(summary.nonAbortedOffStack, 'no unblocked off-stack request is allowed anywhere in the lane').toEqual([]);
  });

  test('降级提示与 iframe 门禁：BrowserPreview 对非安全 scheme 不加载 iframe', async ({ page }) => {
    test.setTimeout(180_000);
    const creds = credentials!;

    await page.context().addInitScript(() => {
      if (typeof performance !== 'undefined' && performance.setResourceTimingBufferSize) {
        performance.setResourceTimingBufferSize(8000);
      }
    });

    const network = observeNetwork(page.context(), stackHostSet(creds));
    await blockTurnstileCdn(page.context());
    const token = await performRealOidcLogin(page, creds.userEmail, creds.userPassword, creds.idBaseUrl);
    expect(token).toBeTruthy();
    network.markPreviewPhase();

    await expect(page.getByRole('button', { name: 'Chat', exact: true })).toBeVisible({ timeout: 15_000 });

    const moduleUrls = await waitForModuleUrls(page);
    // iframe 对照用例使用栈内真实地址（真实加载、可被网络监听覆盖）。
    const safeIframeUrl = `${creds.hubBaseUrl}/health`;
    const { downgradeText } = await mountPreviewSurfaces(page, {
      moduleUrls,
      rowItemCases: [],
      browserPreviewCases: [
        { caseId: 'unsafe-js', url: 'javascript:alert(1)' },
        { caseId: 'safe-stack', url: safeIframeUrl },
      ],
    });

    const host = page.locator(`#${MOUNT_HOST_ID}`);

    // C：降级提示文案出现——期望值来自应用自己的 i18next 实例（不硬编文案）。
    expect(downgradeText.length, 'app i18n downgrade string must be resolvable').toBeGreaterThan(0);
    const unsafePane = host.locator('[data-browser-preview-case="unsafe-js"] section');
    const blockedNote = unsafePane.locator('[role="note"]');
    await expect(blockedNote).toBeVisible();
    await expect(blockedNote).toHaveText(downgradeText);
    // 非安全 URL 不得进入 iframe。
    await expect(unsafePane.locator('iframe')).toHaveCount(0);

    // 对照：栈内安全 http(s) → 带 sandbox 的 iframe 真实加载，无降级提示。
    const safePane = host.locator('[data-browser-preview-case="safe-stack"] section');
    const safeIframe = safePane.locator('iframe');
    await expect(safeIframe).toHaveCount(1);
    await expect(safeIframe).toHaveAttribute('sandbox', 'allow-scripts');
    await expect(safeIframe).toHaveAttribute('src', safeIframeUrl);
    await expect(safePane.locator('[role="note"]')).toHaveCount(0);

    // B（本测试窗口）：预览阶段零栈外请求（含 iframe 真实加载产生的请求）。
    const summary = network.summarize();
    expect(summary.previewPhaseOffStack, 'preview phase must not issue any off-stack request').toEqual([]);
    expect(summary.nonAbortedOffStack, 'no unblocked off-stack request is allowed anywhere in the lane').toEqual([]);
  });
});
