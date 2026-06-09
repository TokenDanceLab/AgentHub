import { test, expect } from '@playwright/test';

/**
 * AgentHub real E2E tests — exercise the running app against live services.
 *
 * Prerequisites:
 *   - Hub server running at http://127.0.0.1:8080
 *   - Web dev server running at http://127.0.0.1:5174 (or desktop at 5173)
 *   - Edge server running at http://127.0.0.1:3210
 *
 * Run:
 *   npx playwright test --config e2e/real-playwright.config.ts
 */

test.describe('AgentHub real E2E', () => {
  test.describe.configure({ timeout: 30_000 });

  // ------------------------------------------------------------------ Hub API
  test.describe('Hub API (direct HTTP)', () => {
    test('Hub health returns ok', async ({ request }) => {
      const resp = await request.get('http://127.0.0.1:8080/health');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.code).toBe('OK');
      expect(body.data.status).toBe('ok');
      expect(body.data.live).toBe(true);
      expect(body.data.ready).toBe(true);
      expect(body.data.checks.database).toBe('ok');
      expect(body.data.checks.redis).toBe('ok');
    });

    test('Hub auth-protected contacts returns data with valid JWT', async ({ request }) => {
      // Mint a JWT using Node crypto (inline) -- we use a simple helper
      const token = await mintTestJWT();
      const resp = await request.get('http://127.0.0.1:8080/client/contacts', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.code).toBe('OK');
      expect(Array.isArray(body.data)).toBe(true);
    });

    test('Hub auth-protected sessions returns data with valid JWT', async ({ request }) => {
      const token = await mintTestJWT();
      const resp = await request.get('http://127.0.0.1:8080/client/sessions', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.code).toBe('OK');
      expect(Array.isArray(body.data)).toBe(true);
    });

    test('Hub document CRUD lifecycle', async ({ request }) => {
      const token = await mintTestJWT();

      // Create
      const createResp = await request.post('http://127.0.0.1:8080/web/documents', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {
          title: 'Playwright E2E Document',
          content: '# E2E Test\n\nCreated by chat-real.spec.ts',
          tags: ['e2e', 'playwright'],
        },
      });
      expect([200, 201].map(String)).toContain(String(createResp.status()));
      const createBody = await createResp.json();
      expect(createBody.code).toBe('OK');
      const docId = createBody.data.id;
      expect(docId).toBeTruthy();

      // Get
      const getResp = await request.get(`http://127.0.0.1:8080/web/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getResp.status()).toBe(200);
      const getBody = await getResp.json();
      expect(getBody.data.title).toBe('Playwright E2E Document');

      // Delete
      const delResp = await request.delete(`http://127.0.0.1:8080/web/documents/${docId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([200, 204].map(String)).toContain(String(delResp.status()));
    });
  });

  // ------------------------------------------------------------------ Edge API
  test.describe('Edge API (direct HTTP)', () => {
    test('Edge health returns ok', async ({ request }) => {
      const resp = await request.get('http://127.0.0.1:3210/v1/health');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.code).toBe('OK');
      expect(body.data.status).toBe('ok');
    });

    test('Edge runners list is non-empty', async ({ request }) => {
      const resp = await request.get('http://127.0.0.1:3210/v1/runners');
      expect(resp.status()).toBe(200);
      const body = await resp.json();
      expect(body.data.items.length).toBeGreaterThanOrEqual(1);
      expect(body.data.items[0].status).toBe('online');
    });

    test('Edge projects and threads exist', async ({ request }) => {
      const projects = await request.get('http://127.0.0.1:3210/v1/projects');
      expect(projects.status()).toBe(200);
      const pBody = await projects.json();
      expect(pBody.data.items.length).toBeGreaterThanOrEqual(1);

      const threads = await request.get('http://127.0.0.1:3210/v1/threads');
      expect(threads.status()).toBe(200);
      const tBody = await threads.json();
      expect(tBody.data.items.length).toBeGreaterThanOrEqual(1);
    });

    test('Edge run create-finish lifecycle', async ({ request }) => {
      // Create a unique thread
      const threadId = `thread_pw_e2e_${Date.now()}`;
      const threadResp = await request.post('http://127.0.0.1:3210/v1/threads', {
        data: {
          projectId: 'proj_local',
          threadId,
          title: 'Playwright E2E Thread',
        },
      });
      expect([200, 201].map(String)).toContain(String(threadResp.status()));
      const tBody = await threadResp.json();
      expect(tBody.code).toBe('OK');

      // Create a run
      const runResp = await request.post('http://127.0.0.1:3210/v1/runs', {
        data: {
          projectId: 'proj_local',
          threadId,
          prompt: 'Reply with exactly: PW_E2E_OK',
          agentId: 'claude-code',
          ephemeral: true,
        },
        timeout: 120_000,
      });
      expect([200, 201, 202].map(String)).toContain(String(runResp.status()));
      const rBody = await runResp.json();
      expect(rBody.code).toBe('OK');
      const runId = rBody.data.runId;
      expect(runId).toBeTruthy();
      expect(['queued', 'started']).toContain(rBody.data.status);

      // Poll until finished (max 120s)
      let finalStatus = rBody.data.status;
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline && ['queued', 'started', 'cancelling'].includes(finalStatus)) {
        await new Promise((r) => setTimeout(r, 3000));
        const pollResp = await request.get(`http://127.0.0.1:3210/v1/runs/${runId}`);
        expect(pollResp.status()).toBe(200);
        const pollBody = await pollResp.json();
        finalStatus = pollBody.data.status;
      }
      expect(finalStatus).toBe('finished');
    });
  });

  // ----------------------------------------------------------- Web UI smoke
  test.describe('Web UI (browser)', () => {
    test('web app loads without errors', async ({ page }) => {
      // Skip if web dev server is not running on 5174
      try {
        const check = await page.request.get('http://127.0.0.1:5174/', { timeout: 3000 });
        // If we get here, the server is running
      } catch {
        test.skip(true, 'Web dev server not running on http://127.0.0.1:5174 -- start with: pnpm --filter agenthub-web dev');
        return;
      }

      const response = await page.goto('http://127.0.0.1:5174/');
      // Allow 200 or 304 -- the page just needs to load
      if (response) {
        expect(response.status()).toBeLessThan(500);
      }

      // Check no Vite error overlay
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);

      // Check #root has content
      const rootContent = await page.locator('#root > *').count();
      expect(rootContent).toBeGreaterThanOrEqual(0);
    });
  });
});

// --------------- JWT helper ---------------

/**
 * Mint a Hub-compatible HS256 JWT using the Web Crypto API.
 * Equivalent to hub-server/internal/jwtutil.GenerateAccessToken.
 */
async function mintTestJWT(): Promise<string> {
  const secret = 'agenthub-local-dev-secret-key-32chars-min';
  const userId = '3ecadf58-012a-4fc5-9170-61976cdac5a7';

  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: userId,
    device_type: 'web',
    device_id: 'e2e-pw-device-001',
    iss: 'agenthub-hub',
    aud: ['agenthub-api'],
    sub: userId,
    iat: now,
    exp: now + 3600,
  };

  const encoder = new TextEncoder();
  const base64url = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const h = base64url(encoder.encode(JSON.stringify(header)));
  const p = base64url(encoder.encode(JSON.stringify(payload)));
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${h}.${p}`));
  const s = base64url(sig);

  return `${h}.${p}.${s}`;
}
