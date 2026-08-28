import { test, expect, type Page } from '@playwright/test';
import { blockExternalFonts, isExternalFontUrl } from '../../../e2e/fontBlocker';

const LIVE_BACKEND_HOSTS = new Set([
  'api.hub.vectorcontrol.tech',
  'hub.vectorcontrol.tech',
  'id.tokendancelab.com',
  'api.vectorcontrol.tech',
  'localhost:8080',
  '127.0.0.1:8080',
  'localhost:3210',
  '127.0.0.1:3210',
]);

test.describe('TeamRun UI evidence fixture', () => {
  test('captures Desktop transcript and inspector evidence without live auth or runtime calls', async ({ page }, testInfo) => {
    const blocked = await blockLiveBackends(page);
    // #2014: intercept external font CDN requests before the generic
    // other-http abort below records them as blocked live-backend hits.
    const fontGuard = await blockExternalFonts(page);

    // The desktop entry gate requires an explicit mode choice before the
    // workbench renders; enter demo mode like smoke/chat-flow (#2001) so this
    // fixture evidence stays auth-free. Seed the one-time onboarding overlay
    // (#1819) as seen so it never blocks the workbench interactions below.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem('agenthub_onboarding_seen', 'true');
      } catch {
        // Some initial browser documents deny localStorage; the app origin will still run this script.
      }
    });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page
      .getByRole('button', { name: /^(使用 Demo 模式继续|Continue in Demo mode)$/ })
      .click();
    await expect(page.getByTestId('agenthub-workbench')).toBeVisible();

    await page.getByRole('button', { name: /TeamRun Fixture/ }).click();

    await expect(page.getByRole('region', { name: 'Transcript' })).toContainText(
      'TeamRun Console fixture state 已载入',
    );
    // run_session / agent_timeline / route_decision / subagent blocks are
    // sidebar-only since isSidebarOnlyTranscriptBlock (shared/src/transcript/
    // types.ts) — the chatview adapter drops them from the transcript stream
    // (adapterMapBlock.ts skip list). Their fixture evidence now surfaces in
    // the right inspector: run evidence index (run_session) and the agent
    // delegation tree (route_decision + subagent). Assert that live surface
    // instead of the retired inline transcript rows.
    const runInspector = page.getByRole('complementary', { name: 'Right inspector' });
    await expect(runInspector).toContainText('run-teamrun-1');
    await expect(
      runInspector.getByRole('treeitem', { name: 'delegate → Demo Worker' }),
    ).toBeVisible();
    await expect(
      runInspector.getByRole('treeitem', { name: 'Demo Worker', exact: true }),
    ).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('teamrun-transcript.png'),
    });

    // The retired right-inspector Files tab used to list block-level evidence
    // files (teamrun-state/tasks/events.json). Those blocks are now
    // sidebar-only, and the redesigned inspector aggregates run-level evidence
    // in the Overview panel; expand the artifacts section and assert the
    // fixture's evidence artifact surface there.
    await runInspector
      .getByRole('button', { name: /^(展开|Expand).*(产物|Artifacts)/i })
      .click();
    await expect(runInspector).toContainText('fixture/evidence-capture.json');

    await runInspector.screenshot({
      path: testInfo.outputPath('teamrun-inspector-files.png'),
    });

    expect(
      blocked.filter((url) => isExternalFontUrl(url)),
      'external font requests must be intercepted by the shared guard before the generic abort (#2014)',
    ).toHaveLength(0);
    await testInfo.attach('blocked-live-backend-requests.json', {
      body: Buffer.from(JSON.stringify(blocked, null, 2)),
      contentType: 'application/json',
    });
    await testInfo.attach('font-guard-intercepted.json', {
      body: Buffer.from(JSON.stringify(fontGuard.fontRequests, null, 2)),
      contentType: 'application/json',
    });
  });
});

async function blockLiveBackends(page: Page): Promise<string[]> {
  const blocked: string[] = [];
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());

    if (url.host === 'localhost:5199' || url.host === '127.0.0.1:5199') {
      await route.continue();
      return;
    }

    if (LIVE_BACKEND_HOSTS.has(url.host)) {
      blocked.push(url.toString());
      await route.fulfill({
        contentType: 'application/json',
        status: 503,
        body: JSON.stringify({
          error: 'blocked_by_teamrun_fixture_evidence_gate',
          fixture_only: true,
        }),
      });
      return;
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      blocked.push(url.toString());
      await route.abort('blockedbyclient');
      return;
    }

    await route.continue();
  });
  return blocked;
}
