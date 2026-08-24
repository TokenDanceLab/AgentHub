/**
 * OPTIONAL / LEGACY — full multi-scene Web visual battery.
 *
 * This is NOT the P74 merge gate. Current gate matrix (1440×810 light+dark):
 *   app/web/scripts/visual-qa-shell.mjs   →  pnpm --filter agenthub-web visual:qa:shell
 *   app/desktop/scripts/visual-qa-shell.mjs
 * Score SSOT: visual-qa-scorecard (#1286)
 *
 * Scene names may still say 1440x920 for historical continuity of this battery only.
 * Do not treat those strings as the product gate viewport.
 */
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const baseUrl = process.env.WEB_QA_URL ?? "http://127.0.0.1:5174/";
const outDir = path.resolve("screenshots");
/** Legacy battery desktop viewport (historical). Gate uses 1440×810 via visual-qa-shell.mjs. */
const desktopViewport = { width: 1440, height: 920 };
const mobileViewport = { width: 390, height: 844 };
// Loopback-only: the legacy battery runs against the local dev stack; no
// production/remote hostnames belong in this repository (privacy red line).
const hubUrlPattern = /https?:\/\/(?:localhost:8080|127\.0\.0\.1:8080)\/.*/;

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
    target_preferences: JSON.stringify({ work_dir: "C:\\agenthub-workspace" }),
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
    id: "msg_code_block",
    session_id: "session_web_design",
    sender_id: "profile_codex",
    sender_type: "agent",
    content_type: "code",
    content: "export function glassSurface() {\n  return 'desktop-aligned';\n}",
    seq_id: 3,
    created_at: "2026-05-30T01:21:30Z",
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
    seq_id: 4,
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
    seq_id: 5,
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
    seq_id: 6,
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
    seq_id: 7,
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
    seq_id: 8,
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

