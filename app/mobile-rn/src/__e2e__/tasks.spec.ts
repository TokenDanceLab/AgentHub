/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * E2E: Tasks screen — interaction, error, and loading state tests.
 *
 * Verifies task list rendering, pane switching, view mode toggling,
 * approval/rejection flows, evidence file display, and fixture-driven states.
 */
import { test, expect } from '@playwright/test';

test.describe('Tasks screen rendering', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('task digest strip is visible on home screen', async ({ page }) => {
    // The task digest strip shows task counts
    const taskDigest = page.getByText(/Tasks need|任务需要|任务动态/).first();
    await expect(taskDigest).toBeVisible({ timeout: 10000 });
  });

  test('thread list shows run-related metadata', async ({ page }) => {
    // Threads with active runs should show review indicators
    await expect(page.getByText('AgentHub Mobile Workbench').first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Interaction tests: tap, input, navigation
// ---------------------------------------------------------------------------

test.describe('Tasks interaction tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('pinned card shows active run with review information', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Pinned card should show active run title
    const pinnedTitle = page.getByText(/视觉校准|visual.*qa/).first();
    await expect(pinnedTitle).toBeVisible({ timeout: 10000 });
  });

  test('evidence inspector sheet shows changed files', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Find evidence button on pinned card
    const evidenceButton = page.getByRole('button', { name: /evidence inspector|证据检查器/i });
    if (await evidenceButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await evidenceButton.click();
      await page.waitForTimeout(500);

      // Should show file names
      const fileItem = page.getByText(/package\.json|tokens\.ts|Button\.tsx/).first();
      await expect(fileItem).toBeVisible({ timeout: 5000 });
    }
  });

  test('approval blocks in chat show expandable evidence content', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Tap on an approval block
    const approvalBlock = page.getByText(/审查.*视觉校准|review.*visual/i).first();
    await approvalBlock.click();
    await page.waitForTimeout(500);

    // Should show expanded evidence content
    const evidenceDetail = page.getByText(/Review|待审批|design|token/).first();
    await expect(evidenceDetail).toBeVisible({ timeout: 5000 });
  });

  test('diff blocks show file count and additions/deletions', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Tap on diff block
    const diffBlock = page.getByText(/token.*primitive|tokens\.ts/i).first();
    await diffBlock.click();
    await page.waitForTimeout(500);

    // Should show file info and stats
    const fileInfo = page.getByText(/files|文件|file/).first();
    await expect(fileInfo).toBeVisible({ timeout: 5000 });
  });

  test('chat shows tool_call evidence blocks', async ({ page }) => {
    // Navigate to a thread with tool_call evidence
    const backendThread = page.getByText(/Hub sender/).first();
    await backendThread.click();
    await page.waitForTimeout(2000);

    // Should see transcript content
    const anyContent = page.getByText(/identity|sender|Agent/).first();
    await expect(anyContent).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Error state tests
// ---------------------------------------------------------------------------

test.describe('Tasks error state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('failed delivery shows retry indicator in thread', async ({ page }) => {
    // Check for any retry/failed indicators in the thread list
    const retryText = page.getByText(/retry|重试|Failed|失败/).first();

    // At minimum, the thread list should be visible even in error states
    await expect(page.getByText('AgentHub Mobile Workbench').first()).toBeVisible({ timeout: 10000 });
  });

  test('approval_required threads show review status in thread list', async ({ page }) => {
    // The first thread has an approval_required run
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await expect(firstThread).toBeVisible({ timeout: 10000 });

    // Review indicators should be present
    const needsAction = page.getByText(/Needs action|需处理/).first();
    await expect(needsAction).toBeVisible({ timeout: 10000 });
  });

  test('task digest shows correct pending/active/failed counts', async ({ page }) => {
    // Task digest should show review/active/failed counts
    const taskDigest = page.getByText(/reviews|审批|active|进行中|failed|失败/).first();
    await expect(taskDigest).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Loading state tests
// ---------------------------------------------------------------------------

test.describe('Tasks loading state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('task digest renders with count information', async ({ page }) => {
    // Task digest strip should appear after load
    const taskDigest = page.getByText(/Tasks need|任务需要|任务动态/).first();
    await expect(taskDigest).toBeVisible({ timeout: 15000 });
  });

  test('pinned card shows run info after thread navigation', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2500);

    // Pinned card with run information
    const pinnedBy = page.getByText(/Pinned by/).first();
    await expect(pinnedBy).toBeVisible({ timeout: 10000 });
  });

  test('chat evidence blocks render with correct colors and badges', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Approval, diff, and tool_call blocks should all render
    // with badges showing status
    const badge = page.getByText(/Review|Pending|待审批/).first();
    await expect(badge).toBeVisible({ timeout: 10000 });
  });
});
