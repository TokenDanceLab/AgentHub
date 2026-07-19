import { expect, test, type Page, type Route } from '@playwright/test';
import {
  DESKTOP_WORKSPACE_VIEWPORT,
  firstInViewportListSignal,
  isListSignalInViewport,
  type GeometryRect,
} from '../../../shared/src/testing/geometrySmoke';

/**
 * Web geometry smoke (#1284) — stubbed Hub / mock dataMode.
 * Asserts Agents installed list signals stay inside the 1440×810 viewport.
 */
const VIEWPORT_HEIGHT = DESKTOP_WORKSPACE_VIEWPORT.height;
const AGENTS_RAIL_BUTTON = 'nav[aria-label="Global rail"] button[aria-label="Agent"]';
const AGENTS_PAGE = 'section.agents-page, .agents-page';
const LIST_SIGNAL_SELECTORS = [
  '.agent-config-row',
  'button.agent-config-row',
  '.agent-empty-compact',
  '[class*="agent-empty"]',
] as const;

test.describe('Web geometry smoke (#1284)', () => {
  test.describe.configure({ timeout: 60_000 });

  test('keeps at least one Agents list signal inside the 1440×810 viewport', async ({ page }) => {
    collectPageDiagnostics(page);
    await installGeometryMockHub(page);
    await enterMockGeometrySession(page);

    expect(page.viewportSize()).toEqual(DESKTOP_WORKSPACE_VIEWPORT);
    await expect(page.getByTestId('agenthub-workbench')).toBeVisible();

    const agentsRail = page.locator(AGENTS_RAIL_BUTTON).first();
    await agentsRail.waitFor({ state: 'visible', timeout: 15_000 });
    await agentsRail.click();
    await page.waitForSelector(AGENTS_PAGE, { state: 'visible', timeout: 15_000 });

    await page.waitForFunction(
      (selectors) => {
        for (const selector of selectors) {
          if (document.querySelector(selector)) return true;
        }
        return false;
      },
      [...LIST_SIGNAL_SELECTORS],
      { timeout: 15_000 },
    );

    await pinAgentsScrollTop(page);
    await page.waitForTimeout(300);

    const boxes = await collectListSignalBoxes(page);
    expect(boxes.length, 'expected at least one Agents list signal box').toBeGreaterThan(0);

    const inViewport = firstInViewportListSignal(boxes, VIEWPORT_HEIGHT);
    expect(
      inViewport,
      `no Agents list signal inside viewport height ${VIEWPORT_HEIGHT}; boxes=${JSON.stringify(boxes)}`,
    ).not.toBeNull();
    expect(isListSignalInViewport(inViewport, VIEWPORT_HEIGHT)).toBe(true);
  });
});

async function enterMockGeometrySession(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('agenthub.workbench.dataMode', 'mock');
    window.localStorage.setItem('agenthub_hub_url', 'http://localhost:8080');
    window.sessionStorage.setItem('agenthub_hub_token', 'geometry-smoke-token');
    window.sessionStorage.setItem('agenthub_token_source', 'hub');
    window.sessionStorage.setItem(
      'agenthub_hub_user',
      JSON.stringify({ userId: 'user-geometry', username: 'geometry-smoke' }),
    );
  });
  await page.goto('/');
}

async function pinAgentsScrollTop(page: Page): Promise<void> {
  await page.evaluate(() => {
    const main = document.querySelector('.agent-main, main.agent-main, main.workbench-main');
    if (main instanceof HTMLElement) main.scrollTop = 0;
    const list = document.querySelector('.agent-config-list');
    if (list instanceof HTMLElement) list.scrollTop = 0;
    const detail = document.querySelector('.agent-detail, aside.agent-detail');
    if (detail instanceof HTMLElement) detail.scrollTop = 0;
    window.scrollTo(0, 0);
  });
}

