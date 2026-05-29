import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.MOBILE_QA_URL ?? "http://localhost:5174/";
const outDir = path.resolve("screenshots");
const viewport = { width: 390, height: 844 };
const compactViewport = { width: 390, height: 640 };

const threads = [
  {
    id: "thread_mobile_approval",
    projectId: "agenthub-mobile",
    title: "Review approval copy on mobile",
    status: "active",
    createdAt: "2026-05-27T01:10:00Z",
    updatedAt: "2026-05-27T01:22:00Z",
  },
  {
    id: "thread_runtime_bridge",
    projectId: "agenthub-desktop",
    title: "Runtime bridge smoke follow-up",
    status: "active",
    createdAt: "2026-05-26T18:00:00Z",
  },
  {
    id: "thread_docs_handoff",
    projectId: "agenthub-docs",
    title: "Handoff notes for Mobile QA",
    status: "archived",
    createdAt: "2026-05-26T12:00:00Z",
  },
];

const runs = [
  {
    runId: "run_mobile_visual_001",
    projectId: "agenthub-mobile",
    threadId: "thread_mobile_approval",
    status: "running",
    createdAt: "2026-05-27T01:20:00Z",
    startedAt: "2026-05-27T01:21:00Z",
  },
  {
    runId: "run_gateway_docs_002",
    projectId: "agenthub-docs",
    threadId: "thread_docs_handoff",
    status: "waiting_approval",
    createdAt: "2026-05-27T00:55:00Z",
    startedAt: "2026-05-27T00:56:00Z",
  },
  {
    runId: "run_runtime_smoke_003",
    projectId: "agenthub-desktop",
    threadId: "thread_runtime_bridge",
    status: "finished",
    createdAt: "2026-05-26T23:50:00Z",
    startedAt: "2026-05-26T23:51:00Z",
    finishedAt: "2026-05-26T23:53:00Z",
  },
];

function json(data) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
    headers: { "access-control-allow-origin": "*" },
  };
}

async function installMockHub(page, options = {}) {
  const mockThreads = options.threads ?? threads;
  const mockRuns = options.runs ?? runs;
  let threadRequestCount = 0;
  let runRequestCount = 0;
  let messageRequestCount = 0;
  let decisionRequestCount = 0;
  let approvalDecisionOutcome = null;

  await page.addInitScript(() => {
    window.localStorage.setItem("agenthub.mobile.language", "en");
  });

  await page.route("http://api.hub.vectorcontrol.tech/health", async (route) => route.fulfill(json({
    status: "ok",
    version: "visual-qa",
    uptime: "1h",
    checks: { database: "ok", redis: "ok" },
  })));

  await page.route("http://api.hub.vectorcontrol.tech/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname.endsWith("/v1/health")) {
      return route.fulfill(json({
        status: "ok",
        version: "visual-qa",
        edgeId: "mobile-preview",
        checks: { runners: { status: "ok", total: 3, available: 2 } },
      }));
    }

    if (pathname.endsWith("/v1/threads")) {
      threadRequestCount += 1;
      if (threadRequestCount > 1 && options.delayThreadRefreshMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayThreadRefreshMs));
      }
      return route.fulfill(json({ items: mockThreads, page: { hasMore: false } }));
    }

    if (pathname.includes("/v1/threads/thread_mobile_approval/items")) {
      if (options.threadItemsStatus && options.threadItemsStatus >= 400) {
        return route.fulfill({
          status: options.threadItemsStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: "mock thread items failure" }),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      const baseThreadItems = [
        {
          id: "msg_1",
          threadId: "thread_mobile_approval",
          kind: "message",
          role: "user",
          content: "Can you verify the approval copy on a phone before release?",
          createdAt: "2026-05-27T01:11:00Z",
        },
        {
          id: "msg_2",
          threadId: "thread_mobile_approval",
          kind: "message",
          role: "agent",
          content: "I will check the compact review surface, status wording, and tap targets against the TokenDance design contract.",
          createdAt: "2026-05-27T01:12:00Z",
        },
        {
          id: "activity_approval_1",
          threadId: "thread_mobile_approval",
          kind: "approval",
          role: "agent",
          content: "Approval checkpoint is waiting for a mobile reviewer before release handoff.",
          createdAt: "2026-05-27T01:16:00Z",
        },
        {
          id: "activity_diff_1",
          threadId: "thread_mobile_approval",
          kind: "diff",
          role: "agent",
          content: "2 files changed in Mobile review copy and visual QA evidence.",
          createdAt: "2026-05-27T01:18:00Z",
        },
      ];
      const longThreadItems = options.longThread ? [
        {
          id: "msg_3",
          threadId: "thread_mobile_approval",
          kind: "message",
          role: "agent",
          content: "Review note: the bottom dock must stay reachable after scrolling through activity, diff context, and handoff notes.",
          createdAt: "2026-05-27T01:19:00Z",
        },
        {
          id: "msg_4",
          threadId: "thread_mobile_approval",
          kind: "message",
          role: "user",
          content: "Keep the latest reply reachable without forcing the reviewer to drag through the whole thread.",
          createdAt: "2026-05-27T01:20:00Z",
        },
        {
          id: "msg_5",
          threadId: "thread_mobile_approval",
          kind: "message",
          role: "agent",
          content: "Latest anchor is ready for the final mobile handoff check.",
          createdAt: "2026-05-27T01:21:00Z",
        },
      ] : [];
      return route.fulfill(json({
        items: [...baseThreadItems, ...longThreadItems],
        page: { hasMore: false },
      }));
    }

    if (pathname.includes("/v1/threads/thread_mobile_approval/messages")) {
      messageRequestCount += 1;
      if (options.messageDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.messageDelayMs));
      }
      if (options.messageFailuresBeforeSuccess && messageRequestCount <= options.messageFailuresBeforeSuccess) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "mock transient message failure" }),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      if (options.messageStatus && options.messageStatus >= 400) {
        return route.fulfill({
          status: options.messageStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: "mock message failure" }),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      return route.fulfill(json({
        id: "msg_new",
        threadId: "thread_mobile_approval",
        role: "user",
        content: "Looks good from mobile.",
        createdAt: new Date().toISOString(),
      }));
    }

    if (pathname.endsWith("/v1/runs")) {
      runRequestCount += 1;
      if (runRequestCount > 1 && options.delayRunRefreshMs) {
        await new Promise((resolve) => setTimeout(resolve, options.delayRunRefreshMs));
      }
      const currentRuns = approvalDecisionOutcome
        ? mockRuns.map((run) => (
          run.runId === "run_gateway_docs_002"
            ? { ...run, status: approvalDecisionOutcome === "rejected" ? "failed" : "running" }
            : run
        ))
        : mockRuns;
      return route.fulfill(json({ items: currentRuns, page: { hasMore: false } }));
    }

    if (pathname.includes("/v1/approvals/") && pathname.endsWith(":decide")) {
      decisionRequestCount += 1;
      if (options.decisionDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.decisionDelayMs));
      }
      if (options.decisionFailuresBeforeSuccess && decisionRequestCount <= options.decisionFailuresBeforeSuccess) {
        return route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "mock transient approval decision failure" }),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      if (options.decisionStatus && options.decisionStatus >= 400) {
        return route.fulfill({
          status: options.decisionStatus,
          contentType: "application/json",
          body: JSON.stringify({ error: "mock approval decision failure" }),
          headers: { "access-control-allow-origin": "*" },
        });
      }
      const requestBody = route.request().postDataJSON();
      approvalDecisionOutcome = requestBody?.decision === "rejected" ? "rejected" : "approved";
      return route.fulfill(json({
        id: "approval_gateway_1",
        runId: "run_gateway_docs_002",
        threadId: "thread_docs_handoff",
        kind: "file_write",
        summary: "Review generated Gateway release note edits before publish",
        status: approvalDecisionOutcome,
        createdAt: "2026-05-27T00:58:00Z",
      }));
    }

    if (pathname.endsWith("/v1/approvals")) {
      return route.fulfill(json({
        items: [
          {
            id: "approval_gateway_1",
            runId: "run_gateway_docs_002",
            threadId: "thread_docs_handoff",
            kind: "file_write",
            summary: "Review generated Gateway release note edits before publish",
            status: approvalDecisionOutcome ?? "pending",
            createdAt: "2026-05-27T00:58:00Z",
          },
        ],
        page: { hasMore: false },
      }));
    }

    if (pathname.endsWith("/v1/artifacts")) {
      return route.fulfill(json({
        items: [
          {
            id: "artifact_release_note",
            runId: "run_gateway_docs_002",
            threadId: "thread_docs_handoff",
            kind: "markdown",
            path: "docs/release/gateway-mobile-review.md",
            sizeBytes: 3824,
            createdAt: "2026-05-27T01:01:00Z",
          },
          {
            id: "artifact_mobile_report",
            runId: "run_mobile_visual_001",
            threadId: "thread_mobile_approval",
            kind: "png",
            path: "screenshots/mobile-design-after-runs-mocked-dark.png",
            sizeBytes: 86420,
            createdAt: "2026-05-27T01:23:00Z",
          },
        ],
        page: { hasMore: false },
      }));
    }

    if (pathname.endsWith("/v1/previews")) {
      return route.fulfill(json({
        items: [
          {
            id: "preview_gateway_note",
            runId: "run_gateway_docs_002",
            threadId: "thread_docs_handoff",
            url: "https://preview.agenthub.local/gateway-mobile-review",
            status: "ready",
            createdAt: "2026-05-27T01:02:00Z",
          },
        ],
        page: { hasMore: false },
      }));
    }

    if (pathname.includes("/v1/runs/run_gateway_docs_002/diff")) {
      return route.fulfill(json({
        runId: "run_gateway_docs_002",
        files: [
          {
            path: "docs/release/gateway-mobile-review.md",
            status: "modified",
            diff: "@@ release note @@\n- Mobile approval is not documented.\n+ Mobile approval now shows compact review, diff preview, and explicit approve/reject actions.\n+ Screenshot evidence: mobile-design-approval-diff-mocked-dark.png",
          },
          {
            path: "app/mobile/src/views/RunStatusView.tsx",
            status: "modified",
            diff: "@@ run detail @@\n+ <section className=\"mobileApprovalPanel\">\n+ <section className=\"mobileDiffPanel\">",
          },
        ],
      }));
    }

    if (pathname.includes("/v1/runs/run_gateway_docs_002/logs")) {
      return route.fulfill(json({
        runId: "run_gateway_docs_002",
        stdout: "[approval] pending file_write decision\n[diff] 2 files changed\n[mobile] reviewer action required\n[mobile] waiting for final handoff confirmation\n",
        stderr: "[warn] live Hub workflow contract is still pending",
      }));
    }

    if (pathname.includes("/v1/runs/run_gateway_docs_002/items")) {
      return route.fulfill(json({
        items: [
          {
            id: "run_item_approval",
            threadId: "thread_docs_handoff",
            kind: "approval",
            role: "agent",
            content: "file_write approval required before publishing release note changes.",
            createdAt: "2026-05-27T00:58:00Z",
          },
          {
            id: "run_item_diff",
            threadId: "thread_docs_handoff",
            kind: "diff",
            role: "agent",
            content: "2 files changed: release note and Mobile run detail surface.",
            createdAt: "2026-05-27T00:59:00Z",
          },
          {
            id: "run_item_code",
            threadId: "thread_docs_handoff",
            kind: "code",
            role: "agent",
            content: "Rendered approval panel with explicit approve and reject actions.",
            createdAt: "2026-05-27T01:00:00Z",
          },
          {
            id: "run_item_file",
            threadId: "thread_docs_handoff",
            kind: "file",
            role: "agent",
            content: "Prepared docs/release/gateway-mobile-review.md for the handoff evidence update.",
            createdAt: "2026-05-27T01:01:00Z",
          },
        ],
        page: { hasMore: false },
      }));
    }

    if (pathname.includes("/v1/runs/run_gateway_docs_002")) {
      return route.fulfill(json(runs[1]));
    }

    if (pathname.includes("/v1/runs/run_mobile_visual_001/logs")) {
      return route.fulfill(json({
        runId: "run_mobile_visual_001",
        stdout: "[mobile] typecheck passed\n[mobile] visual QA running\n",
        stderr: "",
      }));
    }

    if (pathname.includes("/v1/runs/run_mobile_visual_001/items")) {
      return route.fulfill(json({
        items: [
          {
            id: "run_item_message",
            threadId: "thread_mobile_approval",
            kind: "message",
            role: "agent",
            content: "Mobile visual QA is running against the dense command-center workflow.",
            createdAt: "2026-05-27T01:22:00Z",
          },
        ],
        page: { hasMore: false },
      }));
    }

    if (pathname.includes("/v1/runs/run_mobile_visual_001")) {
      return route.fulfill(json(runs[0]));
    }

    return route.fulfill(json({ items: [], page: { hasMore: false } }));
  });
}

