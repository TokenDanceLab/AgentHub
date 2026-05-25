#!/usr/bin/env tsx
/**
 * AgentHub Desktop UI Capture Script
 *
 * Usage:
 *   npx tsx capture.ts --url http://localhost:5173 --out shot.png --theme dark --viewport 1440,900 --wait 2000
 *
 * Options:
 *   --url        Dev server URL (default: http://localhost:5173)
 *   --out        Output PNG path (default: screenshots/capture-{timestamp}.png)
 *   --theme      dark | light (default: dark)
 *   --viewport   width,height (default: 1440,900)
 *   --region     x,y,w,h — crop region (optional)
 *   --wait       Additional wait ms after load (default: 1500)
 *   --mock       Inject mock data (default: true)
 */

import { chromium, type Page } from 'playwright';
import { parseArgs } from 'util';
import { mkdir } from 'fs/promises';
import { dirname, resolve } from 'path';

const MOCK_PAYLOAD = {
  agents: [
    { id: 'claude', name: 'Claude Code', status: 'available', description: 'Anthropic Claude Code CLI' },
    { id: 'codex', name: 'Codex', status: 'available', description: 'OpenAI Codex CLI' },
    { id: 'opencode', name: 'OpenCode', status: 'offline', description: 'OpenCode CLI' },
  ],
  threads: [
    { threadId: 't1', title: '测试会话', updatedAt: new Date().toISOString() },
  ],
  messages: [
    {
      id: 'm1', role: 'user', timestamp: new Date(Date.now() - 60000).toISOString(),
      blocks: [{ kind: 'text', content: '测试消息内容' }],
    },
    {
      id: 'm2', role: 'agent', agentName: 'Claude Code', timestamp: new Date().toISOString(),
      blocks: [{ kind: 'text', content: '在，我这边正常。有什么可以帮你的？' }],
    },
  ],
  currentRun: {
    runId: 'r1', status: 'running',
    outputText: '正在处理中...', toolCalls: [], changedFiles: [],
  },
};

async function main() {
  const {
    values: { url, out, theme, viewport, region, wait, mock },
  } = parseArgs({
    args: process.argv.slice(2),
    options: {
      url: { type: 'string', default: 'http://localhost:5173' },
      out: { type: 'string' },
      theme: { type: 'string', default: 'dark' },
      viewport: { type: 'string', default: '1440,900' },
      region: { type: 'string' },
      wait: { type: 'string', default: '1500' },
      mock: { type: 'string', default: 'true' },
    },
    strict: false,
    allowPositionals: false,
  });

  const [vw, vh] = (viewport as string).split(',').map(Number);
  const waitMs = Number(wait);
  const useMock = mock !== 'false';

  const timestamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const outputPath = resolve(out ?? `screenshots/capture-${timestamp}.png`);
  await mkdir(dirname(outputPath), { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--font-render-hinting=none', '--disable-gpu'],
  });

  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    colorScheme: theme as 'dark' | 'light',
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  // Inject mock data before navigation
  if (useMock) {
    await page.addInitScript((payload) => {
      (window as any).__MOCK_DATA__ = payload;
      // Intercept fetch for health/agents/threads endpoints
      const originalFetch = window.fetch;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.includes('/health')) {
          return new Response(JSON.stringify({ online: true, version: 'v1', agents: 3 }), { status: 200 });
        }
        if (url.includes('/agents')) {
          return new Response(JSON.stringify({ items: payload.agents }), { status: 200 });
        }
        if (url.includes('/threads')) {
          return new Response(JSON.stringify({ items: payload.threads }), { status: 200 });
        }
        return originalFetch(input, init);
      };
    }, MOCK_PAYLOAD);
  }

  try {
    await page.goto(url as string, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    console.error(`Failed to load ${url}. Is the dev server running? (pnpm dev)`);
    await browser.close();
    process.exit(1);
  }

  // Wait for fonts and animations to settle
  await page.waitForTimeout(waitMs);

  // Optional: crop region
  let clip;
  if (region) {
    const [x, y, w, h] = (region as string).split(',').map(Number);
    clip = { x, y, width: w, height: h };
  }

  await page.screenshot({ path: outputPath, fullPage: !clip, clip, type: 'png' });
  console.log(`Screenshot saved: ${outputPath}`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