async function collectListSignalBoxes(page: Page): Promise<GeometryRect[]> {
  const boxes: GeometryRect[] = [];
  for (const selector of LIST_SIGNAL_SELECTORS) {
    const locators = page.locator(selector);
    const count = await locators.count();
    for (let i = 0; i < count; i += 1) {
      const box = await locators.nth(i).boundingBox();
      if (box) {
        boxes.push({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
    }
  }
  return boxes;
}

async function installGeometryMockHub(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    const isHub =
      url.origin.includes('localhost:8080') ||
      url.origin.includes('127.0.0.1:8080') ||
      url.hostname.includes('hub.vectorcontrol.tech') ||
      url.hostname.includes('api.hub.vectorcontrol.tech');

    if (!isHub) {
      return route.continue();
    }

    if (request.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: corsHeaders() });
    }

    return fulfillGeometryHub(route, url.pathname);
  });
}

async function fulfillGeometryHub(route: Route, pathname: string): Promise<void> {
  if (pathname.endsWith('/health')) {
    return route.fulfill(
      json({ status: 'ok', version: 'web-geometry-smoke', uptime: '1h', checks: {} }),
    );
  }

  if (pathname === '/client/auth/me') {
    return route.fulfill(
      json(
        hubEnvelope({
          id: 'user-geometry',
          username: 'geometry-smoke',
          nickname: 'Geometry Smoke',
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
            session_id: 'session-geometry',
            type: 'group',
            name: 'Geometry smoke session',
            owner_user_id: 'user-geometry',
            created_at: '2026-07-19T01:10:00Z',
            updated_at: '2026-07-19T01:30:00Z',
          },
        ]),
      ),
    );
  }

  if (pathname === '/client/contacts' || pathname === '/client/notifications') {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname.match(/^\/client\/sessions\/[^/]+\/pins$/)) {
    return route.fulfill(json(hubEnvelope([])));
  }

  if (pathname.match(/^\/client\/sessions\/[^/]+\/messages$/)) {
    return route.fulfill(
      json(
        hubEnvelope([
          {
            id: 'msg-geometry-1',
            session_id: 'session-geometry',
            sender_id: 'user-geometry',
            sender_type: 'user',
            content_type: 'text',
            content: 'Geometry smoke baseline.',
            seq_id: 1,
            created_at: '2026-07-19T01:20:00Z',
          },
        ]),
      ),
    );
  }

  if (pathname === '/web/agent-profiles') {
    return route.fulfill(
      json(
        hubEnvelope({
          items: [
            {
              id: 'profile_codex',
              name: 'Codex',
              description: 'Geometry smoke primary profile',
              runtime_id: 'codex',
              provider: 'openai',
              model: 'gpt-5',
              version: 1,
            },
            {
              id: 'profile_claude',
              name: 'Claude Code',
              description: 'Geometry smoke secondary profile',
              runtime_id: 'claude-code',
              provider: 'anthropic',
              model: 'claude-opus-4-5',
              version: 1,
            },
            {
              id: 'profile_opencode',
              name: 'OpenCode',
              description: 'Geometry smoke tertiary profile',
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
              updated_at: '2026-07-19T01:25:00Z',
            },
          ],
          page: { hasMore: false },
        }),
      ),
    );
  }

  if (pathname === '/web/projects') {
    return route.fulfill(
      json(
        hubEnvelope({
          items: [],
          page: { hasMore: false },
        }),
      ),
    );
  }

  return route.fulfill(json(hubEnvelope({})));
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
}

function isExpectedBrowserDiagnostic(text: string): boolean {
  return (
    text.includes("The Content Security Policy directive 'frame-ancestors' is ignored") ||
    text.includes("WebSocket connection to 'ws://localhost:8080/client/ws") ||
    text.includes('Failed to load resource')
  );
}

function hubEnvelope<T>(data: T): { code: string; data: T; message: string } {
  return { code: 'OK', data, message: '' };
}

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  };
}

function json(body: unknown): {
  status: number;
  contentType: string;
  body: string;
  headers: Record<string, string>;
} {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
    headers: corsHeaders(),
  };
}