async function installRecoveryMockHub(page, failingSurface) {
  await page.addInitScript(() => {
    window.localStorage.setItem("agenthub.mobile.language", "en");
  });

  await page.route("http://api.hub.vectorcontrol.tech/health", async (route) => route.fulfill(json({
    status: "ok",
    version: "visual-qa",
    uptime: "1h",
    checks: { database: "ok", redis: "ok" },
  })));

  await page.route("http://api.hub.vectorcontrol.tech/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;

    if (pathname.endsWith("/v1/health")) {
      return route.fulfill(json({
        status: "ok",
        version: "visual-qa",
        edgeId: "mobile-preview",
        checks: { runners: { status: "ok", total: 3, available: 2 } },
      }));
    }

    if (failingSurface === "threads" && pathname.endsWith("/v1/threads")) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "HUB_UNAVAILABLE", message: "Hub handoff queue unavailable" }),
        headers: { "access-control-allow-origin": "*" },
      });
    }

    if (failingSurface === "runs" && pathname.endsWith("/v1/runs")) {
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "HUB_UNAVAILABLE", message: "Hub run queue unavailable" }),
        headers: { "access-control-allow-origin": "*" },
      });
    }

    if (pathname.endsWith("/v1/threads")) {
      return route.fulfill(json({ items: threads, page: { hasMore: false } }));
    }

    if (pathname.endsWith("/v1/runs")) {
      return route.fulfill(json({ items: runs, page: { hasMore: false } }));
    }

    return route.fulfill(json({ items: [], page: { hasMore: false } }));
  });
}

async function snapshot(page, fileName) {
  await page.screenshot({ path: path.join(outDir, fileName), fullPage: true });
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button")).map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent?.trim() || button.getAttribute("aria-label") || "",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });

    return {
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
      buttons,
    };
  });
}

function assertMetrics(fileName, metrics) {
  if (metrics.scrollWidth > metrics.innerWidth) {
    throw new Error(`${fileName}: horizontal overflow ${metrics.scrollWidth} > ${metrics.innerWidth}`);
  }

  const tooSmall = metrics.buttons.filter((button) => button.width < 44 || button.height < 44);
  if (tooSmall.length > 0) {
    throw new Error(`${fileName}: touch targets below 44px ${JSON.stringify(tooSmall)}`);
  }
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
await page.context().grantPermissions(["clipboard-write"], { origin: new URL(baseUrl).origin });

const consoleMessages = [];
const expectedConsoleFragments = [
  "the server responded with a status of 503 (Service Unavailable)",
];

function isExpectedConsoleMessage(text) {
  return (
    text.includes("[vite]")
    || text.includes("React DevTools")
    || expectedConsoleFragments.some((fragment) => text.includes(fragment))
  );
}

page.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
page.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));

await mkdir(outDir, { recursive: true });
await installMockHub(page);

await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });

const results = [];
await page.getByRole("button", { name: /^Threads, 2 active threads$/ }).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: /^Runs, 1 pending reviews$/ }).waitFor({ timeout: 5000 });
results.push(["mobile-design-bottom-nav-badges-mocked-dark.png", await snapshot(page, "mobile-design-bottom-nav-badges-mocked-dark.png")]);
results.push(["mobile-design-after-threads-mocked-dark.png", await snapshot(page, "mobile-design-after-threads-mocked-dark.png")]);
results.push(["mobile-design-threads-handoff-mocked-dark.png", await snapshot(page, "mobile-design-threads-handoff-mocked-dark.png")]);
await page.getByRole("button", { name: /Archived/ }).click();
await page.waitForTimeout(200);
results.push(["mobile-design-threads-filter-archived-mocked-dark.png", await snapshot(page, "mobile-design-threads-filter-archived-mocked-dark.png")]);
await page.getByRole("button", { name: /All/ }).click();
await page.waitForTimeout(150);

const threadRefreshPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
threadRefreshPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
threadRefreshPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(threadRefreshPage, { delayThreadRefreshMs: 2000 });
await threadRefreshPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await threadRefreshPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).waitFor({ timeout: 5000 });
await threadRefreshPage.getByRole("button", { name: "Refresh threads" }).click();
await threadRefreshPage.getByText("Refreshing thread handoff...").waitFor({ timeout: 1000 });
results.push(["mobile-design-threads-refreshing-mocked-dark.png", await snapshot(threadRefreshPage, "mobile-design-threads-refreshing-mocked-dark.png")]);
await threadRefreshPage.close();

await page.getByRole("button", { name: "Chat" }).click();
await page.waitForTimeout(150);
results.push(["mobile-design-chat-empty-cta-mocked-dark.png", await snapshot(page, "mobile-design-chat-empty-cta-mocked-dark.png")]);
await page.getByRole("button", { name: "Browse threads" }).click();
await page.waitForTimeout(150);

