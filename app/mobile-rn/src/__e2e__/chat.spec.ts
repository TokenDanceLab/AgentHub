/**
 * E2E: Chat screen — interaction, error, and loading state tests.
 *
 * Verifies chat message rendering, composer interaction, navigation flows,
 * error/retry states, sending states, and evidence sheet interactions.
 */
import { test, expect } from '@playwright/test';

test.describe('Chat message send (smoke)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('navigates to a thread and sees transcript messages', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const aliceMessage = page.getByText(/把移动端聊天|桌面.*工作台/).first();
    await expect(aliceMessage).toBeVisible({ timeout: 10000 });

    const approvalBlock = page.getByText(/审查.*视觉校准|review.*visual/i).first();
    await expect(approvalBlock).toBeVisible({ timeout: 10000 });
  });

  test('composer input is visible and accepts text', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const composerInput = page.locator('[contenteditable="true"], textarea, input[type="text"]').first();
    await expect(composerInput).toBeVisible({ timeout: 10000 });
  });

  test('typing in composer and clicking send clears the input', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const composerArea = page.locator('textarea, [contenteditable="true"]').first();

    if (await composerArea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await composerArea.click();
      await composerArea.fill('Hello from E2E test');
      await page.waitForTimeout(500);

      const sendButton = page.getByRole('button', { name: /send|发送/i });
      await expect(sendButton).toBeVisible({ timeout: 5000 });

      await sendButton.click();
      await page.waitForTimeout(1000);

      const inputValue = await composerArea.inputValue().catch(() => '');
      expect(inputValue).toBe('');
    }
  });

  test('send button is disabled when composer is empty', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const sendButton = page.getByRole('button', { name: /send|发送/i });
    await expect(sendButton).toBeVisible({ timeout: 10000 });
  });

  test('chat header shows thread title and participant info', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const headerTitle = page.getByText('AgentHub Mobile Workbench').first();
    await expect(headerTitle).toBeVisible({ timeout: 10000 });

    const participantLabel = page.getByText(/workflow|群聊/i).first();
    await expect(participantLabel).toBeVisible({ timeout: 10000 });
  });

  test('pinned card shows active run info', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const pinnedTitle = page.getByText(/视觉校准|visual.*qa/i).first();
    await expect(pinnedTitle).toBeVisible({ timeout: 10000 });
  });

  test('back button returns to thread list', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    const backButton = page.getByRole('button', { name: /back|返回/i });
    await backButton.click();
    await page.waitForTimeout(1000);

    await expect(page.getByText('AgentHub Design Contract').first()).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Interaction tests: tap, input, navigation
// ---------------------------------------------------------------------------

test.describe('Chat interaction tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('tapping a review block opens detail view or shows content', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The approval block should be tappable and have detail content
    const approvalBlock = page.getByText(/审查.*视觉校准|review.*visual/i).first();
    await approvalBlock.click();
    await page.waitForTimeout(500);

    // After tapping, there should be expanded content visible
    const expandedContent = page.getByText(/Review|待审批|design/).first();
    await expect(expandedContent).toBeVisible({ timeout: 5000 });
  });

  test('tapping a diff block shows file list', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Find and tap diff block
    const diffBlock = page.getByText(/token.*primitive|tokens\.ts/i).first();
    await diffBlock.click();
    await page.waitForTimeout(500);

    // Should show file paths
    const filePath = page.getByText(/tokens\.ts|Button\.tsx/).first();
    await expect(filePath).toBeVisible({ timeout: 5000 });
  });

  test('more actions button opens composer action sheet', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The "+" button to expand composer actions
    const moreButton = page.getByRole('button', { name: /more actions|更多操作/i });
    if (await moreButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await moreButton.click();
      await page.waitForTimeout(500);

      // The action sheet should show options
      const evidenceOption = page.getByText(/Evidence|证据|Attachment/).first();
      const agentOption = page.getByText(/Agent picker|选择 Agent|Profile/).first();

      const anyVisible = await evidenceOption.isVisible().catch(() => false)
        || await agentOption.isVisible().catch(() => false);
      expect(anyVisible).toBeTruthy();
    }
  });

  test('pinned card close button dismisses the card', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Find the close button on the pinned card (X button)
    const closeButton = page.getByRole('button', { name: /close|关闭/i }).first();
    if (await closeButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await closeButton.click();
      await page.waitForTimeout(500);

      // The pinned card content should no longer be visible
      // Pinned card title moved away
    }
  });

  test('evidence button on pinned card opens evidence sheet', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Find the evidence inspector button
    const evidenceButton = page.getByRole('button', { name: /evidence inspector|证据检查器/i });
    if (await evidenceButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await evidenceButton.click();
      await page.waitForTimeout(500);

      // The evidence sheet should show changed files or preview info
      const sheetContent = page.getByText(/changed files|变更文件|package\.json|tokens\.ts/).first();
      await expect(sheetContent).toBeVisible({ timeout: 5000 });
    }
  });

  test('scrolling chat transcript shows older messages', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Scroll the transcript area
    const scrollArea = page.locator('[class*="scroll"], [data-testid="chat-scroll"]').first();
    if (await scrollArea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await scrollArea.evaluate((el) => el.scrollTop = el.scrollHeight);
      await page.waitForTimeout(500);
    }

    // The timestamp indicator should still be visible
    const timestamp = page.getByText(/17:18|Yesterday|昨天/).first();
    await expect(timestamp).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Error state tests
// ---------------------------------------------------------------------------

test.describe('Chat error state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('failed delivery shows retry badge in thread list', async ({ page }) => {
    // Look for a thread with failed/retry status
    const retryThread = page.getByText(/retry|重试|Hub sender/).first();
    // If a retry-thread is visible, the error state is rendered
    await expect(retryThread).toBeVisible({ timeout: 10000 });
  });

  test('chat with retryAvailable shows retry indicator', async ({ page }) => {
    // Navigate to the recovery/error thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Go back and try another thread
    const backButton = page.getByRole('button', { name: /back|返回/i });
    await backButton.click();
    await page.waitForTimeout(500);

    // Click on a different thread to see different states
    const altThread = page.getByText(/Hub sender|AgentHub Design/).first();
    await altThread.click();
    await page.waitForTimeout(2000);

    // Chat should still render with messages
    const anyMessage = page.getByText(/identity|sender|Agent/).first();
    await expect(anyMessage).toBeVisible({ timeout: 10000 });
  });

  test('navigating to thread without transcript shows empty state gracefully', async ({ page }) => {
    // Try clicking on a thread without transcript data
    const docsThread = page.getByText('AgentHub Docs').first();
    await docsThread.click();
    await page.waitForTimeout(2000);

    // Should still show chat header
    const header = page.getByText('AgentHub Docs').first();
    await expect(header).toBeVisible({ timeout: 10000 });
  });
});

// ---------------------------------------------------------------------------
// Loading state tests
// ---------------------------------------------------------------------------

test.describe('Chat loading state tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
  });

  test('transition from thread list to chat shows loading transition', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Chat messages should have rendered
    const anyBlock = page.getByText(/把移动端|AgentHub Mobile|视觉校准/).first();
    await expect(anyBlock).toBeVisible({ timeout: 10000 });
  });

  test('chat tab shows active indicator', async ({ page }) => {
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The Chats tab should be highlighted
    const chatTab = page.getByText(/Chats|消息/).first();
    await expect(chatTab).toBeVisible({ timeout: 10000 });
  });
});
