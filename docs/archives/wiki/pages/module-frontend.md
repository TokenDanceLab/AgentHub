---
id: module-frontend
title: 前端模块总览
type: module
status: active
updated: 2026-07-16
sources:
  - AGENTS.md
  - docs/architecture.md
  - docs/architecture/04-frontend-data-flow.md
  - docs/decisions.md
  - docs/governance/security-risk-register.md
tags:
  - frontend
  - shared-workbench
  - transcript
  - mobile-rn
  - desktop-web-duplication
  - cleanup
related:
  - module-shared-workbench
  - module-desktop
  - module-web
  - module-hub-server
  - module-edge-server
  - architecture-seams
  - flow-control-event
  - risk-evid-grade-confusion
summary: >
  前端三平台（Desktop/Web/Mobile RN）共享 workbench/transcript/composer/inspector 合同；
  桌面走 Local Edge，Web 走 Hub-only，Mobile 主线 Expo+RN；
  平台差异收口 adapter 层，禁止 fork 组件。
---

# 前端模块总览

AgentHub 前端是一个三平台（Desktop/Web/Mobile RN）共享的 IM 形态多 Agent 协作工作台。三个平台共享 `app/shared/` 中的 workbench、transcript、composer 和 inspector 合同；各平台只提供 adapter、认证、查询、runtime bridge 和壳层能力。

## 平台分层

```text
Desktop shell (Tauri)               Web shell (Vite)              Mobile RN (Expo)
  └─ platform adapter (localEdge)     └─ platform adapter (hub)     └─ platform adapter (hub)
       └─ app/shared/ workbench             └─ app/shared/ workbench      └─ app/shared/ workbench
            ├─ transcript normalizer              ├─ transcript normalizer       ├─ transcript normalizer
            └─ chatview renderer                  └─ chatview renderer           └─ chatview renderer
```

规则：
- `app/shared/` 拥有 workbench、transcript、composer、inspector 和 chatview 组件合同。
- Desktop/Web/Mobile 只提供 platform adapter、认证、查询、runtime bridge 和壳层能力。
- Shared UI 不直接调用 Tauri invoke、Hub client 或 Edge client。
- 平台能力差异通过 `AgentHubPlatform.capabilities` 控制 UI 可见性，禁止 fork 另一套组件。

## Platform Adapter Contract

```ts
interface AgentHubPlatform {
  surface: "desktop" | "web" | "mobile";
  capabilities: SurfaceCapabilities;
  conversations: ConversationPort;
  runs: RunPort;
  attachments?: AttachmentPort;
  host?: HostDiagnosticsPort;
  preview?: PreviewPort;
  settings?: SettingsPort;
}
```

见 [architecture.md](../../docs/architecture.md) 和 [04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md)。

## Desktop/Web 共享与差异

| 维度 | Desktop (`app/desktop/`) | Web (`app/web/`) |
|---|---|---|
| **壳层** | Tauri shell + Vite port 5173 | Vite port 5174 |
| **本地能力** | Local Edge (`127.0.0.1:3210`)、Tauri file/dialog/window/keyring/notification | 无本地 runtime；只能走 Hub REST/WS |
| **执行路径** | Workbench → platform adapter → Local Edge → runtime adapter → CLI | Workbench → platform adapter → Hub → Edge routing/relay → Edge → CLI |
| **认证** | TokenDance ID PKCE + system browser loopback | Hub session（`sessionStorage`，见 [[risk-ah-sr-register]] AH-SR-037） |
| **Secrets** | TokenDance API key 不入 renderer | TokenDance API key 永远不入浏览器 |
| **安全边界** | Desktop renderer 不获得 raw process execution；危险能力走 typed Tauri host API | 不能直连 Local Edge、不持有 TokenDance API key、不拥有本机文件系统 |

**共享部分**（二者均消费 `app/shared/`）：

| 共享层 | Owner 路径 |
|---|---|
| Workbench shell / rail / inspector / routes | `app/shared/src/workbench/` |
| Chat transcript renderer | `app/shared/src/chatview/` |
| Transcript block types、排序、归一化、evidence | `app/shared/src/transcript/` |
| Data mode compatibility contract | `app/shared/src/demo/dataMode.ts`、`app/shared/src/testing/e2eDataModeContract.ts` |
| 通用 UI 组件 | `app/shared/src/ui/`（CSS Modules + OKLCH，禁止硬编码颜色） |