await page.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await page.waitForTimeout(250);
results.push(["mobile-design-after-chat-mocked-dark.png", await snapshot(page, "mobile-design-after-chat-mocked-dark.png")]);
results.push(["mobile-design-chat-context-mocked-dark.png", await snapshot(page, "mobile-design-chat-context-mocked-dark.png")]);
await page.getByRole("button", { name: "Copy message from Agent" }).click();
await page.getByText("Copied").waitFor({ timeout: 1000 });
results.push(["mobile-design-chat-copy-feedback-mocked-dark.png", await snapshot(page, "mobile-design-chat-copy-feedback-mocked-dark.png")]);
await page.waitForTimeout(1900);
await page.locator(".mobileActivityCard").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
results.push(["mobile-design-chat-activity-cards-mocked-dark.png", await snapshot(page, "mobile-design-chat-activity-cards-mocked-dark.png")]);
results.push(["mobile-design-chat-composer-scope-mocked-dark.png", await snapshot(page, "mobile-design-chat-composer-scope-mocked-dark.png")]);
await page.getByRole("button", { name: "Chat" }).click();
await page.waitForTimeout(150);
results.push(["mobile-design-chat-tab-root-mocked-dark.png", await snapshot(page, "mobile-design-chat-tab-root-mocked-dark.png")]);

const chatRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatRecoveryPage, { threadItemsStatus: 503 });
await chatRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatRecoveryPage.getByRole("button", { name: "Chat" }).click();
await chatRecoveryPage.waitForTimeout(150);
await chatRecoveryPage.getByRole("button", { name: "Browse threads" }).click();
await chatRecoveryPage.waitForTimeout(150);
await chatRecoveryPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatRecoveryPage.getByText("Messages could not sync").waitFor({ timeout: 5000 });
await chatRecoveryPage.getByText("Reply paused until timeline sync returns.").waitFor({ timeout: 1000 });
await chatRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Retry" }).waitFor({ timeout: 1000 });
await chatRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Threads" }).waitFor({ timeout: 1000 });
if (await chatRecoveryPage.getByRole("button", { name: "Send mobile reply" }).count()) {
  throw new Error("mobile-design-chat-recovery-mocked-dark.png: send action should be hidden while the thread timeline is unavailable");
}
results.push(["mobile-design-chat-recovery-mocked-dark.png", await snapshot(chatRecoveryPage, "mobile-design-chat-recovery-mocked-dark.png")]);
await chatRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Threads" }).click();
await chatRecoveryPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).waitFor({ timeout: 5000 });
await chatRecoveryPage.close();

const chatLatestPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatLatestPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatLatestPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatLatestPage, { longThread: true });
await chatLatestPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatLatestPage.getByRole("button", { name: "Chat" }).click();
await chatLatestPage.waitForTimeout(150);
await chatLatestPage.getByRole("button", { name: "Browse threads" }).click();
await chatLatestPage.waitForTimeout(150);
await chatLatestPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatLatestPage.waitForTimeout(300);
await chatLatestPage.locator(".mobileChatScroll").evaluate((element) => {
  element.scrollTop = 0;
  element.dispatchEvent(new Event("scroll", { bubbles: true }));
});
await chatLatestPage.getByRole("button", { name: "Jump to latest message" }).waitFor({ timeout: 1000 });
results.push(["mobile-design-chat-latest-jump-mocked-dark.png", await snapshot(chatLatestPage, "mobile-design-chat-latest-jump-mocked-dark.png")]);
await chatLatestPage.getByRole("button", { name: "Jump to latest message" }).click();
await chatLatestPage.getByRole("button", { name: "Jump to latest message" }).waitFor({ state: "detached", timeout: 1000 });
await chatLatestPage.close();

const chatPendingPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatPendingPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatPendingPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatPendingPage, { messageDelayMs: 2000 });
await chatPendingPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatPendingPage.getByRole("button", { name: "Chat" }).click();
await chatPendingPage.waitForTimeout(150);
await chatPendingPage.getByRole("button", { name: "Browse threads" }).click();
await chatPendingPage.waitForTimeout(150);
await chatPendingPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatPendingPage.waitForTimeout(250);
await chatPendingPage.getByRole("textbox", { name: "Mobile reply" }).fill("Looks good from mobile.");
await chatPendingPage.getByRole("button", { name: "Send mobile reply" }).click();
await chatPendingPage.getByText("Sending reply from Mobile...").waitFor({ timeout: 1000 });
await chatPendingPage.getByText("Looks good from mobile.").waitFor({ timeout: 1000 });
results.push(["mobile-design-chat-send-pending-mocked-dark.png", await snapshot(chatPendingPage, "mobile-design-chat-send-pending-mocked-dark.png")]);
await chatPendingPage.close();

const chatErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatErrorPage, { messageStatus: 503 });
await chatErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatErrorPage.getByRole("button", { name: "Chat" }).click();
await chatErrorPage.waitForTimeout(150);
await chatErrorPage.getByRole("button", { name: "Browse threads" }).click();
await chatErrorPage.waitForTimeout(150);
await chatErrorPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatErrorPage.waitForTimeout(250);
await chatErrorPage.getByRole("textbox", { name: "Mobile reply" }).fill("Retry this mobile handoff.");
await chatErrorPage.getByRole("button", { name: "Send mobile reply" }).click();
await chatErrorPage.getByText("Reply stayed in the composer.").waitFor({ timeout: 5000 });
await chatErrorPage.getByRole("button", { name: "Retry mobile reply" }).waitFor({ timeout: 5000 });
await chatErrorPage.getByText("Not sent").waitFor({ timeout: 1000 });
results.push(["mobile-design-chat-send-error-mocked-dark.png", await snapshot(chatErrorPage, "mobile-design-chat-send-error-mocked-dark.png")]);
results.push(["mobile-design-chat-send-error-retry-mocked-dark.png", await snapshot(chatErrorPage, "mobile-design-chat-send-error-retry-mocked-dark.png")]);
await chatErrorPage.close();

const chatRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatRetrySuccessPage, { messageFailuresBeforeSuccess: 1 });
await chatRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatRetrySuccessPage.getByRole("button", { name: "Chat" }).click();
await chatRetrySuccessPage.waitForTimeout(150);
await chatRetrySuccessPage.getByRole("button", { name: "Browse threads" }).click();
await chatRetrySuccessPage.waitForTimeout(150);
await chatRetrySuccessPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatRetrySuccessPage.waitForTimeout(250);
await chatRetrySuccessPage.getByRole("textbox", { name: "Mobile reply" }).fill("Retry this mobile handoff.");
await chatRetrySuccessPage.getByRole("button", { name: "Send mobile reply" }).click();
await chatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).waitFor({ timeout: 5000 });
await chatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).click();
await chatRetrySuccessPage.getByText("Sent").waitFor({ timeout: 5000 });
if (await chatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).count()) {
  throw new Error("mobile-design-chat-send-retry-success-mocked-dark.png: retry action should clear after the retried message succeeds");
}
results.push(["mobile-design-chat-send-retry-success-mocked-dark.png", await snapshot(chatRetrySuccessPage, "mobile-design-chat-send-retry-success-mocked-dark.png")]);
await chatRetrySuccessPage.close();

const chatSuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
chatSuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
chatSuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(chatSuccessPage);
await chatSuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await chatSuccessPage.getByRole("button", { name: "Chat" }).click();
await chatSuccessPage.waitForTimeout(150);
await chatSuccessPage.getByRole("button", { name: "Browse threads" }).click();
await chatSuccessPage.waitForTimeout(150);
await chatSuccessPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await chatSuccessPage.waitForTimeout(250);
await chatSuccessPage.getByRole("textbox", { name: "Mobile reply" }).fill("Mobile handoff is approved.");
await chatSuccessPage.getByRole("button", { name: "Send mobile reply" }).click();
await chatSuccessPage.getByText("Sent").waitFor({ timeout: 5000 });
await chatSuccessPage.getByText("Mobile handoff is approved.").waitFor({ timeout: 5000 });
results.push(["mobile-design-chat-send-success-mocked-dark.png", await snapshot(chatSuccessPage, "mobile-design-chat-send-success-mocked-dark.png")]);
await chatSuccessPage.close();

await page.getByRole("button", { name: /^Runs/ }).click();
await page.waitForTimeout(500);
results.push(["mobile-design-after-runs-mocked-dark.png", await snapshot(page, "mobile-design-after-runs-mocked-dark.png")]);
results.push(["mobile-design-runs-triage-mocked-dark.png", await snapshot(page, "mobile-design-runs-triage-mocked-dark.png")]);
await page.locator('.mobileSegmentButton').filter({ hasText: "Review" }).click();
await page.waitForTimeout(200);
results.push(["mobile-design-runs-filter-review-mocked-dark.png", await snapshot(page, "mobile-design-runs-filter-review-mocked-dark.png")]);
await page.locator('.mobileSegmentButton').filter({ hasText: "Closed" }).click();
await page.waitForTimeout(200);
results.push(["mobile-design-runs-filter-closed-mocked-dark.png", await snapshot(page, "mobile-design-runs-filter-closed-mocked-dark.png")]);
await page.locator('.mobileSegmentButton').filter({ hasText: "Review" }).click();
await page.waitForTimeout(200);

const runRefreshPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
runRefreshPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
runRefreshPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(runRefreshPage, { delayRunRefreshMs: 2000 });
await runRefreshPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await runRefreshPage.getByRole("button", { name: /^Runs/ }).click();
await runRefreshPage.getByText("Run run_mobi").waitFor({ timeout: 5000 });
await runRefreshPage.getByRole("button", { name: "Refresh runs" }).click();
await runRefreshPage.getByText("Refreshing run queue...").waitFor({ timeout: 1000 });
results.push(["mobile-design-runs-refreshing-mocked-dark.png", await snapshot(runRefreshPage, "mobile-design-runs-refreshing-mocked-dark.png")]);
await runRefreshPage.close();

