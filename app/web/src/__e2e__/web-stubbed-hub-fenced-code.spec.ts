import { expect, test, type Route } from '@playwright/test';
import { fulfillExternalFontIfMatch } from '../../../e2e/fontBlocker';

// #1971 contract: Hub-delivered text messages whose body contains fenced
// code must render as code blocks in the Web transcript, for both human
// (partner) and agent senders, using the real REST shapes (snake_case
// session id, jsonb string content with a `text` field).
const HUB_ORIGIN_HOST = 'hub.test.invalid';

const HUMAN_FENCED = 'partner fenced probe\n```python\nprint("hello fenced")\n```\n';
const AGENT_FENCED = 'Here is a fenced code sample:\n```python\ndef greet():\n    return 42\n```\n';

function corsHeaders(): Record<string, string> {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
  };
}

function fulfill(data: unknown) {
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ code: 'ok', data }),
    headers: corsHeaders(),
  };
}

test.describe('Web stubbed Hub fenced-code transcript (#1971)', () => {
  test('renders fenced code blocks from Hub history for human and agent senders', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('agenthub.workbench.dataMode', 'approved-real');
      window.sessionStorage.setItem('agenthub_hub_token', 'stubbed-hub-token');
      window.sessionStorage.setItem('agenthub_token_source', 'hub');
      window.sessionStorage.setItem('agenthub_hub_user', JSON.stringify({
        userId: 'user-fenced',
        username: 'fenced',
      }));
    });

    await page.route('**/*', async (route: Route) => {
      const request = route.request();
      const url = new URL(request.url());

      if (url.host !== HUB_ORIGIN_HOST) {
        if (await fulfillExternalFontIfMatch(route)) {
          return;
        }
        return route.continue();
      }

      if (request.method() === 'OPTIONS') {
        return route.fulfill({ status: 204, headers: corsHeaders() });
      }

      const p = url.pathname;
      if (p === '/client/auth/me') {
        return route.fulfill(fulfill({ id: 'user-fenced', username: 'fenced', nickname: 'Fenced', avatar_url: '' }));
      }
      if (p === '/client/sessions') {
        return route.fulfill(fulfill([{
          session_id: 'session-fenced',
          type: 'private',
          name: 'Fenced code probe',
          member_count: 2,
          unread_count: 0,
        }]));
      }
      if (p === '/client/sessions/session-fenced/messages') {
        return route.fulfill(fulfill([
          {
            id: 'msg-fenced-1',
            session_id: 'session-fenced',
            seq_id: 1,
            sender_type: 'user',
            sender_id: 'partner-1',
            content_type: 'text',
            content: JSON.stringify({ text: HUMAN_FENCED }),
            created_at: '2026-08-25T06:00:00Z',
          },
          {
            id: 'msg-fenced-2',
            session_id: 'session-fenced',
            seq_id: 2,
            sender_type: 'agent',
            sender_id: 'agent-fenced',
            content_type: 'text',
            content: JSON.stringify({ text: AGENT_FENCED }),
            created_at: '2026-08-25T06:01:00Z',
          },
        ]));
      }
      if (p === '/client/sessions/session-fenced/pins') {
        return route.fulfill(fulfill([]));
      }
      if (p === '/client/contacts' || p === '/client/notifications') {
        return route.fulfill(fulfill([]));
      }
      // Any other Hub call fails closed so missing stubs surface loudly.
      return route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'not_stubbed', path: p }),
        headers: corsHeaders(),
      });
    });

    await page.goto('/');

    await expect(page.getByTestId('agenthub-workbench')).toHaveAttribute('data-page', 'chat');
    // Preamble text of both messages renders.
    await expect(page.getByText('partner fenced probe')).toBeVisible();
    await expect(page.getByText('Here is a fenced code sample:')).toBeVisible();
    // The fenced code bodies render inside code-block containers (the
    // Markdown CodeBlock wrapper in dev builds carries a readable
    // `codeBlockWrapper` CSS-module class; the lazy highlighter or its
    // <pre><code> fallback both live inside that wrapper).
    const humanBlock = page.locator('[class*="codeBlockWrapper"]', { hasText: 'print("hello fenced")' });
    await expect(humanBlock).toBeVisible();
    const agentBlock = page.locator('[class*="codeBlockWrapper"]', { hasText: 'return 42' });
    await expect(agentBlock).toBeVisible();
    // The preamble paragraph and the code block are distinct nodes.
    await expect(page.getByText('print("hello fenced")')).toBeVisible();
  });
});