**禁止**：Desktop/Web 复制 `app/shared/` 中的组件到本地 UI 副本。

## Transcript Pipeline

AgentHub 的可视聊天流是单条时间线，所有来源归一化后渲染：

```text
Hub / Edge / fixture / mock source
  → TranscriptBlock[]
  → 排序 + 归一化 + 过滤诊断信息
  → ChatViewBridge
  → ChatViewTranscript
  → blocksToTranscriptItems
  → TranscriptItem[]
  → UserMessage / AgentGroup / RowItem
```

**稳定行为**（来源：[04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md)）：

1. **乐观插入**：用户消息 submit 后立即出现；refetch、replay 或 runtime event 不得使其闪消。
2. **单时间线**：所有来源按 event time 排序，然后 stable input order。用户文本、Agent 文本、tool call/result、approval、subagent report、diff、artifact、deploy、context usage 和 preview 保持在一条线性 transcript 中。
3. **Agent 分组**：同一作者相邻 Agent block 由 chatview adapter 合并为一组。
4. **工具结果匹配**：当 call id 或 tool name 匹配时，tool result 替换其 tool call。
5. **诊断过滤**：runtime diagnostics、mock/mode/debug 标签在渲染前过滤，不进入聊天气泡。
6. **Markdown 渲染**：markdown、code block 和 table 在共享 bubble/card 组件内渲染，不作为转义纯文本。
7. **自动跟随滚动**：首次渲染、接近底部更新、用户本地 submit 时自动跟随；用户主动上翻不被强制覆盖。

**实时事件流**：

```text
Hub WS event
  → platform event bridge
  → React Query invalidation 或 runtime event append
  → transcript normalization
  → shared renderer
```

Desktop 额外可通过 desktop adapter 消费 Local Edge EventStore / Run lifecycle 事件。UI 层只感知归一化后的 transcript block 和 evidence ref。

**状态管理**：服务端状态用 TanStack Query（ADR-003），客户端 UI 临时状态用 Zustand。具体实现以 `app/shared`、Desktop/Web 当前代码为准。

## Data Mode 与证据等级

`dataMode` 是兼容字段，本身不能证明数据来源、认证状态或真实执行。测试和 PR 证据必须标注三个轴：

| 轴 | 含义 | 取值示例 |
|---|---|---|
| Surface | 运行壳层 | Desktop Vite、Web Vite、Desktop Tauri、Mobile RN Expo Web |
| Data Source | UI 数据来源 | `local-mock`、`deterministic-fixture`、`stubbed-hub-session`、`observed-hub-replay`、approved real |
| Auth/Execution | 登录/执行实况 | anonymous、local-only、hub-signed-in、approved-real |

| 产品模式 | `dataMode` | Runtime 边界 | 禁止声称 |
|---|---|---|---|
| Demo | `mock` | 不访问 Hub/Edge；Desktop 入口可 probing Local Edge health | real replay、real login、real execution |
| Fixture | `fixture` | 不访问 Hub/Edge runtime | real replay、real user data |
| Local | `auto` / local target | Desktop 可用 `127.0.0.1:3210`；Web/Mobile 禁止 | Hub login 或 cloud sync |
| Login/Hub | `auto` / Hub session | Desktop/Web/Mobile 使用 Hub；真实登录需 Hub session 证据 | TokenDance API key 或 model spend |
| Observed | `observed` | 只读 replay/observation | 新 CLI/model/API 执行 |
| Approved Real | `approved-real` | 仅明确批准的 Hub/Edge/CLI/API 路径 | silent fallback、stubbed real、packaged release |

Stubbed Hub、fixture、readiness-only 和 manifest-only 输出必须设 `real_tested=false`。Vite renderer 证据不能证明 packaged Desktop sidecar、icon、installer、signing、updater 或 release upload。

## Mobile RN 边界

