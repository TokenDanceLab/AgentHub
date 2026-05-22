import type { Page } from '@playwright/test';

const EDGE_URL = 'http://127.0.0.1:3210';

export async function isEdgeOnline(page: Page): Promise<boolean> {
  try {
    const res = await page.request.get(`${EDGE_URL}/v1/health`);
    return res.ok();
  } catch {
    return false;
  }
}