async function installMockHub(context, { emptyAgents = false } = {}) {
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
      return route.fulfill(json(hubEnvelope(emptyAgents ? [] : sessions)));
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
    const rawKeyPattern = /\b(?:agent|welcome|prompt|webShell|settings|auth|im|notification|surface|mobile)\.[A-Za-z0-9_.-]+\b/;
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
    const agentRows = Array.from(document.querySelectorAll("[class*='agentRow']")).filter((row) =>
      row.className?.toString().split(/\s+/).some((className) => /agentRow_/.test(className))
    );
    const visibleAgentRows = agentRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedAgentRows = visibleAgentRows.filter((row) => {
      const directButton = Array.from(row.children).find((child) => child.tagName === "BUTTON");
      if (!directButton) return false;
      const directButtonStyle = window.getComputedStyle(directButton);
      const directSpanCount = Array.from(directButton.children).filter((child) => child.tagName === "SPAN").length;
      return directButtonStyle.display === "flex" && directSpanCount >= 2 && directButton.getAttribute("type") === "button";
    });
    const welcomeRuntimeEmptyBlocks = Array.from(document.querySelectorAll("[class*='emptyRuntime']")).filter((block) =>
      block.className?.toString().split(/\s+/).some((className) => /emptyRuntime_/.test(className))
    );
    const visibleWelcomeRuntimeEmptyBlocks = welcomeRuntimeEmptyBlocks.filter((block) => {
      const rect = block.getBoundingClientRect();
      const style = window.getComputedStyle(block);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedWelcomeRuntimeEmptyBlocks = visibleWelcomeRuntimeEmptyBlocks.filter((block) =>
      block.tagName === "SECTION" && block.getAttribute("aria-label")
    );
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
    const settingsModelAliasRows = Array.from(document.querySelectorAll("[class*='modelAliasRow']")).filter((row) =>
      row.className?.toString().split(/\s+/).some((className) => /modelAliasRow_/.test(className))
    );
    const visibleSettingsModelAliasRows = settingsModelAliasRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsModelAliasRows = visibleSettingsModelAliasRows.filter((row) => {
      const style = window.getComputedStyle(row);
      const directSpanCount = Array.from(row.children).filter((child) => child.tagName === "SPAN").length;
      const hasSharedBody = Array.from(row.children).some((child) => {
        const childStyle = window.getComputedStyle(child);
        return child.tagName === "SPAN" && childStyle.display === "grid";
      });
      return style.display === "grid" && directSpanCount >= 2 && hasSharedBody;
    });
    const settingsProviderRows = Array.from(document.querySelectorAll("[class*='providerRow']")).filter((row) =>
      row.className?.toString().split(/\s+/).some((className) => /providerRow_/.test(className))
    );
    const visibleSettingsProviderRows = settingsProviderRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsProviderRows = visibleSettingsProviderRows.filter((row) => {
      const style = window.getComputedStyle(row);
      const directSpanCount = Array.from(row.children).filter((child) => child.tagName === "SPAN").length;
      return style.display === "grid" && directSpanCount >= 3;
    });
    const settingsEmptyBlocks = Array.from(document.querySelectorAll("[class*='emptyBlock']")).filter((block) =>
      block.className?.toString().split(/\s+/).some((className) => /emptyBlock_/.test(className))
    );
    const visibleSettingsEmptyBlocks = settingsEmptyBlocks.filter((block) => {
      const rect = block.getBoundingClientRect();
      const style = window.getComputedStyle(block);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsEmptyBlocks = visibleSettingsEmptyBlocks.filter((block) =>
      block.tagName === "SECTION" && block.getAttribute("aria-label")
    );
    const settingsCallouts = Array.from(document.querySelectorAll("[class*='callout']")).filter((callout) =>
      callout.className?.toString().split(/\s+/).some((className) => /callout_/.test(className))
    );
    const visibleSettingsCallouts = settingsCallouts.filter((callout) => {
      const rect = callout.getBoundingClientRect();
      const style = window.getComputedStyle(callout);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedSettingsCallouts = visibleSettingsCallouts.filter((callout) => callout.getAttribute("role") === "status");
    const imMessageRows = Array.from(document.querySelectorAll("article[aria-label*='message from']"));
    const visibleImMessageRows = imMessageRows.filter((row) => {
      const rect = row.getBoundingClientRect();
      const style = window.getComputedStyle(row);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedImMessageRows = visibleImMessageRows.filter((row) => row.getAttribute("data-align") === "start" || row.getAttribute("data-align") === "end");
    const imAuthorityBandCount = Array.from(document.querySelectorAll("[class*='authorityBand']")).filter((band) => {
      const rect = band.getBoundingClientRect();
      const style = window.getComputedStyle(band);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }).length;
    const runDetailSections = Array.from(document.querySelectorAll("[class*='cardSection']")).filter((section) =>
      section.className?.toString().split(/\s+/).some((className) => /cardSection_/.test(className))
    );
    const visibleRunDetailSections = runDetailSections.filter((section) => {
      const rect = section.getBoundingClientRect();
      const style = window.getComputedStyle(section);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const sharedRunDetailSections = visibleRunDetailSections.filter((section) => {
      const style = window.getComputedStyle(section);
      const directSpanCount = Array.from(section.children).filter((child) => child.tagName === "SPAN").length;
      const hasBlockContent = Array.from(section.querySelectorAll("[class*='cardSectionContent']")).some((content) => content.tagName === "DIV");
      return section.tagName === "ARTICLE" && style.display === "grid" && directSpanCount >= 2 && hasBlockContent;
    });
    const notificationPanel = document.querySelector("[class*='dropdown'][role='menu']");
    const notificationPanelRect = notificationPanel?.getBoundingClientRect();
    const notificationEmptyBlocks = notificationPanel
      ? Array.from(notificationPanel.querySelectorAll("[class*='empty']")).filter((block) =>
          block.className?.toString().split(/\s+/).some((className) => /empty_/.test(className))
        )
      : [];
    const sharedNotificationEmptyBlocks = notificationEmptyBlocks.filter((block) =>
      block.tagName === "SECTION" && block.getAttribute("aria-label")
    );
    const notificationItems = notificationPanel
      ? Array.from(notificationPanel.querySelectorAll("[class*='itemCard']")).filter((item) =>
          item.className?.toString().split(/\s+/).some((className) => /itemCard_/.test(className))
        )
      : [];
    const sharedNotificationItems = notificationItems.filter((item) => {
      const style = window.getComputedStyle(item);
      const directSpanCount = Array.from(item.children).filter((child) => child.tagName === "SPAN").length;
      return item.tagName === "ARTICLE" && style.display === "grid" && directSpanCount >= 2;
    });
    const codeBlocks = Array.from(document.querySelectorAll("[class*='wrapper']")).filter((block) =>
      block.className?.toString().split(/\s+/).some((className) => /wrapper_/.test(className)) &&
      block.querySelector("[class*='copyBtn']")
    );
    const visibleCodeBlocks = codeBlocks.filter((block) => {
      const rect = block.getBoundingClientRect();
      const style = window.getComputedStyle(block);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const codeCopyButtons = visibleCodeBlocks
      .map((block) => block.querySelector("[class*='copyBtn']"))
      .filter(Boolean);
    const visibleCodeCopyButtons = codeCopyButtons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const style = window.getComputedStyle(button);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    });
    const codeCopyButtonRects = visibleCodeCopyButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.getAttribute("aria-label"),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    });
    const mentionPopover = document.querySelector("[role='listbox'][class*='popover']");
    const mentionPopoverRect = mentionPopover?.getBoundingClientRect();
    const mentionOptionButtons = mentionPopover
      ? Array.from(mentionPopover.querySelectorAll("button")).filter((button) => {
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        })
      : [];
    const mentionOptionButtonRects = mentionOptionButtons.map((button) => {
      const rect = button.getBoundingClientRect();
      return {
        label: button.textContent?.trim().replace(/\s+/g, " ").slice(0, 80),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
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
      visibleAgentRowCount: visibleAgentRows.length,
      sharedAgentRowCount: sharedAgentRows.length,
      visibleWelcomeRuntimeEmptyCount: visibleWelcomeRuntimeEmptyBlocks.length,
      sharedWelcomeRuntimeEmptyCount: sharedWelcomeRuntimeEmptyBlocks.length,
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
      visibleSettingsModelAliasRowCount: visibleSettingsModelAliasRows.length,
      sharedSettingsModelAliasRowCount: sharedSettingsModelAliasRows.length,
      visibleSettingsProviderRowCount: visibleSettingsProviderRows.length,
      sharedSettingsProviderRowCount: sharedSettingsProviderRows.length,
      visibleSettingsEmptyBlockCount: visibleSettingsEmptyBlocks.length,
      sharedSettingsEmptyBlockCount: sharedSettingsEmptyBlocks.length,
      visibleSettingsCalloutCount: visibleSettingsCallouts.length,
      sharedSettingsCalloutCount: sharedSettingsCallouts.length,
      visibleImMessageRowCount: visibleImMessageRows.length,
      sharedImMessageRowCount: sharedImMessageRows.length,
      imAuthorityBandCount,
      visibleRunDetailSectionCount: visibleRunDetailSections.length,
      sharedRunDetailSectionCount: sharedRunDetailSections.length,
      notificationPanel: notificationPanelRect
        ? {
            width: Math.round(notificationPanelRect.width),
            height: Math.round(notificationPanelRect.height),
          }
        : null,
      visibleNotificationEmptyCount: notificationEmptyBlocks.length,
      sharedNotificationEmptyCount: sharedNotificationEmptyBlocks.length,
      visibleNotificationItemCount: notificationItems.length,
      sharedNotificationItemCount: sharedNotificationItems.length,
      visibleCodeBlockCount: visibleCodeBlocks.length,
      visibleCodeCopyButtonCount: visibleCodeCopyButtons.length,
      codeCopyButtonRects,
      mentionPopover: mentionPopoverRect
        ? {
            left: Math.round(mentionPopoverRect.left),
            right: Math.round(mentionPopoverRect.right),
            width: Math.round(mentionPopoverRect.width),
            height: Math.round(mentionPopoverRect.height),
          }
        : null,
      visibleMentionOptionCount: mentionOptionButtons.length,
      mentionOptionButtonRects,
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
    await page.getByText("desktop-aligned").waitFor({ state: "visible", timeout: 5000 });
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
    await page.getByText("Which Agent should run today?").waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("No runtimes available").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("region", { name: "No Runtime adapters detected" }).waitFor({ state: "visible", timeout: 5000 });
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
  if (scene.openSettingsModelMapping) {
    await page.getByRole("button", { name: /^Model Mapping$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^Model Mapping$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Model aliases", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='modelAliasRow']").first().waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openSettingsCcSwitch) {
    await page.getByRole("button", { name: /^cc-switch$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^cc-switch$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Provider list", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='providerRow']").first().waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openSettingsArchived) {
    await page.getByRole("button", { name: /^Archived Chats$/ }).first().click();
    await page.locator("h1").filter({ hasText: /^Archived Chats$/ }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("No archived chats", { exact: true }).waitFor({ state: "visible", timeout: 5000 });
    await page.locator("[class*='emptyBlock']").first().waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openIMConversation) {
    await page.locator("[role='option']").filter({ hasText: "Web design convergence" }).click();
    await page.getByText("Keep Web and Mobile aligned with the Desktop glass shell.").waitFor({ state: "visible", timeout: 5000 });
    await page.getByText("Visual QA covers account nav, run overlay, settings, and legacy route bridges.").waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("textbox", { name: "Message input" }).waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openNotifications) {
    await page.getByRole("button", { name: "Notifications", exact: true }).click();
    await page.getByRole("menu", { name: "Notifications panel" }).waitFor({ state: "visible", timeout: 5000 });
    await page.getByRole("region", { name: "No notifications yet" }).waitFor({ state: "visible", timeout: 5000 });
  }
  if (scene.openMentionPopover) {
    const prompt = page.getByPlaceholder("Type a message, @Agent to mention...");
    await prompt.waitFor({ state: "visible", timeout: 5000 });
    await prompt.fill("@");
    const listbox = page.getByRole("listbox", { name: "Agent suggestions" });
    await listbox.waitFor({ state: "visible", timeout: 5000 });
    await listbox.getByRole("button", { name: /Codex/i }).waitFor({ state: "visible", timeout: 5000 });
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
  if (scene.verifyAgentRows) {
    assert(metrics.visibleAgentRowCount >= 2, `${scene.name}: agent runtime list should render visible rows`, metrics);
    assert(metrics.sharedAgentRowCount >= 2, `${scene.name}: agent runtime rows should use shared SelectableRow structure`, metrics);
  }
  if (scene.emptyAgents) {
    assert(metrics.visibleWelcomeRuntimeEmptyCount >= 1, `${scene.name}: welcome runtime empty state should be visible`, metrics);
    assert(metrics.sharedWelcomeRuntimeEmptyCount >= 1, `${scene.name}: welcome runtime empty state should use shared EmptyState structure`, metrics);
  }
  if (scene.openRunWithToolCall) {
    assert(metrics.visibleRunDetailSectionCount >= 3, `${scene.name}: run detail should render output/tool/file sections`, metrics);
    assert(metrics.sharedRunDetailSectionCount >= 3, `${scene.name}: run detail sections should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSearch) {
    assert(metrics.searchDialog, `${scene.name}: search dialog should be visible`, metrics);
    assert(metrics.visibleSearchResultButtonCount >= 1, `${scene.name}: search results should render as selectable rows`, metrics);
  }
  if (scene.selectThread) {
    assert(metrics.visibleCodeBlockCount >= 1, `${scene.name}: code messages should render through CodeBlock`, metrics);
    assert(metrics.visibleCodeCopyButtonCount >= 1, `${scene.name}: code blocks should expose a copy button`, metrics);
    if (scene.mobile) {
      assert(
        metrics.codeCopyButtonRects.every((button) => button.width >= 44 && button.height >= 44),
        `${scene.name}: code copy buttons must be 44px mobile targets`,
        metrics.codeCopyButtonRects,
      );
    }
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
  if (scene.openSettingsModelMapping) {
    assert(metrics.visibleSettingsModelAliasRowCount >= 3, `${scene.name}: model mapping should render alias rows`, metrics);
    assert(metrics.sharedSettingsModelAliasRowCount >= 3, `${scene.name}: model alias rows should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsCcSwitch) {
    assert(metrics.visibleSettingsProviderRowCount >= 3, `${scene.name}: cc-switch should render provider rows`, metrics);
    assert(metrics.sharedSettingsProviderRowCount >= 3, `${scene.name}: provider rows should use shared ActivityCard grid structure`, metrics);
  }
  if (scene.openSettingsArchived) {
    assert(metrics.visibleSettingsEmptyBlockCount >= 1, `${scene.name}: archived settings should render an empty state`, metrics);
    assert(metrics.sharedSettingsEmptyBlockCount >= 1, `${scene.name}: settings empty block should use shared EmptyState structure`, metrics);
  }
  if (scene.openIMConversation) {
    assert(metrics.visibleImMessageRowCount >= 2, `${scene.name}: IM conversation should render visible message rows`, metrics);
    assert(metrics.sharedImMessageRowCount >= 2, `${scene.name}: IM message rows should use shared MessageBubble structure`, metrics);
    assert(metrics.imAuthorityBandCount === 0, `${scene.name}: IM authority must not render left color bands`, metrics);
  }
  if (scene.openNotifications) {
    assert(metrics.notificationPanel, `${scene.name}: notifications panel should be visible`, metrics);
    assert(metrics.visibleNotificationEmptyCount >= 1, `${scene.name}: notifications panel should render an empty state`, metrics);
    assert(metrics.sharedNotificationEmptyCount >= 1, `${scene.name}: notification empty state should use shared EmptyState structure`, metrics);
  }
  if (scene.openMentionPopover) {
    assert(metrics.mentionPopover, `${scene.name}: mention popover should be visible`, metrics);
    assert(metrics.mentionPopover.left >= 0, `${scene.name}: mention popover should not overflow left`, metrics.mentionPopover);
    assert(metrics.mentionPopover.right <= metrics.innerWidth, `${scene.name}: mention popover should not overflow right`, metrics.mentionPopover);
    assert(metrics.visibleMentionOptionCount >= 1, `${scene.name}: mention popover should render agent options`, metrics);
    if (scene.mobile) {
      assert(
        metrics.mentionOptionButtonRects.every((button) => button.width >= 44 && button.height >= 44),
        `${scene.name}: mention option buttons must be 44px mobile targets`,
        metrics.mentionOptionButtonRects,
      );
    }
  }
  if (scene.expectSettingsCallout) {
    assert(metrics.visibleSettingsCalloutCount >= 1, `${scene.name}: settings should render guard callouts`, metrics);
    assert(metrics.sharedSettingsCalloutCount >= 1, `${scene.name}: settings callouts should use shared StatusNotice structure`, metrics);
  }

  return { screenshotPath, metrics };
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  const scenes = [
    {
      name: "web-design-workspace-desktop-1440x920",
      path: "/",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      verifyAgentRows: true,
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
      name: "web-design-mention-popover-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
      openMentionPopover: true,
    },
    {
      name: "web-design-codeblock-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
      selectThread: true,
    },
    {
      name: "web-design-notifications-mobile-390x844",
      path: "/",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
      openNotifications: true,
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
      name: "web-design-messages-conversation-mobile-390x844",
      path: "/chats",
      viewport: mobileViewport,
      mobile: true,
      authenticated: true,
      language: "en",
      theme: "dark",
      openIMConversation: true,
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
      expectSettingsCallout: true,
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
      name: "web-design-settings-model-mapping-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsModelMapping: true,
    },
    {
      name: "web-design-settings-cc-switch-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsCcSwitch: true,
    },
    {
      name: "web-design-settings-archived-empty-desktop-1440x920",
      path: "/settings",
      viewport: desktopViewport,
      authenticated: true,
      language: "en",
      theme: "dark",
      openSettingsArchived: true,
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
      const context = await browser.newContext({
        viewport: scene.viewport,
        serviceWorkers: "block",
      });
      await installMockHub(context, { emptyAgents: scene.emptyAgents });
      const page = await context.newPage();
      await page.setViewportSize(scene.viewport);
      await visitAndCapture(page, scene);
      await page.close();
      await context.close();
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
