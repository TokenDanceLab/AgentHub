# Frontend Data Flow

> 子文档 | 主索引：[architecture.md](../architecture.md) · Hub API：[01-hub-server.md](01-hub-server.md) · 最后更新：2026-10-29

本文档只记录 Desktop/Web/Mobile 共享前端的数据流合同和 source owner。具体 hook、组件 props、测试用例数量以源码和测试为准，不在这里复制清单。

## 设计边界

前端分三层：`app shell（Desktop/Web） -> platform adapter -> @agenthub/workbench shell + shared assistant-ui conversation`。Hub/Edge 提供规范化消息，assistant-ui ExternalStoreRuntime 管理聊天交互。Mobile 默认是独立 RN fixture/边界验证 lane，不复用 DOM 聊天组件。仅当 `EXPO_PUBLIC_AGENTHUB_ACCOUNT_LOGIN_ENABLED=true` 且配置 Account issuer 时，才进入显式开启的真实登录验证路径。

规则：

- `app/workbench/`（`@agenthub/workbench`）拥有端级 workbench shell；`app/shared/` 拥有 transcript、composer、inspector 和 chatview 组件合同。依赖方向固定为 workbench → shared 单向。
- 通用组件放在 `app/shared/src/ui/`，Desktop/Web 从 shared 导入，不维护端内副本；组件样式使用 CSS Modules，并消费 `app/shared/src/styles/` 的 OKLCH/语义 token，避免组件级硬编码颜色。新 shared 组件的测试、stories 与验收要求见 [component-acceptance.md](../component-acceptance.md)。
- Desktop/Web/Mobile 只提供 platform adapter、认证、查询、runtime bridge 和壳层能力。
- Shared UI 不直接调用 Tauri invoke、Hub client 或 Edge client。
- Desktop renderer 不直接执行 CLI；本地执行走 Tauri host typed API、Local Edge 和 Edge adapter。
- Web/Mobile 只走 Hub-facing adapter；不能直连 Local Edge 或 raw runtime。
- Demo/mock/mode/debug 状态不进入 transcript bubbles；这些信息属于状态栏、设置、manifest 或测试报告。

## Platform Adapter Contract

```ts
interface AgentHubPlatform {
  surface: AgentHubSurface;           // "desktop" | "web" | "mobile"
  capabilities: SurfaceCapabilities;  // localEdge, localFiles, browserPreview...
  conversations: ConversationPort;
  runs: RunPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  settings?: SettingsPort;
}
```

完整接口（含 `messageActions`、`terminal`、`workspaceFiles`、`workspaceGit`、`checkpoint`、`agentActivity`）以 `app/shared/src/platform/types.ts` 为准；上面的片段只列常用成员。

Desktop adapter 负责 Local Edge、Hub REST/WS、Tauri file/dialog/window/keyring/notification、workspace allowlist 和 Account OIDC loopback callback。Web/Mobile adapters 负责 Hub session、Hub REST/WS、remote target routing、browser-safe preview 和 remote approval；Web 使用同源 HttpOnly cookie，Mobile 使用显式开启的 native Hub token 合同，均不持有 Account access/ID token。Mobile native capability proof 另走 Mobile gates。

Web 的认证权威是 `GET /client/auth/browser/session`，不是本地 token 或 profile。shared browser auth core 只在内存保留 profile 和 CSRF proof；启动时清除旧 access/refresh storage。REST 与 WebSocket 同源，unsafe REST 带 `X-Hub-CSRF`，不发送 Authorization 或 bearer subprotocol，不再轮换浏览器 refresh token。Desktop 的 native auth core 和 keyring 合同不变。

Web session generation 隔离异步请求：退出、`auth.revoked` 或当前代 401 清除 Query cache、运行/审批/附件 URL 状态；旧请求的迟到响应不能撤销新登录或重新写入上一身份的数据。503/网络故障不是登出。退出弹窗区分仅退出 AgentHub 与同时退出 Account；后者先撤销本地会话，再导航到服务端验证过的 Account end-session URL。TTL、cookie flags、CSRF 与撤销事务见 [06-auth-identity.md](06-auth-identity.md)。

Desktop 开发构建默认连接 loopback Hub。Packaged build 必须通过 `VITE_HUB_URL` / `VITE_HUB_WS_URL` 提供同一 Hub origin；未配置时使用 `example.invalid` fail-closed sentinel。发布时必须同步 packaging CSP 与 Rust proxy allowlist。Rust proxy 只接受该精确 origin（开发环境为 loopback Hub），不会把 Hub bearer 转发到任意公网 HTTPS 目标。

UI 可以根据 `capabilities` 隐藏或禁用动作，但不能 fork 另一套组件。

## Source Owner Map