| 事实 | 来源 |
|---|---|
| Mobile 主线为 **Expo + React Native development build** | [AGENTS.md](../AGENTS.md) 第 2 节 |
| 旧 Tauri Mobile **不再恢复** | [AGENTS.md](../AGENTS.md) 第 2 节 |
| 当前 UI/UX 主线优先 Desktop/Web；Mobile 深度重构另开任务 | [AGENTS.md](../AGENTS.md) 第 2 节 |
| Mobile RN Expo Web 端口 `5177` | [AGENTS.md](../AGENTS.md) 第 2 节 |
| Mobile adapter 负责 Hub session、Hub REST/WS、remote target routing、browser-safe preview 和 remote approval | [04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md) |
| Mobile native capability proof 另走 Mobile gates | [04-frontend-data-flow.md](../../docs/architecture/04-frontend-data-flow.md) |
| Mobile **暂不深挖**；发布前再做 Android/iOS development build 证据 | [security-risk-register.md](../../docs/governance/security-risk-register.md) AH-SR-042 |
| Mobile 不能直连 Local Edge 或 raw runtime | [architecture.md](../../docs/architecture.md) 非协商边界 |

**Mobile 与 Desktop/Web 共享**：
- 与 Web 相同的 Hub-only 路径（不持有 Local Edge）
- 消费 `app/shared/` 的 workbench/transcript/chatview 合同
- 平台 adapter 位于 `app/mobile-rn/src/platform/` 和 `app/mobile-rn/src/api/`
- 客户端 lane E2E/contract gate 位于 `app/mobile-rn/src/importBoundary.test.ts`

## Settings 与 Profiles

Settings 和 Agent profile 数据感知 surface 但通过共享 UI 渲染：

- **Desktop**：优先 Edge local settings → Hub settings → localStorage fallback。
- **Agent profiles**：合并 Edge local profiles、Hub shared profiles 和 raw adapter discovery；离线时本地可用性优先。
- **Web**：需要 Hub auth；不能静默 fallback 到 mock 数据。

风险：Runner compatibility health 仍进入 Desktop/Web settings/workbench，与 Runtime adapter + Execution Target 模型不一致（AH-SR-044）。详见 [[risk-ah-sr-register]]。

## 固定端口

| 资源 | 端口 |
|---|---:|
| Desktop/Tauri Vite | 5173（strict） |
| Web Vite | 5174（strict） |
| Mobile RN Expo Web | 5177 |
| Hub Server | 8080 |
| Local Edge | 3210 |

## 验收门禁

| 声称 | 最低有效门禁 |
|---|---|
| Transcript ordering/grouping/markdown | Shared Vitest over `app/shared/src/transcript/` 和 `app/shared/src/chatview/` |
| Send 可见性和 auto-follow | Desktop/Web Playwright chat-flow specs；Mobile 仅 framework/boundary，直到有专用 UI slice |
| 布局整洁 | Desktop/Web Visual QA at 16:9 `1440x810`，检查 overflow 和 final-message 可见性 |
| Data boundary | `app/shared/src/testing/e2eDataModeContract.ts` + surface-specific E2E assertions |
| Packaged Desktop | Tauri package/sidecar/icon/installer 证据，非 Vite-only |
| Real login/model/API | approved-real 证据，禁止 silent fallback |

## 已知 Hotspot 与风险

| Hotspot | 严重度 | 摘要 |
|---|---|---|
| [[mobile-path-residue]] | P2 | 旧 Tauri Mobile 路径/文档残留，如仍被引用则需清理。 |
| [[edge-runners-compat]] | P2 | Runner compatibility health 进入 UI，与 Runtime adapter 模型不一致。 |
| [[risk-evid-grade-confusion]] | P0 | Fixture/stub/readiness-only 不得声称 real login、real model 或 production。 |
| [[risk-session-secret-boundary]] | P1 | Web `sessionStorage` Hub session（AH-SR-037）；Gateway key 不入浏览器 UI。 |
| Web preview/mock surfaces（AH-SR-043） | P2 | 可能和生产 UI 路径共享，误报 fake execution 或 fake private-chat success。需显式 gate。 |

## 参考决策

| ADR | 结论 |
|---|---|
| ADR-003 | TanStack Query（服务端状态）+ Zustand（客户端 UI 临时状态） |
| ADR-008 | 设计 token 化：OKLCH + CSS Modules + `--td-*` intent；旧 `--glass-*` 是历史实现 |
| ADR-011 | pnpm workspace / shared package 架构；Desktop/Web/Mobile 共享类型和 UI contract |
