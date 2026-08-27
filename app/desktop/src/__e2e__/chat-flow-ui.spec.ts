import { expect, test, type Page } from '@playwright/test';
import {
  assertE2EDataModeScenario,
  classifyE2ERequest,
  createE2EDataModeScenario,
  type E2ERequestPhase,
  type E2EObservedRequest,
} from '../../../shared/src/testing/e2eDataModeContract';

const DESKTOP_E2E_PORT = Number(process.env.AGENTHUB_DESKTOP_E2E_PORT ?? 5199);
const DESKTOP_E2E_APP_ORIGIN = `http://127.0.0.1:${DESKTOP_E2E_PORT}`;
const DESKTOP_WORKSPACE_VIEWPORT = { width: 1440, height: 810 };
const NARROW_REGRESSION_VIEWPORT = { width: 390, height: 820 };
const DESKTOP_MOCK_CHAT_FLOW_SCENARIO = createE2EDataModeScenario({
  name: 'desktop-chat-flow-ui',
  surface: 'desktop',
  dataMode: 'mock',
  dataSource: 'local-mock',
  appOrigin: DESKTOP_E2E_APP_ORIGIN,
  mockAdapterUsed: true,
});

interface BackendRequestLog {
  requests: E2EObservedRequest[];
  markWorkbenchRuntime: () => void;
}

test.describe('Desktop shared chat flow UI', () => {
  test.describe.configure({ timeout: 60_000 });

  test('keeps submitted user messages visible, distinct, and auto-followed', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await blockLiveBackends(page);
    await enterDemoWorkbench(page, backendRequests.markWorkbenchRuntime);
    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);
    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-data-mode', 'mock');
    await expect(page.getByText('mock (auto fallback)')).toHaveCount(0);
    await expect(page.getByText('demo+edge')).toHaveCount(0);

    const transcript = page.getByRole('log');
    await expectTranscriptWithoutModeDebug(transcript);
    const firstMessage = `Playwright chat flow ${Date.now()}`;
    const repeatedMessage = `Repeated chat flow ${Date.now()}`;

    await installMessagePresenceProbe(page, firstMessage);
    await submitComposerMessage(page, firstMessage);

    await expect(transcript.locator('.user-bubble').filter({ hasText: firstMessage })).toHaveCount(1);
    await expect.poll(() => messagePresenceProbe(page)).toMatchObject({
      sawVisible: true,
      disappearedAfterVisible: false,
    });
    await expect.poll(() => transcriptScrollGap(page)).toBeLessThanOrEqual(4);

    await submitComposerMessage(page, repeatedMessage);
    await submitComposerMessage(page, repeatedMessage);

    await expect(transcript.locator('.user-bubble').filter({ hasText: repeatedMessage })).toHaveCount(2);
    await expect.poll(() => transcriptScrollGap(page)).toBeLessThanOrEqual(4);
    assertE2EDataModeScenario(DESKTOP_MOCK_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });

  test('does not create horizontal overflow at the 16:9 desktop workspace viewport', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await blockLiveBackends(page);

    await page.setViewportSize(DESKTOP_WORKSPACE_VIEWPORT);
    await enterDemoWorkbench(page, backendRequests.markWorkbenchRuntime);
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1);
    assertE2EDataModeScenario(DESKTOP_MOCK_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });

  test('renders consecutive approval and preview cards as one merged stack', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await blockLiveBackends(page);

    await page.setViewportSize(DESKTOP_WORKSPACE_VIEWPORT);
    await enterDemoWorkbench(page, backendRequests.markWorkbenchRuntime);

    await expect.poll(() => approvalPreviewCardStackMetrics(page)).toMatchObject({
      exists: true,
    });

    const metrics = await approvalPreviewCardStackMetrics(page);
    expect(metrics.exists).toBe(true);
    expect(Math.abs(metrics.verticalGap)).toBeLessThanOrEqual(1);
    expect(metrics.leftDelta).toBeLessThanOrEqual(1);
    expect(metrics.widthDelta).toBeLessThanOrEqual(1);
    expect(metrics.approvalBottomLeftRadius).toBeLessThanOrEqual(0.5);
    expect(metrics.approvalBottomRightRadius).toBeLessThanOrEqual(0.5);
    expect(metrics.previewTopLeftRadius).toBeLessThanOrEqual(0.5);
    expect(metrics.previewTopRightRadius).toBeLessThanOrEqual(0.5);
    expect(metrics.approvalTopLeftRadius).toBeGreaterThan(0);
    expect(metrics.previewBottomLeftRadius).toBeGreaterThan(0);
    assertE2EDataModeScenario(DESKTOP_MOCK_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });

  test('does not create horizontal overflow at the narrow regression viewport', async ({ page }) => {
    collectPageDiagnostics(page);
    const backendRequests = await blockLiveBackends(page);

    await page.setViewportSize(NARROW_REGRESSION_VIEWPORT);
    await enterDemoWorkbench(page, backendRequests.markWorkbenchRuntime);
    await expect.poll(() => horizontalOverflow(page)).toBeLessThanOrEqual(1);
    assertE2EDataModeScenario(DESKTOP_MOCK_CHAT_FLOW_SCENARIO, backendRequests.requests);
  });
});

