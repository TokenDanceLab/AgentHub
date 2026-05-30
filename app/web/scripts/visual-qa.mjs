import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.WEB_QA_URL ?? "http://127.0.0.1:5175/";
const outDir = path.resolve("screenshots");
const desktopViewport = { width: 1440, height: 920 };
const mobileViewport = { width: 390, height: 844 };
const hubUrlPattern = /https?:\/\/(?:localhost:8080|127\.0\.0\.1:8080|hub\.vectorcontrol\.tech|api\.hub\.vectorcontrol\.tech)\/.*/;

const agentProfiles = [
  {
    id: "profile_codex",
    name: "Codex",
    description: "Desktop-aligned coding profile for Web visual QA",
    runtime_id: "codex",
    provider: "openai",
    model: "gpt-5",
    reasoning_effort: "medium",
    permission_mode: "approval",
    tool_allowlist: JSON.stringify(["shell", "apply_patch"]),
    mcp_servers: JSON.stringify(["filesystem"]),
    target_preferences: JSON.stringify({ work_dir: "D:\\Code\\TokenDance\\AgentHub" }),
    version: 12,
  },
  {
    id: "profile_claude",
    name: "Claude Code",
    description: "Remote review profile used to keep shell cards filled",
    runtime_id: "claude-code",
    provider: "anthropic",
    model: "claude-sonnet",
    reasoning_effort: "high",
    permission_mode: "review",
    tool_allowlist: JSON.stringify(["read", "diff"]),
    mcp_servers: JSON.stringify([]),
    target_preferences: JSON.stringify({ target: "remote-edge" }),
    version: 7,
  },
];

const sessions = [
  {
    session_id: "session_web_design",
    type: "group",
    name: "Web design convergence",
    owner_user_id: "user_visual",
    created_at: "2026-05-30T01:10:00Z",
    updated_at: "2026-05-30T01:30:00Z",
  },
  {
    session_id: "session_mobile_handoff",
    type: "group",
    name: "Mobile handoff evidence",
    owner_user_id: "user_visual",
    created_at: "2026-05-29T23:40:00Z",
    updated_at: "2026-05-30T00:12:00Z",
  },
];

const contacts = [
  {
    user_id: "user_sonnet",
    username: "sonnet-ui",
    nickname: "Sonnet UI",
    avatar_url: "",
    online: true,
    type: "agent",
  },
  {
    user_id: "user_hub",
    username: "hub-review",
    nickname: "Hub Review",
    avatar_url: "",
    online: false,
    type: "human",
  },
];

const messages = [
  {
    id: "msg_1",
    session_id: "session_web_design",
    sender_id: "user_visual",
    sender_type: "user",
    content_type: "text",
    content: "Keep Web and Mobile aligned with the Desktop glass shell.",
    seq_id: 1,
    created_at: "2026-05-30T01:20:00Z",
  },
  {
    id: "msg_2",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "text",
    content: "Visual QA covers account nav, run overlay, settings, and legacy route bridges.",
    seq_id: 2,
    created_at: "2026-05-30T01:21:00Z",
  },
  {
    id: "msg_session_init",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "json",
    content: JSON.stringify({
      event_type: "run.agent.session_init",
      payload: {
        model: "gpt-5",
        tools: ["Read", "Edit", "Bash"],
        permissionMode: "approval",
      },
    }),
    seq_id: 3,
    created_at: "2026-05-30T01:22:00Z",
  },
  {
    id: "msg_result",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "json",
    content: JSON.stringify({
      success: true,
      tokenUsage: { input: 1420, output: 318 },
    }),
    seq_id: 4,
    created_at: "2026-05-30T01:23:00Z",
  },
  {
    id: "msg_tool_call",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "json",
    content: JSON.stringify({
      callId: "call_visual_shell",
      toolName: "Bash",
      input: { command: "pnpm visual:qa" },
      status: "running",
    }),
    seq_id: 5,
    created_at: "2026-05-30T01:24:00Z",
  },
  {
    id: "msg_tool_result",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "json",
    content: JSON.stringify({
      callId: "call_visual_shell",
      toolName: "Bash",
      output: "Web visual QA passed (10 scenes)",
      status: "completed",
    }),
    seq_id: 6,
    created_at: "2026-05-30T01:25:00Z",
  },
  {
    id: "msg_file_change",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "json",
    content: JSON.stringify({
      path: "app/web/src/components/ChatView.tsx",
      action: "modified",
      diff: [
        "@@ shared preview @@",
        "- <details className={styles.fileCard}>",
        "+ <CodePreviewCard title={block.path} code={block.diff} />",
      ].join("\n"),
    }),
    seq_id: 7,
    created_at: "2026-05-30T01:26:00Z",
  },
];