await page.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await page.waitForTimeout(700);
results.push(["mobile-design-run-summary-mocked-dark.png", await snapshot(page, "mobile-design-run-summary-mocked-dark.png")]);
await page.getByRole("button", { name: /Blocks summary: 4 items/ }).click();
await page.waitForTimeout(450);
results.push(["mobile-design-run-summary-shortcut-blocks-mocked-dark.png", await snapshot(page, "mobile-design-run-summary-shortcut-blocks-mocked-dark.png")]);
await page.locator(".mobileRunSectionNav").getByRole("button", { name: "Review" }).click();
await page.waitForTimeout(350);
results.push(["mobile-design-approval-diff-mocked-dark.png", await snapshot(page, "mobile-design-approval-diff-mocked-dark.png")]);
await page.locator(".mobileDiffCode").first().scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
results.push(["mobile-design-diff-lines-mocked-dark.png", await snapshot(page, "mobile-design-diff-lines-mocked-dark.png")]);
results.push(["mobile-design-review-action-dock-mocked-dark.png", await snapshot(page, "mobile-design-review-action-dock-mocked-dark.png")]);
await page.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await page.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-approval-confirm-sheet-mocked-dark.png", await snapshot(page, "mobile-design-approval-confirm-sheet-mocked-dark.png")]);
await page.getByRole("button", { name: "Cancel" }).click();
await page.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await page.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-reject-confirm-sheet-mocked-dark.png", await snapshot(page, "mobile-design-reject-confirm-sheet-mocked-dark.png")]);
await page.getByRole("button", { name: "Cancel" }).click();

const approvalSubmittingPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
approvalSubmittingPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
approvalSubmittingPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(approvalSubmittingPage, { decisionDelayMs: 2000 });
await approvalSubmittingPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await approvalSubmittingPage.getByRole("button", { name: /^Runs/ }).click();
await approvalSubmittingPage.waitForTimeout(250);
await approvalSubmittingPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await approvalSubmittingPage.waitForTimeout(150);
await approvalSubmittingPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await approvalSubmittingPage.waitForTimeout(700);
await approvalSubmittingPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await approvalSubmittingPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await approvalSubmittingPage.getByRole("button", { name: "Confirm approve" }).click();
await approvalSubmittingPage.getByText("Submitting approval decision to Hub...").waitFor({ timeout: 1000 });
results.push(["mobile-design-approval-submit-pending-mocked-dark.png", await snapshot(approvalSubmittingPage, "mobile-design-approval-submit-pending-mocked-dark.png")]);
await approvalSubmittingPage.close();

const approvalErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
approvalErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
approvalErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(approvalErrorPage, { decisionStatus: 503 });
await approvalErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await approvalErrorPage.getByRole("button", { name: /^Runs/ }).click();
await approvalErrorPage.waitForTimeout(250);
await approvalErrorPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await approvalErrorPage.waitForTimeout(150);
await approvalErrorPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await approvalErrorPage.waitForTimeout(700);
await approvalErrorPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await approvalErrorPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await approvalErrorPage.getByRole("button", { name: "Confirm approve" }).click();
await approvalErrorPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
results.push(["mobile-design-approval-submit-error-mocked-dark.png", await snapshot(approvalErrorPage, "mobile-design-approval-submit-error-mocked-dark.png")]);
await approvalErrorPage.close();

const rejectionErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
rejectionErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
rejectionErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(rejectionErrorPage, { decisionStatus: 503 });
await rejectionErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await rejectionErrorPage.getByRole("button", { name: /^Runs/ }).click();
await rejectionErrorPage.waitForTimeout(250);
await rejectionErrorPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await rejectionErrorPage.waitForTimeout(150);
await rejectionErrorPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await rejectionErrorPage.waitForTimeout(700);
await rejectionErrorPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await rejectionErrorPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await rejectionErrorPage.getByRole("button", { name: "Confirm reject" }).click();
await rejectionErrorPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await rejectionErrorPage.getByRole("button", { name: "Confirm reject" }).waitFor({ timeout: 5000 });
await rejectionErrorPage.getByRole("button", { name: "Cancel" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-rejection-submit-error-mocked-dark.png", await snapshot(rejectionErrorPage, "mobile-design-rejection-submit-error-mocked-dark.png")]);
await rejectionErrorPage.close();

const approvalRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
approvalRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
approvalRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(approvalRetrySuccessPage, { decisionFailuresBeforeSuccess: 1 });
await approvalRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await approvalRetrySuccessPage.getByRole("button", { name: /^Runs/ }).click();
await approvalRetrySuccessPage.waitForTimeout(250);
await approvalRetrySuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await approvalRetrySuccessPage.waitForTimeout(150);
await approvalRetrySuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await approvalRetrySuccessPage.waitForTimeout(700);
await approvalRetrySuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await approvalRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await approvalRetrySuccessPage.getByRole("button", { name: "Confirm approve" }).click();
await approvalRetrySuccessPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await approvalRetrySuccessPage.getByRole("button", { name: "Confirm approve" }).click();
await approvalRetrySuccessPage.getByText("Decision submitted. Hub marked this checkpoint approved.").waitFor({ timeout: 5000 });
await approvalRetrySuccessPage.getByText("Checkpoint approved", { exact: true }).waitFor({ timeout: 5000 });
await approvalRetrySuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
if (await approvalRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).count()) {
  throw new Error("mobile-design-approval-submit-retry-success-mocked-dark.png: retry success should close the approval confirmation sheet");
}
results.push(["mobile-design-approval-submit-retry-success-mocked-dark.png", await snapshot(approvalRetrySuccessPage, "mobile-design-approval-submit-retry-success-mocked-dark.png")]);
await approvalRetrySuccessPage.close();

const approvalSuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
approvalSuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
approvalSuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(approvalSuccessPage);
await approvalSuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await approvalSuccessPage.getByRole("button", { name: /^Runs/ }).click();
await approvalSuccessPage.waitForTimeout(250);
await approvalSuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await approvalSuccessPage.waitForTimeout(150);
await approvalSuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await approvalSuccessPage.waitForTimeout(700);
await approvalSuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await approvalSuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await approvalSuccessPage.getByRole("button", { name: "Confirm approve" }).click();
await approvalSuccessPage.getByText("Decision submitted. Hub marked this checkpoint approved.").waitFor({ timeout: 5000 });
await approvalSuccessPage.getByText("Checkpoint approved", { exact: true }).waitFor({ timeout: 5000 });
await approvalSuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
await approvalSuccessPage.getByRole("button", { name: "Runs" }).waitFor({ timeout: 5000 });
if (await approvalSuccessPage.locator(".mobileApprovalPanel").getByRole("button", { name: /^Approve$/ }).count()) {
  throw new Error("Approval success state should replace the card approve button with a decision lock.");
}
if (await approvalSuccessPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("Approval success state should refresh the Runs badge after the review is resolved.");
}
results.push(["mobile-design-approval-submit-success-mocked-dark.png", await snapshot(approvalSuccessPage, "mobile-design-approval-submit-success-mocked-dark.png")]);
await approvalSuccessPage.getByRole("button", { name: "Back to queue" }).click();
await approvalSuccessPage.getByRole("heading", { name: "Runs" }).waitFor({ timeout: 5000 });
await approvalSuccessPage.getByRole("button", { name: /Review\s*0/ }).waitFor({ timeout: 5000 });
if (await approvalSuccessPage.getByText("Next review").count()) {
  throw new Error("Resolved approval should not leave a stale Next review shortcut in the queue.");
}
results.push(["mobile-design-runs-after-approval-return-mocked-dark.png", await snapshot(approvalSuccessPage, "mobile-design-runs-after-approval-return-mocked-dark.png")]);
await approvalSuccessPage.close();

const rejectionRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
rejectionRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
rejectionRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(rejectionRetrySuccessPage, { decisionFailuresBeforeSuccess: 1 });
await rejectionRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await rejectionRetrySuccessPage.getByRole("button", { name: /^Runs/ }).click();
await rejectionRetrySuccessPage.waitForTimeout(250);
await rejectionRetrySuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await rejectionRetrySuccessPage.waitForTimeout(150);
await rejectionRetrySuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await rejectionRetrySuccessPage.waitForTimeout(700);
await rejectionRetrySuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await rejectionRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await rejectionRetrySuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await rejectionRetrySuccessPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await rejectionRetrySuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await rejectionRetrySuccessPage.getByText("Decision submitted. Hub marked this checkpoint rejected.").waitFor({ timeout: 5000 });
await rejectionRetrySuccessPage.getByText("Checkpoint rejected", { exact: true }).waitFor({ timeout: 5000 });
await rejectionRetrySuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
if (await rejectionRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).count()) {
  throw new Error("mobile-design-rejection-submit-retry-success-mocked-dark.png: retry success should close the rejection confirmation sheet");
}
results.push(["mobile-design-rejection-submit-retry-success-mocked-dark.png", await snapshot(rejectionRetrySuccessPage, "mobile-design-rejection-submit-retry-success-mocked-dark.png")]);
await rejectionRetrySuccessPage.close();

const rejectionSuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
rejectionSuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
rejectionSuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(rejectionSuccessPage);
await rejectionSuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await rejectionSuccessPage.getByRole("button", { name: /^Runs/ }).click();
await rejectionSuccessPage.waitForTimeout(250);
await rejectionSuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await rejectionSuccessPage.waitForTimeout(150);
await rejectionSuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await rejectionSuccessPage.waitForTimeout(700);
await rejectionSuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await rejectionSuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await rejectionSuccessPage.getByText("Decision submitted. Hub marked this checkpoint rejected.").waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByText("Checkpoint rejected", { exact: true }).waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByRole("button", { name: "Runs" }).waitFor({ timeout: 5000 });
if (await rejectionSuccessPage.locator(".mobileApprovalPanel").getByRole("button", { name: /^Reject$/ }).count()) {
  throw new Error("Rejection success state should replace the card reject button with a decision lock.");
}
if (await rejectionSuccessPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("Rejection success state should refresh the Runs badge after the review is resolved.");
}
results.push(["mobile-design-rejection-submit-success-mocked-dark.png", await snapshot(rejectionSuccessPage, "mobile-design-rejection-submit-success-mocked-dark.png")]);
await rejectionSuccessPage.getByRole("button", { name: "Back to queue" }).click();
await rejectionSuccessPage.getByRole("heading", { name: "Runs" }).waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByRole("button", { name: /Review\s*0/ }).waitFor({ timeout: 5000 });
await rejectionSuccessPage.getByRole("button", { name: /Closed\s*2/ }).waitFor({ timeout: 5000 });
if (await rejectionSuccessPage.getByText("Next review").count()) {
  throw new Error("Resolved rejection should not leave a stale Next review shortcut in the queue.");
}
results.push(["mobile-design-runs-after-rejection-return-mocked-dark.png", await snapshot(rejectionSuccessPage, "mobile-design-runs-after-rejection-return-mocked-dark.png")]);
await rejectionSuccessPage.close();

await page.locator(".mobileRunSectionNav").getByRole("button", { name: "Outputs" }).click();
await page.waitForTimeout(450);
results.push(["mobile-design-run-section-nav-outputs-mocked-dark.png", await snapshot(page, "mobile-design-run-section-nav-outputs-mocked-dark.png")]);
await page.locator(".mobileRunBlocksPanel").scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
results.push(["mobile-design-run-blocks-mocked-dark.png", await snapshot(page, "mobile-design-run-blocks-mocked-dark.png")]);
results.push(["mobile-design-run-scroll-spy-blocks-mocked-dark.png", await snapshot(page, "mobile-design-run-scroll-spy-blocks-mocked-dark.png")]);
await page.locator(".mobileRunResourcesPanel").scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
results.push(["mobile-design-run-resources-mocked-dark.png", await snapshot(page, "mobile-design-run-resources-mocked-dark.png")]);
await page.locator(".mobileLogPanel").evaluate((element) => {
  const container = element.closest(".mobileScroll");
  if (!container) return;
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  container.scrollTop += elementRect.top - containerRect.top - 80;
});
await page.waitForTimeout(350);
results.push(["mobile-design-run-scroll-spy-logs-mocked-dark.png", await snapshot(page, "mobile-design-run-scroll-spy-logs-mocked-dark.png")]);
results.push(["mobile-design-run-logs-mocked-dark.png", await snapshot(page, "mobile-design-run-logs-mocked-dark.png")]);
await page.locator(".mobileLogFilterChip").filter({ hasText: "Error" }).click();
await page.waitForTimeout(150);
await page.locator(".mobileLogFrame").scrollIntoViewIfNeeded();
await page.waitForTimeout(150);
results.push(["mobile-design-run-logs-filter-error-mocked-dark.png", await snapshot(page, "mobile-design-run-logs-filter-error-mocked-dark.png")]);
await page.getByRole("button", { name: "Copy" }).first().click();
await page.waitForTimeout(150);
results.push(["mobile-design-resource-action-feedback-mocked-dark.png", await snapshot(page, "mobile-design-resource-action-feedback-mocked-dark.png")]);
await page.waitForTimeout(1900);
await page.getByRole("button", { name: /Inspect docs\/release\/gateway-mobile-review\.md/ }).click();
await page.waitForTimeout(150);
results.push(["mobile-design-resource-detail-sheet-mocked-dark.png", await snapshot(page, "mobile-design-resource-detail-sheet-mocked-dark.png")]);
await page.getByRole("dialog", { name: "Output resource details" }).getByRole("button", { name: "Copy path" }).click();
await page.getByRole("dialog", { name: "Output resource details" }).getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-resource-detail-copy-mocked-dark.png", await snapshot(page, "mobile-design-resource-detail-copy-mocked-dark.png")]);
await page.getByRole("button", { name: "Close resource details" }).click();

await page.getByRole("button", { name: /^Runs/ }).click();
await page.waitForTimeout(250);
results.push(["mobile-design-runs-tab-return-mocked-dark.png", await snapshot(page, "mobile-design-runs-tab-return-mocked-dark.png")]);
await page.getByText("Run run_mobi").click();
await page.waitForTimeout(500);
results.push(["mobile-design-after-run-detail-mocked-dark.png", await snapshot(page, "mobile-design-after-run-detail-mocked-dark.png")]);

