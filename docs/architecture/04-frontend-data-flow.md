# Frontend Data Flow

> 子文档 | 主索引：[architecture.md](../architecture.md)
>
> 最后更新：2026-07-27

本文档只记录 Desktop/Web/Mobile 共享前端的数据流合同和 source owner。具体 hook、组件 props、测试用例数量以源码和测试为准，不在这里复制清单。

## 设计边界

前端分三层：

```text
Desktop/Web/Mobile app shell
  -> platform adapter
  -> @agenthub/workbench shell + app/shared chatview
  -> transcript normalizer + renderer
```

规则：

- `app/workbench/`（`@agenthub/workbench`）拥有端级 workbench shell；`app/shared/` 拥有 transcript、composer、inspector 和 chatview 组件合同。依赖方向固定为 workbench → shared 单向（#1759）。
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

Desktop adapter 负责 Local Edge、Hub REST/WS、Tauri file/dialog/window/keyring/notification、workspace allowlist 和 TokenDance ID loopback callback。Web/Mobile adapters 负责 Hub session、Hub REST/WS、remote target routing、browser-safe preview 和 remote approval；Mobile native capability proof 另走 Mobile gates。

UI 可以根据 `capabilities` 隐藏或禁用动作，但不能 fork 另一套组件。

## Source Owner Map

| 责任 | Owner |
|---|---|
| Workbench shell / rail / inspector / routes | `app/workbench/src/` |
| Chat transcript renderer | `app/shared/src/chatview/` |
| Transcript block types, ordering, Hub/Edge normalization, evidence | `app/shared/src/transcript/` |
| Data mode compatibility contract | `app/shared/src/demo/dataMode.ts`, `app/shared/src/testing/e2eDataModeContract.ts` |
| Desktop app shell and adapter wiring | `app/desktop/src/App.tsx`, `app/desktop/src/platform/`, `app/desktop/src/api/` |
| Web/Mobile app shell and adapter wiring | `app/web/src/App.tsx`, `app/web/src/platform/`, `app/web/src/api/`, `app/mobile-rn/src/platform/`, `app/mobile-rn/src/api/` |
| Client lane E2E/contract gates | `app/desktop/src/__e2e__/chat-flow-ui.spec.ts`, `app/web/src/__e2e__/`, `app/mobile-rn/src/importBoundary.test.ts`, `app/mobile-rn/src/api/` |

Do not add per-hook inventory tables here. If a file moves, update this owner map and the nearest README/source test, not a duplicate implementation checklist.

## Transcript Pipeline

The visible chat flow is a single timeline:

```text
Hub / Edge / fixture / mock source
  -> TranscriptBlock[]
  -> order + normalize + filter diagnostics
  -> ChatViewBridge
  -> ChatViewTranscript
  -> blocksToTranscriptItems
  -> TranscriptItem[]
  -> UserMessage / AgentGroup / RowItem
```

Stable behavior:

- User messages are optimistic and must appear immediately after submit; refetch, replay, or runtime events must not make them flash away.
- All sources are ordered by event time, then stable input order. User text, agent text, tool call/result, approval, subagent report, diff, artifact, deploy, context usage and preview stay in one linear transcript.
- Adjacent agent blocks from the same author are grouped by shared chatview adapter. Tool result replaces its matching tool call when a call id or tool name matches.
- Runtime diagnostics and mock/mode/debug labels are filtered before rendering as chat bubbles. Markdown, code blocks and tables render inside shared bubble/card components, not as escaped plaintext.
- Auto-follow scrolls on first render, near-bottom updates, or a local user submit; user-initiated scrollback must not be forcibly overridden.

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
| Login/Hub | `auto` / Hub session | Desktop/Web/Mobile use Hub; real login needs Hub session evidence | TokenDance API key or model spend |
| Observed | `observed` | Read-only replay/observation | new CLI/model/API execution |
| Approved Real | `approved-real` | Only explicitly approved Hub/Edge/CLI/API paths | silent fallback, stubbed real, packaged release |

Stubbed Hub, fixture, readiness-only and manifest-only outputs must set `real_tested=false`. Vite renderer evidence does not prove packaged Desktop sidecar, icon, installer, signing, updater or release upload.

## Acceptance Gates

| Claim | Minimum useful gate |
|---|---|
| Transcript ordering/grouping/markdown | Shared Vitest over `app/shared/src/transcript/` and `app/shared/src/chatview/` |
| Send visibility and auto-follow | Desktop/Web Playwright chat-flow specs; Mobile remains framework/boundary-only until a dedicated UI slice |
| Layout cleanliness | Desktop/Web Visual QA gate at 16:9 `1440x810` light+dark via `visual-qa-shell.mjs` / `visual:qa:shell` （scorecard 已外迁，见 `docs/history.md`）; check overflow and final-message visibility |
| Data boundary | `app/shared/src/testing/e2eDataModeContract.ts` plus surface-specific E2E assertions |
| Packaged Desktop | Tauri package/sidecar/icon/installer evidence, not Vite-only |

## Related Docs

- [architecture.md](../architecture.md) — system overview and non-negotiable boundaries
- [01-hub-server.md](01-hub-server.md) — Hub API and realtime ownership

## 前端 CI 易踩坑（站立规则）

- `exactOptionalPropertyTypes`：禁 `...{ optional: maybeUndefined }`，defined 时赋值；async handler 传 `() => void` 用 `void fn()` 包装。`noUncheckedIndexedAccess`：CSS module / `Record<string,string>` 索引用 `styles.foo ?? ''`。
- CSS helper 参数类型用 `Record<string,string>`，不要 `Pick<typeof styles,'a'|'b'>`（与 `CSSModuleClasses` 不兼容）。Nav 图标只用 `DesignNavIcon`（见 `DesignNavIconName`）；禁散落 nav glyph。
- 11px (0.6875rem) 为 CJK 最小可读字号；badge/chip 用此值，正文标签 ≥12px。CI 统一 `changes` job（`dorny/paths-filter@v4`，Go-only 跳前端、CSS-only 跳 Go；`scripts/verify/verify-ci-gates.py` 校验）。