| 责任 | Owner |
|---|---|
| Workbench shell / rail / inspector / routes | `app/workbench/src/` |
| Active conversation runtime and official Thread components | `app/shared/src/ui/assistant-ui/` |
| Read-only split transcript and remaining card consumers | `app/shared/src/chatview/` |
| Transcript block types, ordering, Hub/Edge normalization, evidence | `app/shared/src/transcript/` |
| Data mode compatibility contract | `app/shared/src/demo/dataMode.ts`, `app/shared/src/testing/e2eDataModeContract.ts` |
| Desktop app shell and adapter wiring | `app/desktop/src/App.tsx`, `app/desktop/src/platform/`, `app/desktop/src/api/` |
| Web/Mobile app shell and adapter wiring | `app/web/src/App.tsx`, `app/web/src/platform/`, `app/web/src/api/`, `app/mobile-rn/src/platform/`, `app/mobile-rn/src/api/` |
| Client E2E / contract gates | `app/desktop/src/__e2e__/chat-flow-ui.spec.ts`, `app/web/src/__e2e__/`, `app/mobile-rn/src/importBoundary.test.ts`, `app/mobile-rn/src/api/` |

## 工程列焦点合同

- 自动展开：active run 或新产物 evidence 可自动展开工程列；用户在运行中手动收回时按会话持久化抑制，切换会话恢复各自选择；无 active run/产物的纯聊天不改变布局默认。窄视口可延后自动展开以保留可恢复的聊天表面，头部按钮与键盘切换仍可用。
- Preview 焦点：工程列 `Preview` 标签跟随最新规范化 preview/artifact evidence，但不修改 `RightInspector` 当前详情标签；只有显式“在详情中查看 / View details”动作才请求 inspector 切换到 Browser 或 Files，避免快览与详情表面争焦点。
- 产物卡聚焦：Transcript 中携带真实 `artifactId` 的产物卡通过一次性的 `WORKBENCH_ENGINEERING_PREVIEW_FOCUS_EVENT` 请求工程列选择对应 artifact 并激活 `Preview`；事件携带 `conversationId`，工程列拒绝其他会话的 intent。该事件是瞬时 UI intent，不写入 transcript/store；artifact 不可解析时显示已有诚实不可用态，不回退到另一份最新产物。
- 表面边界：Desktop 可经 Local Edge 支持的 `PreviewPort` 解析产物内容，Web 保持 Hub-only；Hub 未提供安全 preview URL/content endpoint 时，Preview 必须诚实显示不可用，不构造 Local Edge URL。

## 全局状态栏合同

- `WorkbenchFrame` 将 `MainchainStatusStrip` 渲染为全局底部状态栏（shell 第 3 行、rail 右侧），所有 rail 页面可见；全局段 = 连接态 + 注意力 chips + usage chip（与 rail/sidebar 同源推导），会话段（证据链 + 导出）仅聊天页且 `showMainchainStatus` 开启时渲染。
- 诚实合同：无数据不渲染；作用域计数带标注；awaiting chip 在聊天页发一次性 `agenthub:approval-jump` 做 transcript 内高亮，其他页面先回聊天并选中首个等待会话。

## 会话目标横幅合同

- `deriveGoalSummary`（`workbenchGoalSummary.ts`）从 transcript 的 goal 工具调用（create/update goal）纯派生目标摘要：工具名词汇表是显式 SSOT，未知词汇/缺目标文本/创建失败一律 none（fail-closed，不渲染不猜测）。`ConversationHost` 仅在聊天页头部投影 `WorkbenchGoalBanner`（transcript 的投影，非新数据源）；停止入口仅在 `onCancelRun` 接入时渲染，无暂停按钮（Hub 无暂停通道）；状态芯片复用注意力模型色板。

## Transcript Pipeline

The visible chat flow is a single timeline:

```text
Hub / Edge / fixture / mock source
  -> TranscriptBlock[]
  -> order + normalize + filter diagnostics
  -> assistant-ui transcriptMessages projection
  -> ExternalStoreRuntime
  -> official Thread / Composer / Message / Markdown / Tool components
```

Stable behavior:

- User messages are optimistic and must appear immediately after submit; refetch, replay, or runtime events must not make them flash away.
- All sources are ordered by event time, then stable input order. User text, agent text, tool call/result, approval, subagent report, diff, artifact, deploy, context usage and preview stay in one linear transcript.
- Tool results join calls by call ID; matching tool names alone do not establish identity. Human authors remain human messages, including other participants.
- Runtime diagnostics and mock/mode/debug labels are filtered before rendering as chat bubbles. Markdown, code blocks and tables render inside shared bubble/card components, not as escaped plaintext.
- Auto-follow scrolls on first render, near-bottom updates, or a local user submit; user-initiated scrollback must not be forcibly overridden.

The platform query cache owns optimistic message insertion and server ID reconciliation. The view does not infer acknowledgements from matching text. assistant-ui owns composer text, attachments, submission recovery and scroll behavior; the shell retains only execution settings. Each conversation mounts its own runtime, and draft persistence subscribes to that runtime.