async function enterDemoWorkbench(page: Page, onWorkbenchRuntime?: () => void): Promise<void> {
  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('agenthub.workbench.composerSubmitBehavior');
      // First-run onboarding (#1819) is a one-time product overlay; this
      // suite tests chat-flow behavior, so seed it as seen (persisted state)
      // to keep the mock workbench deterministically interactive (#1995).
      window.localStorage.setItem('agenthub_onboarding_seen', 'true');
    } catch {
      // Some initial browser documents deny localStorage; the app origin will still run this script.
    }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const demoButton = page.getByRole('button', { name: /^(使用 Demo 模式继续|Continue in Demo mode)$/ });
  const workbench = page.getByTestId('agenthub-workbench');
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click({ timeout: 5_000 }).catch(async (error: unknown) => {
      if (await workbench.isVisible().catch(() => false)) return;
      try {
        await demoButton.evaluate((button) => (button as HTMLButtonElement).click());
      } catch {
        throw error;
      }
    });
  }
  await expect(workbench).toBeVisible();
  onWorkbenchRuntime?.();
  await expect(page.getByRole('log')).toBeVisible();
}

async function expectTranscriptWithoutModeDebug(transcript: ReturnType<Page['getByRole']>): Promise<void> {
  await expect(transcript).not.toContainText('Data:');
  await expect(transcript).not.toContainText('Hub replay:');
  await expect(transcript).not.toContainText('mock (auto fallback)');
  await expect(transcript).not.toContainText('demo+edge');
  await expect(transcript).not.toContainText('Local Vite');
  await expect(transcript).not.toContainText('只读预览');
}

