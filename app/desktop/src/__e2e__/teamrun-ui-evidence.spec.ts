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

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('agenthub-workbench')).toBeVisible();

    await page.getByRole('button', { name: /TeamRun Fixture/ }).click();

    await expect(page.getByRole('region', { name: 'Transcript' })).toContainText(
      'TeamRun Console fixture state 已载入',
    );
    await expect(page.getByText('TeamRun route / task / event list')).toBeVisible();
    await expect(page.getByText('run.agent.route_decision', { exact: true })).toBeVisible();
    await expect(page.getByText('team.route.decided', { exact: true })).toBeVisible();
    await expect(page.getByText('Worker fixture task', { exact: true })).toBeVisible();

    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath('teamrun-transcript.png'),
    });

    await page.getByRole('tab', { name: /文件/ }).click();

    const inspector = page.getByRole('complementary', { name: 'Right inspector' });
    await expect(inspector).toContainText('teamrun-state.json');
    await expect(inspector).toContainText('teamrun-tasks.json');
    await expect(inspector).toContainText('teamrun-events.json');

    await inspector.screenshot({
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
