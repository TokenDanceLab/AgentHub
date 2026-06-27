import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.env.AGENTHUB_MANUAL_PORT ?? 5201);
const ownsServer = !process.env.AGENTHUB_MANUAL_URL;
const baseURL = process.env.AGENTHUB_MANUAL_URL ?? `http://127.0.0.1:${port}`;
const outputDir = path.resolve(process.cwd(), '.tmp', 'manual-chat-flow-uiux');
const screenshot = path.join(outputDir, 'desktop-1440x810-chat-flow.png');

fs.mkdirSync(outputDir, { recursive: true });

const liveBackendHosts = new Set([
  'api.hub.vectorcontrol.tech',
  'hub.vectorcontrol.tech',
  'id.vectorcontrol.tech',
  'api.vectorcontrol.tech',
  'localhost:8080',
  '127.0.0.1:8080',
  'localhost:3210',
  '127.0.0.1:3210',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForURL(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'no response'}`);
}

function startDevServer() {
  const command = process.platform === 'win32' ? process.env.ComSpec || 'cmd.exe' : 'corepack';
  const args =
    process.platform === 'win32'
      ? ['/d', '/s', '/c', `corepack.cmd pnpm dev --host 127.0.0.1 --port ${port}`]
      : ['pnpm', 'dev', '--host', '127.0.0.1', '--port', String(port)];
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => process.stdout.write(`[vite] ${chunk}`));
  child.stderr.on('data', (chunk) => process.stderr.write(`[vite] ${chunk}`));
  return child;
}

function stopDevServer(child) {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

async function submitMessage(page, message) {
  const composer = page.getByLabel(/^(Composer input|aria\.composerInput)$/);
  const send = page.getByRole('button', { name: /^(Send message|发送消息|profile\.sendMessage)$/ });
  await composer.fill(message);
  await send.click();
  await composer.waitFor({ state: 'visible' });
}

function assertMetrics(result) {
  const failures = [];
  if (result.firstUserBubbles !== 1) {
    failures.push(`expected first user bubble once, got ${result.firstUserBubbles}`);
  }
  if (result.repeatedUserBubbles !== 2) {
    failures.push(`expected repeated user bubble twice, got ${result.repeatedUserBubbles}`);
  }
  if (!result.probe.sawVisible) {
    failures.push('first user message never became visible');
  }
  if (result.probe.disappearedAfterVisible) {
    failures.push('first user message disappeared after becoming visible');
  }
  if (result.scrollGap === null || result.scrollGap > 4) {
    failures.push(`expected transcript auto-follow gap <= 4px, got ${result.scrollGap}`);
  }
  if (result.horizontalOverflow > 1) {
    failures.push(`expected no horizontal overflow, got ${result.horizontalOverflow}px`);
  }
  if (result.firstMessageIndex < 0 || result.secondMessageIndex <= result.firstMessageIndex) {
    failures.push('expected user messages to remain in chronological transcript order');
  }
  if (result.transcriptHasModeDebug) {
    failures.push('expected data-mode/debug status outside main transcript');
  }
  if (!result.cardStack.exists) {
    failures.push('expected approval and preview cards to render as a merged stack');
  } else {
    const stack = result.cardStack;
    if (Math.abs(stack.verticalGap) > 1 || stack.leftDelta > 1 || stack.widthDelta > 1) {
      failures.push(
        `expected merged card stack alignment, got gap=${stack.verticalGap}, leftDelta=${stack.leftDelta}, widthDelta=${stack.widthDelta}`,
      );
    }
    if (
      stack.approvalBottomLeftRadius !== 0 ||
      stack.approvalBottomRightRadius !== 0 ||
      stack.previewTopLeftRadius !== 0 ||
      stack.previewTopRightRadius !== 0
    ) {
      failures.push('expected merged card stack inner radii to be 0');
    }
  }
  if (failures.length > 0) {
    throw new Error(`Manual chat-flow UIUX check failed:\n- ${failures.join('\n- ')}`);
  }
}

let server = null;
let browser = null;

try {
  if (ownsServer) {
    try {
      await waitForURL(baseURL, 1_500);
      console.log(`[manual-chat-flow] Reusing existing Desktop server at ${baseURL}`);
    } catch {
      server = startDevServer();
      await waitForURL(baseURL);
    }
  }

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  page.setDefaultNavigationTimeout(60_000);

  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (
        !text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") &&
        !text.includes('the server responded with a status of 503') &&
        !text.includes("Framing 'https://preview.example.com/' violates")
      ) {
        console.log(`[browser:${message.type()}] ${text}`);
      }
    }
  });
  page.on('pageerror', (error) => console.log(`[pageerror] ${error.message}`));

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === baseURL) {
      await route.continue();
      return;
    }
    if (liveBackendHosts.has(url.host)) {
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({ error: 'blocked_by_manual_chat_flow_check' }),
      });
      return;
    }
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });

  await page.addInitScript(() => {
    try {
      window.localStorage.removeItem('agenthub.workbench.composerSubmitBehavior');
    } catch {}
  });

  await page.goto(baseURL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const demoButton = page.getByRole('button', { name: '使用 Demo 模式继续' });
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click({ timeout: 5_000 }).catch(async (error) => {
      if (await page.getByTestId('agenthub-workbench').isVisible().catch(() => false)) return;
      try {
        await demoButton.evaluate((button) => button.click());
      } catch {
        throw error;
      }
    });
  }
  await page.getByTestId('agenthub-workbench').waitFor({ state: 'visible' });
  await page.getByRole('log').waitFor({ state: 'visible' });

  const transcript = page.getByRole('log');
  const firstMessage = `Manual chat flow ${Date.now()}`;
  const secondMessage = `Manual repeated ${Date.now()}`;

  await page.evaluate((text) => {
    const state = { sawVisible: false, disappearedAfterVisible: false };
    const sample = () => {
      const visible = Array.from(document.querySelectorAll('.user-bubble')).some((node) =>
        node.textContent?.includes(text),
      );
      if (visible) state.sawVisible = true;
      if (state.sawVisible && !visible) state.disappearedAfterVisible = true;
    };
    sample();
    const observer = new MutationObserver(sample);
    observer.observe(document.querySelector('[role="log"]') ?? document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    window.__manualChatFlowProbe = state;
  }, firstMessage);

  await submitMessage(page, firstMessage);
  await transcript.locator('.user-bubble').filter({ hasText: firstMessage }).waitFor({ state: 'visible' });
  await submitMessage(page, secondMessage);
  await submitMessage(page, secondMessage);

  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshot, fullPage: true });

  const result = await page.evaluate(({ firstMessage, secondMessage }) => {
    const log = document.querySelector('[role="log"]');
    const element = log instanceof HTMLElement ? log : null;
    const text = element?.textContent ?? '';
    const rows = Array.from(document.querySelectorAll('[role="log"] .row-item'));
    const approval = rows.find(
      (row, index) => row.classList.contains('approval') && rows[index + 1]?.classList.contains('preview'),
    );
    const preview = approval ? rows[rows.indexOf(approval) + 1] : undefined;
    let cardStack = { exists: false };
    if (approval instanceof HTMLElement && preview instanceof HTMLElement) {
      approval.scrollIntoView({ block: 'center', inline: 'nearest' });
      const approvalRect = approval.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const approvalStyle = window.getComputedStyle(approval);
      const previewStyle = window.getComputedStyle(preview);
      const px = (value) => Number.parseFloat(value) || 0;
      cardStack = {
        exists: true,
        verticalGap: previewRect.top - approvalRect.bottom,
        leftDelta: Math.abs(previewRect.left - approvalRect.left),
        widthDelta: Math.abs(previewRect.width - approvalRect.width),
        approvalBottomLeftRadius: px(approvalStyle.borderBottomLeftRadius),
        approvalBottomRightRadius: px(approvalStyle.borderBottomRightRadius),
        previewTopLeftRadius: px(previewStyle.borderTopLeftRadius),
        previewTopRightRadius: px(previewStyle.borderTopRightRadius),
      };
    }
    const firstUserBubbles = Array.from(document.querySelectorAll('.user-bubble')).filter((node) =>
      node.textContent?.includes(firstMessage),
    ).length;
    const repeatedUserBubbles = Array.from(document.querySelectorAll('.user-bubble')).filter((node) =>
      node.textContent?.includes(secondMessage),
    ).length;
    const probe = window.__manualChatFlowProbe ?? { sawVisible: false, disappearedAfterVisible: false };
    return {
      firstUserBubbles,
      repeatedUserBubbles,
      probe,
      scrollGap: element ? Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight) : null,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      firstMessageIndex: text.indexOf(firstMessage),
      secondMessageIndex: text.indexOf(secondMessage),
      transcriptHasModeDebug: text.includes('Data:') ||
        text.includes('Hub replay:') ||
        text.includes('mock (auto fallback)') ||
        text.includes('demo+edge') ||
        text.includes('Local Vite') ||
        text.includes('只读预览'),
      cardStack,
    };
  }, { firstMessage, secondMessage });

  const report = {
    baseURL,
    viewport: page.viewportSize(),
    screenshot,
    ...result,
  };
  console.log(JSON.stringify(report, null, 2));
  assertMetrics(result);
} finally {
  if (browser) await browser.close();
  stopDevServer(server);
}
