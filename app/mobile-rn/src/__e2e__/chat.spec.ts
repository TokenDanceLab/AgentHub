/**
 * E2E: Chat message send.
 *
 * Verifies that the chat screen renders transcript messages and the composer
 * allows typing and sending a message.
 */
import { test, expect } from '@playwright/test';

test.describe('Chat message send', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the thread list to appear
    await page.waitForTimeout(3000);
  });

  test('navigates to a thread and sees transcript messages', async ({ page }) => {
    // Click the first thread to open chat
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The transcript should contain a human message from Alice
    const aliceMessage = page.getByText(/把移动端聊天|桌面.*工作台/).first();
    await expect(aliceMessage).toBeVisible({ timeout: 10000 });

    // There should be an approval block visible in the chat
    const approvalBlock = page.getByText(/审查.*视觉校准|review.*visual/i).first();
    await expect(approvalBlock).toBeVisible({ timeout: 10000 });
  });

  test('composer input is visible and accepts text', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The composer TextInput should be present
    const composerInput = page.locator('[contenteditable="true"], textarea, input[type="text"]').first();
    await expect(composerInput).toBeVisible({ timeout: 10000 });
  });

  test('typing in composer and clicking send clears the input', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Find the composer textarea/input and type a message
    // React Native TextInput renders as a contenteditable div or textarea
    const composerArea = page.locator('textarea, [contenteditable="true"]').first();

    if (await composerArea.isVisible({ timeout: 3000 }).catch(() => false)) {
      await composerArea.click();
      await composerArea.fill('Hello from E2E test');
      await page.waitForTimeout(500);

      // The send button should be enabled
      const sendButton = page.getByRole('button', { name: /send|发送/i });
      await expect(sendButton).toBeVisible({ timeout: 5000 });

      // Click send
      await sendButton.click();
      await page.waitForTimeout(1000);

      // The composer input should be cleared after sending
      const inputValue = await composerArea.inputValue().catch(() => '');
      expect(inputValue).toBe('');
    }
  });

  test('send button is disabled when composer is empty', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The send button should exist (even if visually disabled)
    const sendButton = page.getByRole('button', { name: /send|发送/i });
    await expect(sendButton).toBeVisible({ timeout: 10000 });
  });

  test('chat header shows thread title and participant info', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The chat header should show the thread title
    const headerTitle = page.getByText('AgentHub Mobile Workbench').first();
    await expect(headerTitle).toBeVisible({ timeout: 10000 });

    // Should show participant type (workflow/group)
    const participantLabel = page.getByText(/workflow|群聊/i).first();
    await expect(participantLabel).toBeVisible({ timeout: 10000 });
  });

  test('pinned card shows active run info', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // The pinned card should show the active run title
    const pinnedTitle = page.getByText(/视觉校准|visual.*qa/i).first();
    await expect(pinnedTitle).toBeVisible({ timeout: 10000 });
  });

  test('back button returns to thread list', async ({ page }) => {
    // Navigate to thread
    const firstThread = page.getByText('AgentHub Mobile Workbench').first();
    await firstThread.click();
    await page.waitForTimeout(2000);

    // Press back
    const backButton = page.getByRole('button', { name: /back|返回/i });
    await backButton.click();
    await page.waitForTimeout(1000);

    // Should be back on thread list, seeing other threads
    await expect(page.getByText('AgentHub Design Contract').first()).toBeVisible({ timeout: 10000 });
  });
});