await page.getByRole("button", { name: "Settings" }).click();
await page.waitForTimeout(250);
results.push(["mobile-design-after-settings-mocked-dark.png", await snapshot(page, "mobile-design-after-settings-mocked-dark.png")]);
results.push(["mobile-design-settings-readiness-mocked-dark.png", await snapshot(page, "mobile-design-settings-readiness-mocked-dark.png")]);
await page.getByRole("button", { name: "简体中文" }).click();
await page.getByRole("heading", { name: "设置" }).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "线程" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-settings-language-zh-mocked-dark.png", await snapshot(page, "mobile-design-settings-language-zh-mocked-dark.png")]);
await page.locator(".mobileBottomNav").getByRole("button", { name: /线程/ }).click();
await page.getByRole("heading", { name: "线程", exact: true }).waitFor({ timeout: 5000 });
results.push(["mobile-design-threads-zh-mocked-dark.png", await snapshot(page, "mobile-design-threads-zh-mocked-dark.png")]);
await page.locator(".mobileBottomNav").getByRole("button", { name: /运行/ }).click();
await page.getByRole("heading", { name: "运行", exact: true }).waitFor({ timeout: 5000 });
results.push(["mobile-design-runs-zh-mocked-dark.png", await snapshot(page, "mobile-design-runs-zh-mocked-dark.png")]);
await page.locator(".mobileBottomNav").getByRole("button", { name: "设置" }).click();
await page.getByRole("heading", { name: "设置", exact: true }).waitFor({ timeout: 5000 });
await page.getByRole("button", { name: "English" }).click();
await page.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 5000 });
await page.locator(".mobileSettingsReadinessTile").filter({ hasText: "Hub session" }).click();
await page.waitForTimeout(250);
if (!(await page.locator(".mobileSettingsReadinessTileActive").filter({ hasText: "Hub session" }).count())) {
  throw new Error("mobile-design-settings-readiness-tile-action-mocked-dark.png: Hub session readiness tile did not keep the active action anchor");
}
results.push(["mobile-design-settings-readiness-tile-action-mocked-dark.png", await snapshot(page, "mobile-design-settings-readiness-tile-action-mocked-dark.png")]);
await page.getByRole("button", { name: "Check session" }).click();
await page.waitForTimeout(250);
results.push(["mobile-design-settings-action-feedback-mocked-dark.png", await snapshot(page, "mobile-design-settings-action-feedback-mocked-dark.png")]);
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByRole("button", { name: "Retry sign in" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-settings-login-recovery-mocked-dark.png", await snapshot(page, "mobile-design-settings-login-recovery-mocked-dark.png")]);
await page.getByRole("button", { name: "Clear" }).click();
await page.getByRole("dialog", { name: "Confirm session clear" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-settings-clear-confirm-mocked-dark.png", await snapshot(page, "mobile-design-settings-clear-confirm-mocked-dark.png")]);
await page.getByRole("button", { name: "Confirm clear" }).click();
await page.getByRole("dialog", { name: "Confirm session clear" }).getByText("Native bridge is unavailable in browser preview.").waitFor({ timeout: 5000 });
results.push(["mobile-design-settings-clear-error-mocked-dark.png", await snapshot(page, "mobile-design-settings-clear-error-mocked-dark.png")]);
await page.getByRole("button", { name: "Cancel" }).click();

const compactSettingsPage = await browser.newPage({
  viewport: compactViewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
compactSettingsPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
compactSettingsPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(compactSettingsPage);
await compactSettingsPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await compactSettingsPage.getByRole("button", { name: "Settings" }).click();
await compactSettingsPage.waitForTimeout(250);
await compactSettingsPage.locator(".mobileSettingsReadinessTile").filter({ hasText: "Hub session" }).click();
await compactSettingsPage.waitForTimeout(450);
if (!(await compactSettingsPage.locator(".mobileSettingsReadinessTileActive").filter({ hasText: "Hub session" }).count())) {
  throw new Error("mobile-design-settings-compact-feedback-mocked-dark.png: Hub session readiness tile did not keep the active action anchor");
}
const statusVisibleOnCompactViewport = await compactSettingsPage.locator(".mobileStatusPanel").evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return rect.top >= 0 && rect.bottom <= window.innerHeight;
});
if (!statusVisibleOnCompactViewport) {
  throw new Error("mobile-design-settings-compact-feedback-mocked-dark.png: status panel is not visible after readiness tile action");
}
results.push(["mobile-design-settings-compact-feedback-mocked-dark.png", await snapshot(compactSettingsPage, "mobile-design-settings-compact-feedback-mocked-dark.png")]);
await compactSettingsPage.close();

const threadRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
threadRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
threadRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installRecoveryMockHub(threadRecoveryPage, "threads");
await threadRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await threadRecoveryPage.getByText("Threads could not sync").waitFor({ timeout: 5000 });
results.push(["mobile-design-threads-recovery-mocked-dark.png", await snapshot(threadRecoveryPage, "mobile-design-threads-recovery-mocked-dark.png")]);
await threadRecoveryPage.close();

const runsRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
runsRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
runsRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installRecoveryMockHub(runsRecoveryPage, "runs");
await runsRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await runsRecoveryPage.getByRole("button", { name: /^Runs/ }).click();
await runsRecoveryPage.getByText("Run queue could not sync").waitFor({ timeout: 5000 });
results.push(["mobile-design-runs-recovery-mocked-dark.png", await snapshot(runsRecoveryPage, "mobile-design-runs-recovery-mocked-dark.png")]);
await runsRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Settings" }).click();
await runsRecoveryPage.getByRole("heading", { name: "Settings" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-runs-recovery-settings-mocked-dark.png", await snapshot(runsRecoveryPage, "mobile-design-runs-recovery-settings-mocked-dark.png")]);
await runsRecoveryPage.close();

const lightThreadRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightThreadRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightThreadRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installRecoveryMockHub(lightThreadRecoveryPage, "threads");
await lightThreadRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightThreadRecoveryPage.getByText("Threads could not sync").waitFor({ timeout: 5000 });
await lightThreadRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Retry" }).waitFor({ timeout: 1000 });
await lightThreadRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Settings" }).waitFor({ timeout: 1000 });
results.push(["mobile-design-light-threads-recovery-mocked.png", await snapshot(lightThreadRecoveryPage, "mobile-design-light-threads-recovery-mocked.png")]);
await lightThreadRecoveryPage.close();

const lightRunsRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightRunsRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightRunsRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installRecoveryMockHub(lightRunsRecoveryPage, "runs");
await lightRunsRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightRunsRecoveryPage.getByRole("button", { name: /^Runs/ }).click();
await lightRunsRecoveryPage.getByText("Run queue could not sync").waitFor({ timeout: 5000 });
await lightRunsRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Retry" }).waitFor({ timeout: 1000 });
await lightRunsRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Settings" }).waitFor({ timeout: 1000 });
results.push(["mobile-design-light-runs-recovery-mocked.png", await snapshot(lightRunsRecoveryPage, "mobile-design-light-runs-recovery-mocked.png")]);
await lightRunsRecoveryPage.close();

const threadEmptyFilterPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
threadEmptyFilterPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
threadEmptyFilterPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(threadEmptyFilterPage, { threads: threads.filter((thread) => thread.status === "active") });
await threadEmptyFilterPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await threadEmptyFilterPage.getByRole("button", { name: /Archived/ }).click();
await threadEmptyFilterPage.getByText("No archived threads").waitFor({ timeout: 5000 });
results.push(["mobile-design-threads-empty-filter-mocked-dark.png", await snapshot(threadEmptyFilterPage, "mobile-design-threads-empty-filter-mocked-dark.png")]);
await threadEmptyFilterPage.close();

const runsEmptyFilterPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "dark",
});
runsEmptyFilterPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
runsEmptyFilterPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(runsEmptyFilterPage, { runs: runs.filter((run) => run.status !== "waiting_approval") });
await runsEmptyFilterPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await runsEmptyFilterPage.getByRole("button", { name: /^Runs/ }).click();
await runsEmptyFilterPage.getByText("Run run_mobi").waitFor({ timeout: 5000 });
await runsEmptyFilterPage.getByRole("button", { name: /Review\s*0/ }).click();
await runsEmptyFilterPage.getByText("No review runs").waitFor({ timeout: 5000 });
results.push(["mobile-design-runs-empty-filter-mocked-dark.png", await snapshot(runsEmptyFilterPage, "mobile-design-runs-empty-filter-mocked-dark.png")]);
await runsEmptyFilterPage.close();

const lightPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
await lightPage.context().grantPermissions(["clipboard-write"], { origin: new URL(baseUrl).origin });
lightPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightPage);
await lightPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
results.push(["mobile-design-light-threads-mocked.png", await snapshot(lightPage, "mobile-design-light-threads-mocked.png")]);
results.push(["mobile-design-light-threads-handoff-mocked.png", await snapshot(lightPage, "mobile-design-light-threads-handoff-mocked.png")]);
await lightPage.getByRole("button", { name: "Chat" }).click();
await lightPage.waitForTimeout(150);
results.push(["mobile-design-light-chat-empty-cta-mocked.png", await snapshot(lightPage, "mobile-design-light-chat-empty-cta-mocked.png")]);
await lightPage.getByRole("button", { name: "Browse threads" }).click();
await lightPage.waitForTimeout(150);
await lightPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await lightPage.waitForTimeout(250);
await lightPage.locator(".mobileActivityCard").first().scrollIntoViewIfNeeded();
await lightPage.waitForTimeout(150);
results.push(["mobile-design-light-chat-activity-cards-mocked.png", await snapshot(lightPage, "mobile-design-light-chat-activity-cards-mocked.png")]);
results.push(["mobile-design-light-chat-composer-scope-mocked.png", await snapshot(lightPage, "mobile-design-light-chat-composer-scope-mocked.png")]);
await lightPage.getByRole("button", { name: "Chat" }).click();
await lightPage.waitForTimeout(150);
results.push(["mobile-design-light-chat-tab-root-mocked.png", await snapshot(lightPage, "mobile-design-light-chat-tab-root-mocked.png")]);
await lightPage.getByRole("button", { name: "Settings" }).click();
await lightPage.waitForTimeout(250);
results.push(["mobile-design-light-settings-readiness-mocked.png", await snapshot(lightPage, "mobile-design-light-settings-readiness-mocked.png")]);
await lightPage.getByRole("button", { name: "Check session" }).click();
await lightPage.waitForTimeout(250);
results.push(["mobile-design-light-settings-action-feedback-mocked.png", await snapshot(lightPage, "mobile-design-light-settings-action-feedback-mocked.png")]);
await lightPage.getByRole("button", { name: "Sign in" }).click();
await lightPage.getByRole("button", { name: "Retry sign in" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-settings-login-recovery-mocked.png", await snapshot(lightPage, "mobile-design-light-settings-login-recovery-mocked.png")]);
await lightPage.getByRole("button", { name: "Clear" }).click();
await lightPage.getByRole("dialog", { name: "Confirm session clear" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-settings-clear-confirm-mocked.png", await snapshot(lightPage, "mobile-design-light-settings-clear-confirm-mocked.png")]);
await lightPage.getByRole("button", { name: "Confirm clear" }).click();
await lightPage.getByRole("dialog", { name: "Confirm session clear" }).getByText("Native bridge is unavailable in browser preview.").waitFor({ timeout: 5000 });
await lightPage.getByRole("button", { name: "Retry clear" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-settings-clear-error-mocked.png", await snapshot(lightPage, "mobile-design-light-settings-clear-error-mocked.png")]);
await lightPage.getByRole("button", { name: "Cancel" }).click();
await lightPage.getByRole("button", { name: /^Runs/ }).click();
await lightPage.waitForTimeout(500);
results.push(["mobile-design-light-runs-triage-mocked.png", await snapshot(lightPage, "mobile-design-light-runs-triage-mocked.png")]);
await lightPage.locator(".mobileSegmentButton").filter({ hasText: "Closed" }).click();
await lightPage.waitForTimeout(200);
results.push(["mobile-design-light-runs-filter-closed-mocked.png", await snapshot(lightPage, "mobile-design-light-runs-filter-closed-mocked.png")]);
await lightPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightPage.waitForTimeout(200);
await lightPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
  await lightPage.waitForTimeout(700);
  results.push(["mobile-design-light-run-summary-mocked.png", await snapshot(lightPage, "mobile-design-light-run-summary-mocked.png")]);
  results.push(["mobile-design-light-review-dock-mocked.png", await snapshot(lightPage, "mobile-design-light-review-dock-mocked.png")]);
  await lightPage.locator(".mobileRunBlocksPanel").scrollIntoViewIfNeeded();
  await lightPage.waitForTimeout(150);
  results.push(["mobile-design-light-run-blocks-mocked.png", await snapshot(lightPage, "mobile-design-light-run-blocks-mocked.png")]);
await lightPage.locator(".mobileRunResourcesPanel").scrollIntoViewIfNeeded();
await lightPage.waitForTimeout(150);
await lightPage.locator(".mobileRunResourcesPanel").getByRole("button", { name: "Copy" }).first().click();
await lightPage.waitForTimeout(150);
results.push(["mobile-design-light-resource-action-feedback-mocked.png", await snapshot(lightPage, "mobile-design-light-resource-action-feedback-mocked.png")]);
await lightPage.waitForTimeout(1900);
await lightPage.locator(".mobileRunResourcesPanel").getByRole("button", { name: /Inspect docs\/release\/gateway-mobile-review\.md/ }).click();
await lightPage.getByRole("dialog", { name: "Output resource details" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-resource-detail-sheet-mocked.png", await snapshot(lightPage, "mobile-design-light-resource-detail-sheet-mocked.png")]);
await lightPage.getByRole("dialog", { name: "Output resource details" }).getByRole("button", { name: "Copy path" }).click();
await lightPage.getByRole("dialog", { name: "Output resource details" }).getByRole("button", { name: "Copied" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-resource-detail-copy-mocked.png", await snapshot(lightPage, "mobile-design-light-resource-detail-copy-mocked.png")]);
await lightPage.getByRole("button", { name: "Close resource details" }).click();
await lightPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await lightPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-approval-confirm-sheet-mocked.png", await snapshot(lightPage, "mobile-design-light-approval-confirm-sheet-mocked.png")]);
await lightPage.getByRole("button", { name: "Cancel" }).click();
await lightPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await lightPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightPage.getByRole("button", { name: "Confirm approve" }).click();
await lightPage.getByText("Decision submitted. Hub marked this checkpoint approved.").waitFor({ timeout: 5000 });
await lightPage.getByText("Checkpoint approved", { exact: true }).waitFor({ timeout: 5000 });
await lightPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
await lightPage.getByRole("button", { name: "Runs" }).waitFor({ timeout: 5000 });
await lightPage.locator(".mobileApprovalPanel").scrollIntoViewIfNeeded();
await lightPage.waitForTimeout(150);
if (await lightPage.locator(".mobileApprovalPanel").getByRole("button", { name: /^Approve$/ }).count()) {
  throw new Error("mobile-design-light-approval-submit-success-mocked.png: light approval success should replace the card approve button with a decision lock");
}
if (await lightPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("mobile-design-light-approval-submit-success-mocked.png: light approval success should refresh the Runs badge after the review is resolved");
}
results.push(["mobile-design-light-approval-submit-success-mocked.png", await snapshot(lightPage, "mobile-design-light-approval-submit-success-mocked.png")]);
await lightPage.getByRole("button", { name: "Back to queue" }).click();
await lightPage.getByRole("heading", { name: "Runs" }).waitFor({ timeout: 5000 });
await lightPage.getByRole("button", { name: /Review\s*0/ }).waitFor({ timeout: 5000 });
if (await lightPage.getByText("Next review").count()) {
  throw new Error("mobile-design-light-runs-after-approval-return-mocked.png: resolved approval should not leave a stale Next review shortcut in the light queue");
}
if (await lightPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("mobile-design-light-runs-after-approval-return-mocked.png: resolved approval should clear the light queue pending review badge");
}
results.push(["mobile-design-light-runs-after-approval-return-mocked.png", await snapshot(lightPage, "mobile-design-light-runs-after-approval-return-mocked.png")]);
await lightPage.close();

const lightApprovalErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightApprovalErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightApprovalErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightApprovalErrorPage, { decisionStatus: 503 });
await lightApprovalErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightApprovalErrorPage.getByRole("button", { name: /^Runs/ }).click();
await lightApprovalErrorPage.waitForTimeout(250);
await lightApprovalErrorPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightApprovalErrorPage.waitForTimeout(150);
await lightApprovalErrorPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await lightApprovalErrorPage.waitForTimeout(700);
await lightApprovalErrorPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await lightApprovalErrorPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightApprovalErrorPage.getByRole("button", { name: "Confirm approve" }).click();
await lightApprovalErrorPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await lightApprovalErrorPage.getByRole("button", { name: "Confirm approve" }).waitFor({ timeout: 5000 });
await lightApprovalErrorPage.getByRole("button", { name: "Cancel" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-approval-submit-error-mocked.png", await snapshot(lightApprovalErrorPage, "mobile-design-light-approval-submit-error-mocked.png")]);
await lightApprovalErrorPage.close();

const lightRejectionErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightRejectionErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightRejectionErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightRejectionErrorPage, { decisionStatus: 503 });
await lightRejectionErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightRejectionErrorPage.getByRole("button", { name: /^Runs/ }).click();
await lightRejectionErrorPage.waitForTimeout(250);
await lightRejectionErrorPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightRejectionErrorPage.waitForTimeout(150);
await lightRejectionErrorPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await lightRejectionErrorPage.waitForTimeout(700);
await lightRejectionErrorPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await lightRejectionErrorPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightRejectionErrorPage.getByRole("button", { name: "Confirm reject" }).click();
await lightRejectionErrorPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await lightRejectionErrorPage.getByRole("button", { name: "Confirm reject" }).waitFor({ timeout: 5000 });
await lightRejectionErrorPage.getByRole("button", { name: "Cancel" }).waitFor({ timeout: 5000 });
results.push(["mobile-design-light-rejection-submit-error-mocked.png", await snapshot(lightRejectionErrorPage, "mobile-design-light-rejection-submit-error-mocked.png")]);
await lightRejectionErrorPage.close();

const lightApprovalRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightApprovalRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightApprovalRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightApprovalRetrySuccessPage, { decisionFailuresBeforeSuccess: 1 });
await lightApprovalRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightApprovalRetrySuccessPage.getByRole("button", { name: /^Runs/ }).click();
await lightApprovalRetrySuccessPage.waitForTimeout(250);
await lightApprovalRetrySuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightApprovalRetrySuccessPage.waitForTimeout(150);
await lightApprovalRetrySuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await lightApprovalRetrySuccessPage.waitForTimeout(700);
await lightApprovalRetrySuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Approve" }).click();
await lightApprovalRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightApprovalRetrySuccessPage.getByRole("button", { name: "Confirm approve" }).click();
await lightApprovalRetrySuccessPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await lightApprovalRetrySuccessPage.getByRole("button", { name: "Confirm approve" }).click();
await lightApprovalRetrySuccessPage.getByText("Decision submitted. Hub marked this checkpoint approved.").waitFor({ timeout: 5000 });
await lightApprovalRetrySuccessPage.getByText("Checkpoint approved", { exact: true }).waitFor({ timeout: 5000 });
await lightApprovalRetrySuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
if (await lightApprovalRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).count()) {
  throw new Error("mobile-design-light-approval-submit-retry-success-mocked.png: retry success should close the approval confirmation sheet");
}
results.push(["mobile-design-light-approval-submit-retry-success-mocked.png", await snapshot(lightApprovalRetrySuccessPage, "mobile-design-light-approval-submit-retry-success-mocked.png")]);
await lightApprovalRetrySuccessPage.close();

const lightRejectionRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightRejectionRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightRejectionRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightRejectionRetrySuccessPage, { decisionFailuresBeforeSuccess: 1 });
await lightRejectionRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightRejectionRetrySuccessPage.getByRole("button", { name: /^Runs/ }).click();
await lightRejectionRetrySuccessPage.waitForTimeout(250);
await lightRejectionRetrySuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightRejectionRetrySuccessPage.waitForTimeout(150);
await lightRejectionRetrySuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await lightRejectionRetrySuccessPage.waitForTimeout(700);
await lightRejectionRetrySuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await lightRejectionRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightRejectionRetrySuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await lightRejectionRetrySuccessPage.getByText("Decision was not submitted. Check Hub session and retry.").waitFor({ timeout: 5000 });
await lightRejectionRetrySuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await lightRejectionRetrySuccessPage.getByText("Decision submitted. Hub marked this checkpoint rejected.").waitFor({ timeout: 5000 });
await lightRejectionRetrySuccessPage.getByText("Checkpoint rejected", { exact: true }).waitFor({ timeout: 5000 });
await lightRejectionRetrySuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
if (await lightRejectionRetrySuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).count()) {
  throw new Error("mobile-design-light-rejection-submit-retry-success-mocked.png: retry success should close the rejection confirmation sheet");
}
results.push(["mobile-design-light-rejection-submit-retry-success-mocked.png", await snapshot(lightRejectionRetrySuccessPage, "mobile-design-light-rejection-submit-retry-success-mocked.png")]);
await lightRejectionRetrySuccessPage.close();

const lightRejectionSuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightRejectionSuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightRejectionSuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightRejectionSuccessPage);
await lightRejectionSuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightRejectionSuccessPage.getByRole("button", { name: /^Runs/ }).click();
await lightRejectionSuccessPage.waitForTimeout(250);
await lightRejectionSuccessPage.locator(".mobileSegmentButton").filter({ hasText: "Review" }).click();
await lightRejectionSuccessPage.waitForTimeout(150);
await lightRejectionSuccessPage.getByRole("button", { name: /Run run_gate.*Review/ }).click();
await lightRejectionSuccessPage.waitForTimeout(700);
await lightRejectionSuccessPage.locator(".mobileReviewDock").getByRole("button", { name: "Reject" }).click();
await lightRejectionSuccessPage.getByRole("dialog", { name: "Confirm approval decision" }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByRole("button", { name: "Confirm reject" }).click();
await lightRejectionSuccessPage.getByText("Decision submitted. Hub marked this checkpoint rejected.").waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByText("Checkpoint rejected", { exact: true }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByRole("button", { name: "Back to queue" }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByRole("button", { name: "Runs" }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.locator(".mobileApprovalPanel").scrollIntoViewIfNeeded();
await lightRejectionSuccessPage.waitForTimeout(150);
if (await lightRejectionSuccessPage.locator(".mobileApprovalPanel").getByRole("button", { name: /^Reject$/ }).count()) {
  throw new Error("mobile-design-light-rejection-submit-success-mocked.png: light rejection success should replace the card reject button with a decision lock");
}
if (await lightRejectionSuccessPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("mobile-design-light-rejection-submit-success-mocked.png: light rejection success should refresh the Runs badge after the review is resolved");
}
results.push(["mobile-design-light-rejection-submit-success-mocked.png", await snapshot(lightRejectionSuccessPage, "mobile-design-light-rejection-submit-success-mocked.png")]);
await lightRejectionSuccessPage.getByRole("button", { name: "Back to queue" }).click();
await lightRejectionSuccessPage.getByRole("heading", { name: "Runs" }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByRole("button", { name: /Review\s*0/ }).waitFor({ timeout: 5000 });
await lightRejectionSuccessPage.getByRole("button", { name: /Closed\s*2/ }).waitFor({ timeout: 5000 });
if (await lightRejectionSuccessPage.getByText("Next review").count()) {
  throw new Error("mobile-design-light-runs-after-rejection-return-mocked.png: resolved rejection should not leave a stale Next review shortcut in the light queue");
}
if (await lightRejectionSuccessPage.getByRole("button", { name: /^Runs, .*pending reviews/ }).count()) {
  throw new Error("mobile-design-light-runs-after-rejection-return-mocked.png: resolved rejection should clear the light queue pending review badge");
}
results.push(["mobile-design-light-runs-after-rejection-return-mocked.png", await snapshot(lightRejectionSuccessPage, "mobile-design-light-runs-after-rejection-return-mocked.png")]);
await lightRejectionSuccessPage.close();

const lightChatErrorPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightChatErrorPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightChatErrorPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightChatErrorPage, { messageStatus: 503 });
await lightChatErrorPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightChatErrorPage.getByRole("button", { name: "Chat" }).click();
await lightChatErrorPage.waitForTimeout(150);
await lightChatErrorPage.getByRole("button", { name: "Browse threads" }).click();
await lightChatErrorPage.waitForTimeout(150);
await lightChatErrorPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await lightChatErrorPage.waitForTimeout(250);
await lightChatErrorPage.getByRole("textbox", { name: "Mobile reply" }).fill("Retry this mobile handoff.");
await lightChatErrorPage.getByRole("button", { name: "Send mobile reply" }).click();
await lightChatErrorPage.getByText("Reply stayed in the composer.").waitFor({ timeout: 5000 });
await lightChatErrorPage.getByRole("button", { name: "Retry mobile reply" }).waitFor({ timeout: 5000 });
await lightChatErrorPage.getByText("Not sent").waitFor({ timeout: 1000 });
results.push(["mobile-design-light-chat-send-error-retry-mocked.png", await snapshot(lightChatErrorPage, "mobile-design-light-chat-send-error-retry-mocked.png")]);
await lightChatErrorPage.close();

const lightChatRetrySuccessPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightChatRetrySuccessPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightChatRetrySuccessPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightChatRetrySuccessPage, { messageFailuresBeforeSuccess: 1 });
await lightChatRetrySuccessPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightChatRetrySuccessPage.getByRole("button", { name: "Chat" }).click();
await lightChatRetrySuccessPage.waitForTimeout(150);
await lightChatRetrySuccessPage.getByRole("button", { name: "Browse threads" }).click();
await lightChatRetrySuccessPage.waitForTimeout(150);
await lightChatRetrySuccessPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await lightChatRetrySuccessPage.waitForTimeout(250);
await lightChatRetrySuccessPage.getByRole("textbox", { name: "Mobile reply" }).fill("Retry this mobile handoff.");
await lightChatRetrySuccessPage.getByRole("button", { name: "Send mobile reply" }).click();
await lightChatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).waitFor({ timeout: 5000 });
await lightChatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).click();
await lightChatRetrySuccessPage.getByText("Sent").waitFor({ timeout: 5000 });
if (await lightChatRetrySuccessPage.getByRole("button", { name: "Retry mobile reply" }).count()) {
  throw new Error("mobile-design-light-chat-send-retry-success-mocked.png: retry action should clear after the retried message succeeds");
}
results.push(["mobile-design-light-chat-send-retry-success-mocked.png", await snapshot(lightChatRetrySuccessPage, "mobile-design-light-chat-send-retry-success-mocked.png")]);
await lightChatRetrySuccessPage.close();

const lightChatRecoveryPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightChatRecoveryPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightChatRecoveryPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightChatRecoveryPage, { threadItemsStatus: 503 });
await lightChatRecoveryPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightChatRecoveryPage.getByRole("button", { name: "Chat" }).click();
await lightChatRecoveryPage.waitForTimeout(150);
await lightChatRecoveryPage.getByRole("button", { name: "Browse threads" }).click();
await lightChatRecoveryPage.waitForTimeout(150);
await lightChatRecoveryPage.getByRole("button", { name: /Review approval copy on mobile.*agenthub-mobile/ }).click();
await lightChatRecoveryPage.getByText("Messages could not sync").waitFor({ timeout: 5000 });
await lightChatRecoveryPage.getByText("Reply paused until timeline sync returns.").waitFor({ timeout: 1000 });
await lightChatRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Retry" }).waitFor({ timeout: 1000 });
await lightChatRecoveryPage.locator(".mobileRecoveryPanel").getByRole("button", { name: "Threads" }).waitFor({ timeout: 1000 });
if (await lightChatRecoveryPage.getByRole("button", { name: "Send mobile reply" }).count()) {
  throw new Error("mobile-design-light-chat-recovery-mocked.png: send action should be hidden while the thread timeline is unavailable");
}
results.push(["mobile-design-light-chat-recovery-mocked.png", await snapshot(lightChatRecoveryPage, "mobile-design-light-chat-recovery-mocked.png")]);
await lightChatRecoveryPage.close();

const lightThreadEmptyFilterPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightThreadEmptyFilterPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightThreadEmptyFilterPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightThreadEmptyFilterPage, { threads: threads.filter((thread) => thread.status === "active") });
await lightThreadEmptyFilterPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightThreadEmptyFilterPage.getByRole("button", { name: /Archived/ }).click();
await lightThreadEmptyFilterPage.getByText("No archived threads").waitFor({ timeout: 5000 });
results.push(["mobile-design-light-threads-empty-filter-mocked.png", await snapshot(lightThreadEmptyFilterPage, "mobile-design-light-threads-empty-filter-mocked.png")]);
await lightThreadEmptyFilterPage.close();

const lightRunsEmptyFilterPage = await browser.newPage({
  viewport,
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
  colorScheme: "light",
});
lightRunsEmptyFilterPage.on("console", (message) => {
  const text = message.text();
  if (!isExpectedConsoleMessage(text)) {
    consoleMessages.push(`${message.type()}: ${text}`);
  }
});
lightRunsEmptyFilterPage.on("pageerror", (error) => consoleMessages.push(`pageerror: ${error.message}`));
await installMockHub(lightRunsEmptyFilterPage, { runs: runs.filter((run) => run.status !== "waiting_approval") });
await lightRunsEmptyFilterPage.goto(baseUrl, { waitUntil: "networkidle", timeout: 20000 });
await lightRunsEmptyFilterPage.getByRole("button", { name: /^Runs/ }).click();
await lightRunsEmptyFilterPage.getByText("Run run_mobi").waitFor({ timeout: 5000 });
await lightRunsEmptyFilterPage.getByRole("button", { name: /Review\s*0/ }).click();
await lightRunsEmptyFilterPage.getByText("No review runs").waitFor({ timeout: 5000 });
results.push(["mobile-design-light-runs-empty-filter-mocked.png", await snapshot(lightRunsEmptyFilterPage, "mobile-design-light-runs-empty-filter-mocked.png")]);
await lightRunsEmptyFilterPage.close();

await browser.close();

for (const [fileName, metrics] of results) {
  assertMetrics(fileName, metrics);
}

if (consoleMessages.length > 0) {
  throw new Error(`Unexpected browser console output:\n${consoleMessages.join("\n")}`);
}

console.log(JSON.stringify({
  viewport,
  screenshots: results.map(([fileName, metrics]) => ({ fileName, ...metrics })),
}, null, 2));
