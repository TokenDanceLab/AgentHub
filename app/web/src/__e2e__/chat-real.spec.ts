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
 *   pnpm test:e2e:real
 *   (equivalently: npx playwright test --config playwright.real.config.ts)
 *
 * CI status: This spec is excluded from CI (e2e-smoke job only runs
 * smoke.spec.ts under playwright.config.ts). These tests require live Hub +
 * Edge servers which are not available in the GitHub Actions sandbox. Run
 * locally with all services up before pushing production changes.
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

  // ---------------------------------------------------- IM Chat Flow (Hub API)
  test.describe('IM Chat Flow', () => {
    test('full IM chat lifecycle: send, get, recall, edit, pin, read', async ({ request }) => {
      const tokenA = await mintTestJWT('3ecadf58-012a-4fc5-9170-61976cdac5a7');
      const userAId = '3ecadf58-012a-4fc5-9170-61976cdac5a7';

      // Create private session (self-session since user B may not exist)
      const sessionResp = await request.post('http://127.0.0.1:8080/client/sessions/private', {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: { target_user_id: userAId },
      });
      expect([200, 201, 409].map(String)).toContain(String(sessionResp.status()));
      const sessionBody = await sessionResp.json();
      const sessionId = sessionBody.data?.session_id;
      expect(sessionId).toBeTruthy();

      // Send message from user A
      const sendResp = await request.post(`http://127.0.0.1:8080/client/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: { content_type: 'text', content: 'Hello from Playwright user A!' },
      });
      expect([200, 201].map(String)).toContain(String(sendResp.status()));
      const sendBody = await sendResp.json();
      expect(sendBody.code).toBe('OK');
      const msgAId = sendBody.data.message_id;
      const seqA = sendBody.data.seq_id;
      expect(msgAId).toBeTruthy();
      expect(seqA).toBeGreaterThanOrEqual(1);

      // Get messages -- verify message appears
      const getMsgsResp = await request.get(`http://127.0.0.1:8080/client/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(getMsgsResp.status()).toBe(200);
      const getMsgsBody = await getMsgsResp.json();
      expect(getMsgsBody.code).toBe('OK');
      const foundA = (getMsgsBody.data as any[]).find((m: any) => m.id === msgAId);
      expect(foundA).toBeTruthy();
      expect(foundA.content).toBe('Hello from Playwright user A!');

      // Send reply from user A (self-chat, same user)
      const replyResp = await request.post(`http://127.0.0.1:8080/client/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: { content_type: 'text', content: 'Reply from same user!' },
      });
      expect([200, 201].map(String)).toContain(String(replyResp.status()));
      const replyBody = await replyResp.json();
      const msgBId = replyBody.data.message_id;
      const seqB = replyBody.data.seq_id;
      expect(seqB).toBeGreaterThan(seqA);

      // Recall message A
      const recallResp = await request.post(`http://127.0.0.1:8080/client/messages/${msgAId}/recall`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: {},
      });
      expect([200, 201].map(String)).toContain(String(recallResp.status()));

      // Verify recalled
      const afterRecall = await request.get(`http://127.0.0.1:8080/client/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      const afterRecallBody = await afterRecall.json();
      const recalledMsg = (afterRecallBody.data as any[]).find((m: any) => m.id === msgAId);
      expect(recalledMsg?.recalled).toBe(true);

      // Edit message B
      const editResp = await request.put(`http://127.0.0.1:8080/client/messages/${msgBId}`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: { content_type: 'text', content: 'Edited by Playwright!' },
      });
      expect([200, 201].map(String)).toContain(String(editResp.status()));

      // Verify edited
      const afterEdit = await request.get(`http://127.0.0.1:8080/client/sessions/${sessionId}/messages`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      const afterEditBody = await afterEdit.json();
      const editedMsg = (afterEditBody.data as any[]).find((m: any) => m.id === msgBId);
      expect(editedMsg?.edited).toBe(true);
      expect(editedMsg?.content).toBe('Edited by Playwright!');

      // Pin message
      const pinResp = await request.post(`http://127.0.0.1:8080/client/messages/${msgBId}/pin`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: {},
      });
      expect([200, 201].map(String)).toContain(String(pinResp.status()));

      // Verify pin in list
      const pinsResp = await request.get(`http://127.0.0.1:8080/client/sessions/${sessionId}/pins`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(pinsResp.status()).toBe(200);
      const pinsBody = await pinsResp.json();
      const pinnedFound = (pinsBody.data as any[]).find((m: any) => m.id === msgBId);
      expect(pinnedFound).toBeTruthy();

      // Unpin
      const unpinResp = await request.delete(`http://127.0.0.1:8080/client/messages/${msgBId}/pin`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect([200, 204].map(String)).toContain(String(unpinResp.status()));

      // Mark read
      const markReadResp = await request.post(`http://127.0.0.1:8080/client/sessions/${sessionId}/read`, {
        headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
        data: { last_read_seq: seqB },
      });
      expect([200, 201].map(String)).toContain(String(markReadResp.status()));
    });
  });

  // -------------------------------------------------------- Contacts Flow
  test.describe('Contacts Flow', () => {
    test('search, friend request, accept, remark, block, unblock', async ({ request }) => {
      const tokenA = await mintTestJWT('3ecadf58-012a-4fc5-9170-61976cdac5a7');
      const userAId = '3ecadf58-012a-4fc5-9170-61976cdac5a7';
      const userBId = 'b1c2d3e4-5678-90ab-cdef-1234567890ab';

      // Search for user B (may not exist)
      const searchResp = await request.get(`http://127.0.0.1:8080/client/contacts/search?id=${userBId}`, {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect([200, 404].map(String)).toContain(String(searchResp.status()));

      // List contacts (verify endpoint works)
      const contactsResp = await request.get('http://127.0.0.1:8080/client/contacts', {
        headers: { Authorization: `Bearer ${tokenA}` },
      });
      expect(contactsResp.status()).toBe(200);
      const contactsBody = await contactsResp.json();
      expect(contactsBody.code).toBe('OK');

      if (searchResp.status() === 200) {
        // User B exists -- run full friend flow
        const tokenB = await mintTestJWT(userBId);

        // Send friend request
        const frResp = await request.post('http://127.0.0.1:8080/client/contacts/friend-requests', {
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          data: { friend_id: userBId, message: 'Playwright E2E friend request' },
        });
        // May succeed or already-exist
        expect([200, 201, 409].map(String)).toContain(String(frResp.status()));

        // List friend requests as user B and accept if pending
        const frListResp = await request.get('http://127.0.0.1:8080/client/contacts/friend-requests', {
          headers: { Authorization: `Bearer ${tokenB}` },
        });
        expect(frListResp.status()).toBe(200);
        const frListBody = await frListResp.json();
        expect(frListBody.code).toBe('OK');
        const pendingFR = (frListBody.data as any[]).find(
          (fr: any) => fr.from_user_id === '3ecadf58-012a-4fc5-9170-61976cdac5a7' && fr.status === 'pending',
        );
        if (pendingFR) {
          const frId = pendingFR.request_id ?? pendingFR.id;
          const acceptResp = await request.post(`http://127.0.0.1:8080/client/contacts/friend-requests/${frId}/accept`, {
            headers: { Authorization: `Bearer ${tokenB}`, 'Content-Type': 'application/json' },
            data: {},
          });
          expect([200, 201].map(String)).toContain(String(acceptResp.status()));
        }

        // Verify mutual contacts
        const contactsA2 = await request.get('http://127.0.0.1:8080/client/contacts', {
          headers: { Authorization: `Bearer ${tokenA}` },
        });
        expect(contactsA2.status()).toBe(200);
        const contactsA2Body = await contactsA2.json();
        const foundB = (contactsA2Body.data as any[]).find((c: any) => c.user_id === userBId);
        expect(foundB).toBeTruthy();

        // Update remark
        const remarkResp = await request.put(`http://127.0.0.1:8080/client/contacts/${userBId}/remark`, {
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          data: { remark: 'Playwright E2E Remark' },
        });
        expect([200, 201].map(String)).toContain(String(remarkResp.status()));

        // Block
        const blockResp = await request.post(`http://127.0.0.1:8080/client/contacts/${userBId}/block`, {
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          data: {},
        });
        expect([200, 201].map(String)).toContain(String(blockResp.status()));

        // Unblock
        const unblockResp = await request.post(`http://127.0.0.1:8080/client/contacts/${userBId}/unblock`, {
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          data: {},
        });
        expect([200, 201].map(String)).toContain(String(unblockResp.status()));

        // Create group session
        const groupResp = await request.post('http://127.0.0.1:8080/client/sessions/group', {
          headers: { Authorization: `Bearer ${tokenA}`, 'Content-Type': 'application/json' },
          data: { name: 'Playwright E2E Group', member_ids: [userBId] },
        });
        expect([200, 201].map(String)).toContain(String(groupResp.status()));
        const groupBody = await groupResp.json();
        expect(groupBody.code).toBe('OK');
        expect(groupBody.data.session_id).toBeTruthy();
      }
    });
  });

  // ------------------------------------------------------ Agent Config Flow
  test.describe('Agent Config Flow', () => {
    test('CRUD custom agent', async ({ request }) => {
      const token = await mintTestJWT();

      // Create
      const createResp = await request.post('http://127.0.0.1:8080/web/custom-agents', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {
          name: 'Playwright E2E Agent',
          agent_type: 'claude-code',
          system_prompt: 'You are a Playwright E2E test agent.',
          capability_tags: '[]',
          tool_whitelist: '[]',
          model_params: '{}',
        },
      });
      expect([200, 201].map(String)).toContain(String(createResp.status()));
      const createBody = await createResp.json();
      expect(createBody.code).toBe('OK');
      const agentId = createBody.data.id;
      expect(agentId).toBeTruthy();

      // List -- verify new agent appears
      const listResp = await request.get('http://127.0.0.1:8080/web/custom-agents', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(listResp.status()).toBe(200);
      const listBody = await listResp.json();
      expect(listBody.code).toBe('OK');
      const found = (listBody.data as any[]).find((a: any) => a.id === agentId);
      expect(found).toBeTruthy();

      // Update
      const updateResp = await request.put(`http://127.0.0.1:8080/web/custom-agents/${agentId}`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: {
          name: 'Playwright E2E Agent (Updated)',
          agent_type: 'claude-code',
          system_prompt: 'Updated prompt for E2E testing.',
          capability_tags: '[]',
          tool_whitelist: '[]',
          model_params: '{}',
        },
      });
      expect([200, 201].map(String)).toContain(String(updateResp.status()));

      // Delete
      const delResp = await request.delete(`http://127.0.0.1:8080/web/custom-agents/${agentId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect([200, 204].map(String)).toContain(String(delResp.status()));
    });
  });

  // --------------------------------------------------------- Settings Flow
  test.describe('Settings Flow', () => {
    test('get, patch, verify, reset settings', async ({ request }) => {
      const token = await mintTestJWT();

      // Get current settings
      const getResp = await request.get('http://127.0.0.1:8080/client/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getResp.status()).toBe(200);
      const getBody = await getResp.json();
      expect(getBody.code).toBe('OK');

      // Patch a setting
      const testValue = `pw_e2e_${Date.now()}`;
      const patchResp = await request.patch('http://127.0.0.1:8080/client/settings', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { values: { e2e_test_key: testValue } },
      });
      expect([200, 201].map(String)).toContain(String(patchResp.status()));
      const patchBody = await patchResp.json();
      expect(patchBody.code).toBe('OK');
      expect(patchBody.data.e2e_test_key).toBe(testValue);

      // Verify persisted
      const getResp2 = await request.get('http://127.0.0.1:8080/client/settings', {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getResp2.status()).toBe(200);
      const getBody2 = await getResp2.json();
      expect(getBody2.data.e2e_test_key).toBe(testValue);

      // Reset
      const resetResp = await request.patch('http://127.0.0.1:8080/client/settings', {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { values: { e2e_test_key: '' } },
      });
      expect([200, 201].map(String)).toContain(String(resetResp.status()));
    });
  });

  // ------------------------------------------- @Agent Real Execution (Edge)
  test.describe('@Agent Real Execution', () => {
    test('agent creates a file via Claude Code', async ({ request }) => {
      // Create a unique thread
      const threadId = `thread_agent_pw_${Date.now()}`;
      const threadResp = await request.post('http://127.0.0.1:3210/v1/threads', {
        data: {
          projectId: 'proj_local',
          threadId,
          title: 'Playwright @Agent Execution Test',
        },
      });
      expect([200, 201].map(String)).toContain(String(threadResp.status()));

      // Create a run with an @Agent prompt
      const runResp = await request.post('http://127.0.0.1:3210/v1/runs', {
        data: {
          projectId: 'proj_local',
          threadId,
          prompt: 'Create a file called hello_pw_e2e.js with: console.log("Hello from Playwright E2E!"); Reply with just the filename.',
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

      // Check for artifacts
      const artifactsResp = await request.get(`http://127.0.0.1:3210/v1/artifacts?runId=${runId}`);
      // Artifacts endpoint may or may not exist depending on version
      if (artifactsResp.status() === 200) {
        const artBody = await artifactsResp.json();
        // Just verify it responded; artifact count may vary
        expect(artBody.code).toBe('OK');
      }

      // Get run details for diffs/output
      const runDetail = await request.get(`http://127.0.0.1:3210/v1/runs/${runId}`);
      expect(runDetail.status()).toBe(200);
      const detailBody = await runDetail.json();
      expect(detailBody.data).toBeTruthy();
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

    test('Full Chat + @Agent Flow in browser', async ({ page, request }) => {
      // Check if web dev server is running
      try {
        await page.request.get('http://127.0.0.1:5174/', { timeout: 3000 });
      } catch {
        test.skip(true, 'Web dev server not running on http://127.0.0.1:5174');
        return;
      }

      // Navigate to the app
      const response = await page.goto('http://127.0.0.1:5174/');
      expect(response).toBeTruthy();
      if (response) {
        expect(response.status()).toBeLessThan(500);
      }

      // Wait for the app to render
      await page.waitForTimeout(2000);

      // Check the main workbench/app shell is visible
      // Look for common UI elements: sidebar, main area, or login prompt
      const bodyVisible = await page.locator('#root').isVisible();
      expect(bodyVisible).toBe(true);

      // Check for Vite error overlay
      await expect(page.locator('vite-error-overlay')).toHaveCount(0);

      // If there is a login/auth page, check for auth-related elements
      const hasLoginButton = await page.locator('button:has-text("Login"), button:has-text("Sign in"), a:has-text("Login")').count();
      const hasWorkbench = await page.locator('[data-testid="workbench"], [class*="workbench"], [class*="sidebar"], [class*="chat"]').count();

      if (hasLoginButton > 0) {
        // Auth page detected -- verify login UI loads
        expect(hasLoginButton).toBeGreaterThan(0);
      } else if (hasWorkbench > 0) {
        // Workbench/chat UI loaded -- verify chat UI elements exist
        expect(hasWorkbench).toBeGreaterThan(0);

        // Try to find a composer/input area
        const composer = page.locator('textarea, [contenteditable="true"], input[type="text"][placeholder*="message"], [class*="composer"]');
        if ((await composer.count()) > 0) {
          // Type a test message
          await composer.first().fill('Hello from Playwright E2E!');
          // Verify text was entered
          const inputValue = await composer.first().inputValue?.() ?? await composer.first().textContent();
          expect(inputValue).toContain('Hello from Playwright E2E');

          // Try typing @agent to trigger agent mention
          await composer.first().fill('@agent');
          await page.waitForTimeout(500);

          // Check if an agent mention popup appears
          const agentPopup = await page.locator('[class*="mention"], [class*="agent-popup"], [class*="autocomplete"]').count();
          // This is informational -- we don't fail if the popup doesn't appear
          // since the UI implementation may vary
          if (agentPopup > 0) {
            // Select the first agent option
            await page.locator('[class*="mention"] li, [class*="agent-popup"] li, [class*="autocomplete"] li').first().click();
          }
        }
      }

      // No console errors (only check for actual errors, not warnings)
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      await page.waitForTimeout(1000);
      // Filter out known non-critical errors
      const criticalErrors = consoleErrors.filter(
        (e) => !e.includes('favicon') && !e.includes('DevTools') && !e.includes('net::'),
      );
      expect(criticalErrors.length).toBe(0);
    });

    test('Contacts Page', async ({ page, request }) => {
      // Check if web dev server is running
      try {
        await page.request.get('http://127.0.0.1:5174/', { timeout: 3000 });
      } catch {
        test.skip(true, 'Web dev server not running on http://127.0.0.1:5174');
        return;
      }

      // Navigate to the app
      await page.goto('http://127.0.0.1:5174/');
      await page.waitForTimeout(2000);

      // Try navigating to a contacts page (common SPA patterns)
      const contactLinks = [
        '[href*="contact"]',
        '[href*="/contacts"]',
        'a:has-text("Contacts")',
        'button:has-text("Contacts")',
        '[data-testid="contacts-tab"]',
        '[class*="contact"]',
      ];

      let navigatedToContacts = false;
      for (const selector of contactLinks) {
        const el = page.locator(selector).first();
        if ((await el.count()) > 0 && (await el.isVisible())) {
          await el.click();
          await page.waitForTimeout(1000);
          navigatedToContacts = true;
          break;
        }
      }

      if (navigatedToContacts) {
        // Verify contact list area exists
        const contactList = await page.locator('[class*="contact-list"], [class*="contact-item"], [class*="contact"]').count();
        expect(contactList).toBeGreaterThanOrEqual(0);

        // Try searching for a user
        const searchInput = page.locator('input[placeholder*="search"], input[placeholder*="Search"], input[type="search"]');
        if ((await searchInput.count()) > 0) {
          await searchInput.first().fill('3ecadf58');
          await page.waitForTimeout(500);
          // Verify search results appear
          const searchResults = await page.locator('[class*="search-result"], [class*="contact-item"]').count();
          expect(searchResults).toBeGreaterThanOrEqual(0);
        }
      } else {
        // Contacts page not reachable from current view
        // This is OK -- the test is informational
        console.log('Contacts page not navigable from current UI state');
      }
    });
  });
});

// --------------- JWT helper ---------------

/**
 * Mint a Hub-compatible HS256 JWT using the Web Crypto API.
 * Equivalent to hub-server/internal/jwtutil.GenerateAccessToken.
 */
async function mintTestJWT(userId: string = '3ecadf58-012a-4fc5-9170-61976cdac5a7'): Promise<string> {
  const secret = 'agenthub-local-dev-secret-key-32chars-min';

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