function hubEnvelope(data) {
  return {
    code: "OK",
    data,
    message: "",
  };
}

function json(data) {
  return {
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(data),
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "authorization,content-type",
      "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    },
  };
}

async function installMockHub(context) {
  await context.route(hubUrlPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = url.pathname;

    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: json({}).headers });
    }

    if (pathname.endsWith("/health")) {
      return route.fulfill(json({
        status: "ok",
        version: "web-visual-qa",
        uptime: "2h",
        checks: { database: "ok", redis: "ok" },
      }));
    }

    if (pathname === "/web/agent-profiles") {
      const emptyAgents = request.headers()["x-agenthub-visual-empty-agents"] === "1";
      return route.fulfill(json(hubEnvelope({
        items: emptyAgents ? [] : agentProfiles,
        page: { hasMore: false },
      })));
    }

    if (pathname === "/client/auth/me") {
      return route.fulfill(json(hubEnvelope({
        id: "user_visual",
        username: "visual-reviewer",
        nickname: "Visual Reviewer",
        avatar_url: "",
      })));
    }

    if (pathname === "/client/sessions") {
      return route.fulfill(json(hubEnvelope(sessions)));
    }

    if (pathname === "/client/contacts") {
      return route.fulfill(json(hubEnvelope(contacts)));
    }

    if (pathname === "/client/notifications") {
      return route.fulfill(json(hubEnvelope([])));
    }

    if (pathname.match(/^\/client\/sessions\/[^/]+\/messages$/)) {
      return route.fulfill(json(hubEnvelope(messages)));
    }

    if (pathname.match(/^\/client\/sessions\/[^/]+\/pins$/)) {
      return route.fulfill(json(hubEnvelope([])));
    }

    if (pathname === "/web/agent-tasks") {
      return route.fulfill(json(hubEnvelope({
        id: "task_web_visual",
        session_id: "session_web_design",
        agent_profile_id: "profile_codex",
        status: "running",
        created_at: "2026-05-30T01:26:00Z",
      })));
    }

    if (pathname.match(/^\/web\/agent-tasks\/[^/]+\/events$/)) {
      return route.fulfill(json(hubEnvelope([
        {
          id: "event_1",
          task_id: "task_web_visual",
          type: "message",
          role: "assistant",
          content: "Web run detail stays inside the same Desktop-aligned shell.",
          created_at: "2026-05-30T01:27:00Z",
        },
      ])));
    }

    if (pathname === "/web/execution-targets") {
      return route.fulfill(json(hubEnvelope({
        items: [
          {
            id: "target_local_edge",
            name: "Local Edge",
            kind: "local",
            status: "online",
            updated_at: "2026-05-30T01:25:00Z",
          },
        ],
        page: { hasMore: false },
      })));
    }

    return route.fulfill(json(hubEnvelope({})));
  });
}

async function preparePage(page, { authenticated = false, language = "en", theme = "dark", emptyAgents = false } = {}) {
  await page.setExtraHTTPHeaders(emptyAgents ? { "x-agenthub-visual-empty-agents": "1" } : {});
  await page.addInitScript(({ authenticated: isAuthenticated, language: lang, theme: selectedTheme }) => {
    window.localStorage.setItem("agenthub-language", lang);
    window.localStorage.setItem("agenthub-theme", selectedTheme);
    window.localStorage.setItem("agenthub_hub_url", "http://localhost:8080");
    if (isAuthenticated) {
      window.sessionStorage.setItem("agenthub_hub_token", "visual-qa-token");
      window.sessionStorage.setItem("agenthub_hub_user", JSON.stringify({
        userId: "user_visual",
        username: "visual-reviewer",
      }));
    } else {
      window.sessionStorage.removeItem("agenthub_hub_token");
      window.sessionStorage.removeItem("agenthub_hub_user");
    }
  }, { authenticated, language, theme });
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details === undefined ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`${message}${suffix}`);
  }
}