function collectPageDiagnostics(page: Page): void {
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (!isExpectedBrowserDiagnostic(text)) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    }
  });
  page.on('pageerror', (error) => {
    console.log(`[pageerror] ${error.message}`);
  });
  page.on('requestfailed', (request) => {
    console.log(`[requestfailed] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
}

function isExpectedBrowserDiagnostic(text: string): boolean {
  return (
    text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") ||
    text.includes('the server responded with a status of 503')
  );
}

async function submitComposerMessage(page: Page, message: string): Promise<void> {
  const composer = page.getByLabel('Composer input');
  const sendButton = page.getByRole('button', { name: /^(Send message|发送消息)$/ });
  await composer.fill(message);
  await expect(sendButton).toBeEnabled();
  await sendButton.click();
  await expect(composer).toHaveValue('');
}

async function installMessagePresenceProbe(page: Page, message: string): Promise<void> {
  await page.evaluate((text) => {
    const log = document.querySelector('[role="log"]');
    const state = {
      sawVisible: false,
      disappearedAfterVisible: false,
    };
    const sample = () => {
      const visible = Array.from(document.querySelectorAll('.user-bubble'))
        .some((node) => node.textContent?.includes(text));
      if (visible) state.sawVisible = true;
      if (state.sawVisible && !visible) state.disappearedAfterVisible = true;
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(log ?? document.body, { childList: true, subtree: true, characterData: true });
    (window as unknown as { __agenthubMessagePresenceProbe?: unknown }).__agenthubMessagePresenceProbe = state;
  }, message);
}

async function messagePresenceProbe(page: Page): Promise<{
  sawVisible: boolean;
  disappearedAfterVisible: boolean;
}> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __agenthubMessagePresenceProbe?: {
        sawVisible: boolean;
        disappearedAfterVisible: boolean;
      };
    }).__agenthubMessagePresenceProbe;
    return state ?? { sawVisible: false, disappearedAfterVisible: false };
  });
}

async function transcriptScrollGap(page: Page): Promise<number> {
  return page.getByRole('log').evaluate((node) => {
    const element = node as HTMLElement;
    return Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight);
  });
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

async function approvalPreviewCardStackMetrics(page: Page): Promise<{
  exists: boolean;
  verticalGap: number;
  leftDelta: number;
  widthDelta: number;
  approvalTopLeftRadius: number;
  approvalBottomLeftRadius: number;
  approvalBottomRightRadius: number;
  previewTopLeftRadius: number;
  previewTopRightRadius: number;
  previewBottomLeftRadius: number;
}> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[role="log"] .row-item')) as HTMLElement[];
    const approval = rows.find((row, index) => (
      row.classList.contains('approval') && rows[index + 1]?.classList.contains('preview')
    ));
    const preview = approval ? rows[rows.indexOf(approval) + 1] : undefined;

    if (!approval || !preview) {
      return {
        exists: false,
        verticalGap: Number.POSITIVE_INFINITY,
        leftDelta: Number.POSITIVE_INFINITY,
        widthDelta: Number.POSITIVE_INFINITY,
        approvalTopLeftRadius: 0,
        approvalBottomLeftRadius: 0,
        approvalBottomRightRadius: 0,
        previewTopLeftRadius: 0,
        previewTopRightRadius: 0,
        previewBottomLeftRadius: 0,
      };
    }

    approval.scrollIntoView({ block: 'center', inline: 'nearest' });
    const approvalRect = approval.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect();
    const approvalStyle = window.getComputedStyle(approval);
    const previewStyle = window.getComputedStyle(preview);
    const px = (value: string) => Number.parseFloat(value) || 0;

    return {
      exists: true,
      verticalGap: previewRect.top - approvalRect.bottom,
      leftDelta: Math.abs(previewRect.left - approvalRect.left),
      widthDelta: Math.abs(previewRect.width - approvalRect.width),
      approvalTopLeftRadius: px(approvalStyle.borderTopLeftRadius),
      approvalBottomLeftRadius: px(approvalStyle.borderBottomLeftRadius),
      approvalBottomRightRadius: px(approvalStyle.borderBottomRightRadius),
      previewTopLeftRadius: px(previewStyle.borderTopLeftRadius),
      previewTopRightRadius: px(previewStyle.borderTopRightRadius),
      previewBottomLeftRadius: px(previewStyle.borderBottomLeftRadius),
    };
  });
}

async function blockLiveBackends(page: Page): Promise<BackendRequestLog> {
  const backendRequests: E2EObservedRequest[] = [];
  let phase: E2ERequestPhase = 'entry-preflight';

  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const boundary = classifyE2ERequest(request.url(), DESKTOP_MOCK_CHAT_FLOW_SCENARIO);

    if (boundary === 'app') {
      await route.continue();
      return;
    }

    if (boundary === 'hub' || boundary === 'local-edge' || boundary === 'tokendance-id' || boundary === 'gateway') {
      backendRequests.push({ method: request.method(), url: request.url(), phase });
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({
          error: 'blocked_by_chat_flow_ui_test',
          fixture_only: true,
        }),
      });
      return;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });

  return {
    requests: backendRequests,
    markWorkbenchRuntime: () => {
      phase = 'workbench-runtime';
    },
  };
}