`MessageNotSentError` restores a failed send to the composer. If the message was stored but Agent dispatch failed, the platform returns `dispatchError` or `turnInProgress`; the UI retries only `redispatchTask` against the stored message ID. There is no background browser retry queue. An active run disables new sends while keeping the draft editable and the stop action available.

Production Web selects real data mode once at the root. Its model receives that value directly, and the existing auth state supplies the user profile; neither stale demo preferences nor a second profile request can change the authenticated data source.

The conversation sidebar uses the same assistant-ui thread-list primitives. Web creates private conversations with a contact or an owner-only group for an Agent conversation. Rename follows Hub owner permission; archive updates the current member's setting; delete removes the current user's membership, not other users' history. An empty-workspace placeholder has no mutation actions. Unsupported actions remain hidden.

Web history loads backward using `before_seq` and merges by server message ID and `client_msg_id`. Refresh keeps already loaded older pages, while confirmed server rows replace optimistic rows. Switching conversation remounts its chat runtime and restores its own draft; changing only the split layout preserves the host region. Native and Web share Markdown rendering for human and Agent messages.

## Realtime And Cache Flow

Hub realtime events follow this pattern:

```text
Hub WS event
  -> platform event bridge
  -> React Query invalidation or runtime event append
  -> transcript normalization
  -> shared renderer
```

Web live `AGENT_STREAM` transcript commits use a one-display-frame (16 ms) microbatch: every original event ID and sequence remains intact and ordered while React commits burst arrivals together. A non-stream frame, transport disconnect, conversation switch, or effect cleanup flushes pending stream events first. React Query invalidation is a separate 250 ms trailing window.

Desktop may also consume Local Edge EventStore / Run lifecycle events through the Desktop adapter. The UI layer only sees normalized transcript blocks and evidence refs.

## Settings And Profiles

Settings and agent profile data are surface-aware but render through shared UI:

- Desktop settings prefer Edge local settings, then Hub settings, then localStorage fallback.
- Agent profiles merge Edge local profiles, Hub shared profiles and raw adapter discovery, with local availability taking precedence for offline use.
- Web guarded Hub work must ask for auth instead of silently falling back to mock data.

## Data Mode And E2E Boundary

`dataMode` remains a compatibility field. It does not by itself prove data source, auth state or real execution. Tests and PR evidence must label all three axes:

| Axis | Meaning | Examples |
|---|---|---|
| Surface | Running shell | Desktop Vite, Web Vite, Desktop Tauri, Mobile RN Expo Web |
| Data Source | UI data source | `local-mock`, `deterministic-fixture`, `stubbed-hub-session`, `observed-hub-replay`, approved real source |
| Auth/Execution | Login/execution truth | anonymous, local-only, hub-signed-in, approved-real |

| Product mode | `dataMode` | Runtime boundary | Forbidden claim |
|---|---|---|---|
| Demo | `mock` | Workbench runtime does not access Hub/Edge; Desktop entry preflight may probe Local Edge health | real replay, real login, real execution |
| Fixture | `fixture` | No Hub/Edge runtime access | real replay, real user data |
| Local | `auto` / local target | Desktop may use `127.0.0.1:3210`; Web/Mobile must not | Hub login or cloud sync |
| Login/Hub | `auto` / Hub session | Account public OIDC through Hub; Web uses same-origin HttpOnly sessions, Desktop/native uses Hub HS256 tokens, Mobile requires the explicit login switch | Account token as Hub bearer, fixture evidence as real L3, or model spend |
| Observed | `observed` | Read-only replay/observation | new CLI/model/API execution |
| Approved Real | `approved-real` | Only explicitly approved Hub/Edge/CLI/API paths | silent fallback, stubbed real, packaged release |

Stubbed Hub, fixture, readiness-only and manifest-only outputs must set `real_tested=false`. Vite renderer evidence does not prove packaged Desktop sidecar, icon, installer, signing, updater or release upload.

## Acceptance Gates

| Claim | Minimum useful gate |
|---|---|
| Transcript ordering/grouping/markdown | Shared Vitest over `app/shared/src/transcript/` and `app/shared/src/chatview/` |
| Send visibility and auto-follow | Desktop/Web Playwright chat-flow specs; Mobile remains framework/boundary-only until dedicated Mobile UI work starts |
| Layout cleanliness | Visual QA gate: see [07-design-system-ssot.md](07-design-system-ssot.md) §7 |
| Data boundary | `app/shared/src/testing/e2eDataModeContract.ts` plus surface-specific E2E assertions |
| Packaged Desktop | Tauri package/sidecar/icon/installer evidence, not Vite-only |
| Real Account login | Real Account issuer + browser code exchange + Hub session; fixture/stubbed Hub remains `real_tested=false` |