async function collectMetrics(page, { mobile = false } = {}) {
  return page.evaluate(({ mobile: isMobile }) => {
    const rawKeyPattern = /\b(?:agent|welcome|prompt|webShell|settings|auth|im|surface|mobile)\.[A-Za-z0-9_.-]+\b/;
    const all = Array.from(document.querySelectorAll("*"));
    const visible = all.filter((el) => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    });

    const controls = Array.from(document.querySelectorAll("button,a,input,select,textarea,[role='button'],[role='tab']"));
    const smallTargets = isMobile
      ? controls
          .map((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const label = el.getAttribute("aria-label") || el.textContent?.trim().replace(/\s+/g, " ").slice(0, 80) || el.tagName.toLowerCase();
            return { label, width: Math.round(rect.width), height: Math.round(rect.height), display: style.display, visibility: style.visibility };
          })
          .filter((item) => item.width > 0 && item.height > 0 && item.display !== "none" && item.visibility !== "hidden")
          .filter((item) => item.width < 44 || item.height < 44)
      : [];

    const gradientElements = visible
      .filter((el) => {
        const style = window.getComputedStyle(el);
        return /(?:linear|radial|conic)-gradient/i.test(`${style.backgroundImage} ${style.background}`);
      })
      .map((el) => el.className?.toString() || el.tagName.toLowerCase())
      .slice(0, 20);

    const leftOnlyBorderElements = visible
      .filter((el) => {
        const style = window.getComputedStyle(el);
        const left = parseFloat(style.borderLeftWidth) || 0;
        const right = parseFloat(style.borderRightWidth) || 0;
        const top = parseFloat(style.borderTopWidth) || 0;
        const bottom = parseFloat(style.borderBottomWidth) || 0;
        return left >= 2 && right === 0 && top === 0 && bottom === 0 && style.borderLeftStyle !== "none";
      })
      .map((el) => el.className?.toString() || el.tagName.toLowerCase())
      .slice(0, 20);

    const leftInsetShadowElements = visible
      .filter((el) => /inset\s+[1-9]\d*px\s+0\s+0/i.test(window.getComputedStyle(el).boxShadow))
      .map((el) => el.className?.toString() || el.tagName.toLowerCase())
      .slice(0, 20);

    const rawI18nKeys = Array.from(new Set((document.body.innerText.match(new RegExp(rawKeyPattern, "g")) || []))).slice(0, 20);
    const mobileSurfaceNav = Array.from(document.querySelectorAll("nav")).find((nav) => {
      const labels = Array.from(nav.querySelectorAll("button span")).map((el) => el.textContent?.trim()).filter(Boolean);
      return labels.length === 4 && (labels.includes("Run") || labels.includes("运行"));
    });
    const navLabels = Array.from((mobileSurfaceNav || document).querySelectorAll("button span"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    const topbarAccountButtonCount = Array.from(document.querySelectorAll("header button"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      })
      .filter((el) => /Sign in|Account|登录|账号/.test(el.textContent || ""))
      .length;
    const mobileNavButtons = Array.from((mobileSurfaceNav || document).querySelectorAll("button"));
    const mobileAccountButton = mobileNavButtons[3];
    const mobileAccountAria = mobileAccountButton?.getAttribute("aria-label") || "";
    const mobileAccountNavIndex = /Account|账号|visual-reviewer/.test(`${navLabels[3] ?? ""} ${mobileAccountAria}`) ? 3 : -1;
    const modal = document.querySelector("[class*='modalLayer']");
    const authSheet = modal?.querySelector("[class*='page']");
    const authRect = authSheet?.getBoundingClientRect();
    const authStyle = authSheet ? window.getComputedStyle(authSheet) : null;
    const authBrandLogo = authSheet?.querySelector("img[alt='TokenDance']");
    const identityIcon = authSheet?.querySelector("button img[aria-hidden='true']");
    const shellBrandLogo = document.querySelector("header img[class*='brandMark']");
    const shellBrandFallbackText = Array.from(document.querySelectorAll("header [class*='brandMark']"))
      .map((el) => el.textContent?.trim())
      .filter(Boolean);
    const threadButtons = Array.from(document.querySelectorAll("button[aria-label='Web design convergence'], button[aria-label='Mobile handoff evidence']"));
    const visibleThreadButtons = threadButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const nestedThreadActionButtons = threadButtons
      .map((button) => button.querySelectorAll("button").length)
      .reduce((sum, count) => sum + count, 0);
    const searchDialog = Array.from(document.querySelectorAll("[class*='dialog']")).find((el) => {
      const text = el.textContent || "";
      return text.includes("Search messages") || text.includes("Desktop glass shell");
    });
    const searchDialogRect = searchDialog?.getBoundingClientRect();
    const searchResultButtons = Array.from(document.querySelectorAll("button[aria-label*='Desktop glass shell'], button[aria-label*='Visual QA covers']"));
    const visibleSearchResultButtons = searchResultButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const settingsAccountCards = Array.from(document.querySelectorAll("[class*='summaryCard'], [class*='capabilityCard']"));
    const visibleSettingsAccountCards = settingsAccountCards.filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsAccountCards = visibleSettingsAccountCards.filter((card) => {
      const style = window.getComputedStyle(card);
      const hasSharedBody = Array.from(card.children).some((child) => {
        const childStyle = window.getComputedStyle(child);
        return child.tagName === "SPAN" && childStyle.display === "grid";
      });
      return style.display === "grid" && hasSharedBody;
    });
    const settingsTaskRows = Array.from(document.querySelectorAll("[class*='taskRow']")).filter((row) =>
      row.className?.toString().split(/\s+/).some((className) => /taskRow_/.test(className))
    );
    const visibleSettingsTaskRows = settingsTaskRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsTaskRows = visibleSettingsTaskRows.filter((row) => {
      const style = window.getComputedStyle(row);
      const directSpanCount = Array.from(row.children).filter((child) => child.tagName === "SPAN").length;
      return style.display === "grid" && directSpanCount >= 3;
    });
    const settingsProfileCards = Array.from(document.querySelectorAll("[class*='profileCard']")).filter((card) =>
      card.className?.toString().split(/\s+/).some((className) => /profileCard_/.test(className))
    );
    const visibleSettingsProfileCards = settingsProfileCards.filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsProfileCards = visibleSettingsProfileCards.filter((card) => {
      const style = window.getComputedStyle(card);
      const directSpanCount = Array.from(card.children).filter((child) => child.tagName === "SPAN").length;
      return style.display === "grid" && directSpanCount >= 3;
    });
    const settingsTargetCards = Array.from(document.querySelectorAll("[class*='targetCard']")).filter((card) =>
      card.className?.toString().split(/\s+/).some((className) => /targetCard_/.test(className))
    );
    const visibleSettingsTargetCards = settingsTargetCards.filter((card) => {
      const rect = card.getBoundingClientRect();
      const style = window.getComputedStyle(card);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsTargetCards = visibleSettingsTargetCards.filter((card) => {
      const style = window.getComputedStyle(card);
      const directSpanCount = Array.from(card.children).filter((child) => child.tagName === "SPAN").length;
      return style.display === "grid" && directSpanCount >= 3;
    });
    const settingsConnectionRows = Array.from(document.querySelectorAll("[class*='connectionRow']")).filter((row) =>
      row.className?.toString().split(/\s+/).some((className) => /connectionRow_/.test(className))
    );
    const visibleSettingsConnectionRows = settingsConnectionRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsConnectionRows = visibleSettingsConnectionRows.filter((row) => {
      const style = window.getComputedStyle(row);
      const directSpanCount = Array.from(row.children).filter((child) => child.tagName === "SPAN").length;
      return style.display === "grid" && directSpanCount >= 3;
    });

    return {
      title: document.title,
      url: window.location.href,
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
      gradientCount: gradientElements.length,
      gradientElements,
      leftOnlyBorderCount: leftOnlyBorderElements.length,
      leftOnlyBorderElements,
      leftInsetShadowCount: leftInsetShadowElements.length,
      leftInsetShadowElements,
      smallTargets,
      rawI18nKeys,
      navLabels,
      topbarAccountButtonCount,
      mobileAccountNavIndex,
      shellBrandLogo: !!shellBrandLogo,
      shellBrandFallbackText,
      threadRowButtonCount: threadButtons.length,
      visibleThreadRowButtonCount: visibleThreadButtons.length,
      nestedThreadActionButtons,
      searchDialog: searchDialogRect
        ? {
            width: Math.round(searchDialogRect.width),
            height: Math.round(searchDialogRect.height),
          }
        : null,
      visibleSearchResultButtonCount: visibleSearchResultButtons.length,
      visibleSettingsAccountCardCount: visibleSettingsAccountCards.length,
      sharedSettingsAccountCardCount: sharedSettingsAccountCards.length,
      visibleSettingsTaskRowCount: visibleSettingsTaskRows.length,
      sharedSettingsTaskRowCount: sharedSettingsTaskRows.length,
      visibleSettingsProfileCardCount: visibleSettingsProfileCards.length,
      sharedSettingsProfileCardCount: sharedSettingsProfileCards.length,
      visibleSettingsTargetCardCount: visibleSettingsTargetCards.length,
      sharedSettingsTargetCardCount: sharedSettingsTargetCards.length,
      visibleSettingsConnectionRowCount: visibleSettingsConnectionRows.length,
      sharedSettingsConnectionRowCount: sharedSettingsConnectionRows.length,
      authSheet: authRect && authStyle
        ? {
            width: Math.round(authRect.width),
            bottom: Math.round(window.innerHeight - authRect.bottom),
            topRadius: authStyle.borderTopLeftRadius,
            background: authStyle.backgroundColor,
            backdropFilter: authStyle.backdropFilter || authStyle.webkitBackdropFilter,
            brandLogo: !!authBrandLogo,
            identityIcon: !!identityIcon,
          }
        : null,
    };
  }, { mobile });
}

function assertMetrics(name, metrics, { mobile = false, accountSheet = false } = {}) {
  assert(metrics.scrollWidth <= metrics.innerWidth, `${name}: horizontal overflow`, metrics);
  assert(metrics.bodyScrollWidth <= metrics.innerWidth, `${name}: body horizontal overflow`, metrics);
  assert(metrics.gradientCount === 0, `${name}: gradient surfaces are forbidden`, metrics.gradientElements);
  assert(metrics.leftOnlyBorderCount === 0, `${name}: left-only border rails are forbidden`, metrics.leftOnlyBorderElements);
  assert(metrics.leftInsetShadowCount === 0, `${name}: inset left rails are forbidden`, metrics.leftInsetShadowElements);
  assert(metrics.rawI18nKeys.length === 0, `${name}: raw i18n keys are visible`, metrics.rawI18nKeys);
  assert(metrics.shellBrandLogo === true, `${name}: shell must use TokenDance brand image`, metrics);
  assert(metrics.shellBrandFallbackText.length === 0, `${name}: shell brand text fallback is forbidden`, metrics.shellBrandFallbackText);
  if (mobile) {
    assert(metrics.smallTargets.length === 0, `${name}: mobile controls below 44px`, metrics.smallTargets);
    assert(metrics.mobileAccountNavIndex === 3, `${name}: Account must be the rightmost mobile nav item`, metrics.navLabels);
    assert(metrics.topbarAccountButtonCount === 0, `${name}: topbar account button should be hidden on mobile`, metrics);
  }
  if (accountSheet) {
    assert(metrics.authSheet, `${name}: account sheet did not open`, metrics);
    assert(metrics.authSheet.width === metrics.innerWidth, `${name}: account sheet should fill mobile width`, metrics.authSheet);
    assert(metrics.authSheet.bottom === 0, `${name}: account sheet should dock to the bottom`, metrics.authSheet);
    assert(metrics.authSheet.backdropFilter !== "none", `${name}: account sheet should keep glass blur`, metrics.authSheet);
    assert(metrics.authSheet.brandLogo === true, `${name}: TokenDance brand logo should render`, metrics.authSheet);
    assert(metrics.authSheet.identityIcon === true, `${name}: identity action should render TokenDance icon`, metrics.authSheet);
  }
}

async function visitAndCapture(page, scene) {
  const url = new URL(scene.path, baseUrl).toString();
  const consoleIssues = [];
  const onConsole = (message) => {
    if (["warning", "error"].includes(message.type())) {
      const text = message.text();
      if (
        !/Download the React DevTools/i.test(text) &&
        !/WebSocket connection to 'ws:\/\/localhost:8080\/client\/ws\?access_token=visual-qa-token' failed/i.test(text)
      ) {
        consoleIssues.push({ type: message.type(), text });
      }
    }
  };

  page.on("console", onConsole);
  await preparePage(page, scene);
  await page.goto(url, { waitUntil: "networkidle" });

  if (scene.openRun) {
    await page.locator("nav button[aria-label='Open run detail']").click();
    await page.getByRole("region", { name: "Run Detail" }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("No active run").waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openAccount) {
    await page.getByRole("button", { name: /Account|Sign in/ }).click();
    await page.waitForTimeout(250);
  }
  if (scene.selectThread) {
    const targetThread = page.getByRole("button", { name: /Web design convergence/i });
    if ((await targetThread.count()) > 0) {
      await targetThread.first().click();
    }
    await page.getByText("Session initialized — gpt-5").waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Completed — 1420 in / 318 out tokens").waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.verifyThreadRows) {
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("button[aria-label='Web design convergence'], button[aria-label='Mobile handoff evidence']"));
      return buttons.filter((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      }).length === 2;
    }, undefined, { timeout: 5000 });
  }
  if (scene.openRunWithToolCall) {
    const targetThread = page.getByRole("button", { name: /Web design convergence/i });
    if ((await targetThread.count()) > 0) {
      await targetThread.first().click();
    }
    const openRunDetail = page.getByRole("button", { name: "Open run detail" });
    if ((await openRunDetail.count()) > 0) {
      await openRunDetail.first().click();
    }
    await page.getByRole("complementary", { name: "Run Detail" }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("1% of 200.0K context used").waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("1.4K", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("318", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("1.7K", { exact: true }).first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: /Bash completed/i }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("button", { name: /Bash completed/i }).click();
    await page.getByText("Web visual QA passed (10 scenes)").waitFor({ state: "visible", timeout: 5000 });
    const chatLog = page.getByRole("log");
    const chatFilePreview = chatLog.getByText("app/web/src/components/ChatView.tsx");
    await chatFilePreview.waitFor({ state: "visible", timeout: 5000 });
    await chatLog.getByText("+ <CodePreviewCard title={block.path} code={block.diff} />").waitFor({ state: "visible", timeout: 5000 });
    await chatFilePreview.scrollIntoViewIfNeeded();
  }
  if (scene.openSearch) {
    await page.keyboard.press(process.platform === "darwin" ? "Meta+KeyK" : "Control+KeyK");
    await page.getByPlaceholder("Search messages...").waitFor({ state: "visible", timeout: 5000 });
    await page.getByPlaceholder("Search messages...").fill("Desktop glass");
    await page.waitForFunction(() => {
      const buttons = Array.from(document.querySelectorAll("button[aria-label*='Desktop glass shell'], button[aria-label*='Visual QA covers']"));
      return buttons.some((button) => {
        const rect = button.getBoundingClientRect();
        const style = window.getComputedStyle(button);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    }, undefined, { timeout: 5000 });
  }
  if (scene.emptyAgents) {
    await page.getByText("No runtimes available").waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openSettingsAccount) {
    await page.getByRole("button", { name: /Account|账号/ }).first().click();
    await page.locator("h1").filter({ hasText: /Account|账号/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("TokenDance ID", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='summaryCard'], [class*='capabilityCard']").first().waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openSettingsTasks) {
    await page.getByRole("button", { name: /^Tasks$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^Tasks$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Recent runs", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    const firstRunRow = page.getByText("run_1", { exact: true });
    await firstRunRow.waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='taskRow']").first().waitFor({ state: "visible", timeout: 5000 });
    await firstRunRow.scrollIntoViewIfNeeded();
  }
  if (scene.openSettingsSkills) {
    await page.getByRole("button", { name: /Skill Management/ }).first().click();
    await page.locator("h1").filter({ hasText: /Skill Management/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("adapter-dev", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='profileCard']").first().waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("adapter-dev", { exact: true }).scrollIntoViewIfNeeded();
  }
  if (scene.openSettingsTargets) {
    await page.getByRole("button", { name: /^Execution Targets$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^Execution Targets$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='targetCard']").first().waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openSettingsConnections) {
    await page.getByRole("button", { name: /^Connections$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^Connections$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("WebSocket", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='connectionRow']").first().waitFor({ state: "visible", timeout: 5000 });
  }

  const screenshotPath = path.join(outDir, `${scene.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });
  const metrics = await collectMetrics(page, { mobile: scene.mobile });
  await writeFile(path.join(outDir, `${scene.name}.probe.json`), JSON.stringify({ ...metrics, consoleIssues }, null, 2));
  page.off("console", onConsole);

  assert(consoleIssues.length === 0, `${scene.name}: unexpected console warnings/errors`, consoleIssues);
  assertMetrics(scene.name, metrics, {
    mobile: scene.mobile,
    accountSheet: scene.openAccount,
  });
  if (scene.verifyThreadRows) {
    assert(metrics.visibleThreadRowButtonCount === 2, `${scene.name}: shared thread rows should expose two visible selectable buttons`, metrics);
    assert(metrics.nestedThreadActionButtons === 0, `${scene.name}: thread row actions must not nest buttons inside the selectable row`, metrics);
  }
  if (scene.openSearch) {
    assert(metrics.searchDialog, `${scene.name}: search dialog should be visible`, metrics);
    assert(metrics.visibleSearchResultButtonCount >= 1, `${scene.name}: search results should render as selectable rows`, metrics);
  }
  if (scene.openSettingsAccount) {
    assert(metrics.visibleSettingsAccountCardCount >= 8, `${scene.name}: account settings should render dense summary/capability cards`, metrics);
    assert(metrics.sharedSettingsAccountCardCount >= 8, `${scene.name}: account settings cards should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsTasks) {
    assert(metrics.visibleSettingsTaskRowCount >= 3, `${scene.name}: tasks settings should render recent run rows`, metrics);
    assert(metrics.sharedSettingsTaskRowCount >= 3, `${scene.name}: task rows should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsSkills) {
    assert(metrics.visibleSettingsProfileCardCount >= 7, `${scene.name}: skill settings should render installed skill cards`, metrics);
    assert(metrics.sharedSettingsProfileCardCount >= 7, `${scene.name}: skill profile cards should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsTargets) {
    assert(metrics.visibleSettingsTargetCardCount >= 4, `${scene.name}: execution target settings should render route cards`, metrics);
    assert(metrics.sharedSettingsTargetCardCount >= 4, `${scene.name}: execution target cards should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsConnections) {
    assert(metrics.visibleSettingsConnectionRowCount >= 3, `${scene.name}: connections settings should render status rows`, metrics);
    assert(metrics.sharedSettingsConnectionRowCount >= 3, `${scene.name}: connection rows should use shared ActivityCard grid structure`, metrics);
  }

  return { screenshotPath, metrics };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: desktopViewport,
    serviceWorkers: "block",
  });
  await installMockHub(context);

  const scenes = [
    {
      name: "web-design-workspace-desktop-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
    },
    {
      name: "web-design-workspace-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
    },
    {
      name: "web-design-messages-mobile-390x844",
      path: "/chats",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
    },
    {
      name: "web-design-workspace-desktop-status-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      selectThread: true,
    },
    {
      name: "web-design-thread-sidebar-desktop-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      verifyThreadRows: true,
    },
    {
      name: "web-design-search-dialog-desktop-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSearch: true,
    },
    {
      name: "web-design-run-detail-tool-call-desktop-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openRunWithToolCall: true,
    },
    {
      name: "web-design-workspace-desktop-empty-agents-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      emptyAgents: true,
    },
    {
      name: "web-design-settings-mobile-zh-390x844",
      path: "/settings",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "zh",
      theme: "dark",
    },
    {
      name: "web-design-settings-account-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsAccount: true,
    },
    {
      name: "web-design-settings-tasks-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsTasks: true,
    },
    {
      name: "web-design-settings-skills-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsSkills: true,
    },
    {
      name: "web-design-settings-targets-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsTargets: true,
    },
    {
      name: "web-design-settings-connections-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsConnections: true,
    },
    {
      name: "web-design-run-overlay-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
      openRun: true,
    },
    {
      name: "web-design-account-sheet-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: false,
      language: "en",
      theme: "dark",
      openAccount: true,
    },
    {
      name: "web-design-agent-square-mobile-390x844",
      path: "/agent-square",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
    },
    {
      name: "web-design-project-mobile-light-390x844",
      path: "/project/agenthub-mobile",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "light",
    },
  ];

  try {
    for (const scene of scenes) {
      const page = await context.newPage();
      await page.setViewportSize(scene.viewport);
      await visitAndCapture(page, scene);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(`Web visual QA passed (${scenes.length} scenes). Screenshots: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
