# OpenCode 22-Package Monorepo Deep Dive

> 日期：2026-05-21
> 基于：`D:\Code\AgentHub\reference\opencode`（`anomalyco/opencode`, MIT, depth-1 clone @ v1.15.5）
> 技术栈：Bun workspace, TypeScript, Effect runtime, SolidJS, Hono HTTP, Drizzle ORM, Electron
> 参考：opencode.md（22-package 初步分析）、design-go-services.md（AgentHub Go monorepo 设计）、architecture.md（AgentHub 分层）

---

## 1. 完整 Package 清单（24 个）

### 1.1 所有子包总览

| # | Package Dir | npm Name | 职责 | .ts 文件数 | 层级 |
|---|------------|----------|------|-----------|------|
| 1 | `core` | `@opencode-ai/core` | Effect Services、全局常量、Schema、文件系统、GitHub Copilot adapter | **163** | Foundation |
| 2 | `llm` | `@opencode-ai/llm` | LLM Protocol 状态机、Provider 工厂、Route 四轴组合、Tool Runtime | **96** | Foundation |
| 3 | `sdk/js` | `@opencode-ai/sdk` | OpenAPI spec → codegen → typed JS/TS client + server | **43** | Foundation |
| 4 | `http-recorder` | `@opencode-ai/http-recorder` | HTTP 录制/回放测试（fixture-based LLM 测试） | **11** | Foundation |
| 5 | `script` | `@opencode-ai/script` | 构建脚本 | **2** | Foundation |
| 6 | `function` | `@opencode-ai/function` | Cloudflare Workers FaaS 运行时 | **2** | Foundation |
| 7 | `containers` | `@opencode-ai/containers` | 容器配置 | **1** | Foundation |
| 8 | `identity` | - | 品牌 assets（images only，无代码） | 0 | Assets |
| 9 | `docs` | - | Astro 文档站点内容（MDX only） | 0 | Content |
| 10 | `plugin` | `@opencode-ai/plugin` | Plugin 开发 SDK（类型 + 工具定义 + 19 hooks） | **8** | Library |
| 11 | `ui` | `@opencode-ai/ui` | SolidJS 组件库（message 渲染、diff viewer、i18n） | **55** | UI |
| 12 | `app` | `@opencode-ai/app` | TUI 业务逻辑（SolidJS SPA + SolidStart） | **164** | UI |
| 13 | `storybook` | `@opencode-ai/storybook` | UI 组件开发环境 | **18** | Tooling |
| 14 | `enterprise` | `@opencode-ai/enterprise` | 企业版 SaaS（SolidStart） | **11** | Application |
| 15 | `slack` | `@opencode-ai/slack` | Slack Bot 集成 | **2** | Application |
| 16 | `opencode` | `opencode` | **主应用**：CLI + Hono Server + Agent/Session/MCP/LSP/Config | **720** | Application |
| 17 | `desktop` | `@opencode-ai/desktop` | Electron 桌面应用 | **53** | Delivery |
| 18 | `web` | `@opencode-ai/web` | Astro SSG 文档/营销站点 | **7** | Delivery |
| 19 | `extensions/zed` | - | Zed 编辑器扩展 | - | Extension |
| 20 | `console/app` | `@opencode-ai/console-app` | SaaS Web Console（SolidStart） | **145** (合计) | Enterprise |
| 21 | `console/core` | `@opencode-ai/console-core` | SaaS DB/Billing/Stripe 核心 | 同上 | Enterprise |
| 22 | `console/function` | `@opencode-ai/console-function` | SaaS Cloudflare Workers | 同上 | Enterprise |
| 23 | `console/resource` | `@opencode-ai/console-resource` | Cloudflare resource binding | 同上 | Enterprise |
| 24 | `console/mail` | `@opencode-ai/console-mail` | 邮件模板 | 同上 | Enterprise |

> 原始报告称"22 packages"。实际可数出 24 个独立子包。差异来源：`identity`（images）和 `docs`（MDX content）在原始统计中可能被归入其他包；`console/` 的 5 个子包中 `mail` 在原始统计未被单独计数。

### 1.2 Workspace 配置（Bun workspace）

根 `package.json` 的 `workspaces` 字段：

```json
"workspaces": {
  "packages": [
    "packages/*",          // → app, core, containers, desktop, docs, enterprise, extensions, function, http-recorder, identity, llm, opencode, plugin, script, storybook, ui, web
    "packages/console/*",  // → console/app, console/core, console/function, console/mail, console/resource
    "packages/sdk/js",     // → sdk/js（特殊层级，不在 packages/*）
    "packages/slack"       // → slack（同上）
  ]
}
```

无 `pnpm-workspace.yaml` — 这是纯 Bun workspace monorepo。Bun 原生支持 `workspaces` 字段。

---

## 2. 完整分层架构图

### 2.1 ASCII 依赖图

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Layer 4 [Delivery]                                                       │
│                                                                           │
│  desktop ────────> app (devDep), ui (devDep)                              │
│  web ────────────> opencode (devDep)                                      │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 3 [Application]                                                    │
│                                                                           │
│  opencode ───────> llm, plugin, sdk, ui, core(dev), script                │
│  console/app ────> console-core, console-mail, console-resource, ui       │
│  enterprise ─────> core, ui                                               │
│  slack ──────────> sdk                                                    │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 2 [UI / Presentation]                                              │
│                                                                           │
│  app ────────────> sdk, ui, core                                          │
│  storybook ──────> ui                                                     │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 1 [Domain / Protocol]                                              │
│                                                                           │
│  plugin ─────────> sdk                                                    │
│  ui ─────────────> sdk, core                                              │
│  console/core ───> console-mail, console-resource                         │
│  console/func ───> console-core, console-resource                         │
│                                                                           │
├──────────────────────────────────────────────────────────────────────────┤
│  Layer 0 [Foundation — 零内部依赖]                                         │
│                                                                           │
│  core ───────────> effect, @ai-sdk/*, immer, zod (外部 only)               │
│  llm ────────────> effect, aws4fetch, eventstream-codec (外部 only)        │
│  sdk ────────────> cross-spawn, @hey-api/openapi-ts (外部 only)            │
│  http-recorder ──> effect                                                 │
│  script ─────────> semver                                                 │
│  function ───────> hono, jose, @octokit/*                                 │
│  containers ─────> (none)                                                 │
│  console/resource> @cloudflare/workers-types                              │
│  identity ───────> (images only)                                          │
│  docs ───────────> (content only)                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**关键事实**：依赖图是严格 DAG，**零循环依赖**。所有箭头都是单向的，从下层指向上层。

### 2.2 简化核心依赖图（AgentHub 映射相关）

```
                    ┌─────────────────────────────────┐
                    │         desktop / web            │
                    │      (Electron / Astro)          │
                    │  import: app, ui, opencode       │
                    ├─────────────────────────────────┤
                    │           opencode               │
                    │   (CLI + Hono Server, 720 files) │
                    │  import: llm, plugin, sdk, ui    │
                    ├──────────┬──────────────────────┤
                    │   app    │    enterprise/slack  │
                    │(TUI SPA) │   (SaaS / Bot)       │
                    │import:   │   import: core, ui   │
                    │sdk,ui,   │                      │
                    │core      │                      │
                    ├──────────┴──────────┬───────────┤
                    │  plugin   │   ui    │           │
                    │(dev SDK)  │(SolidJS)│           │
                    │import:sdk │import:  │           │
                    │           │sdk,core │           │
                    ├───────────┴─────────┤           │
                    │  llm       │  sdk   │   core    │
                    │(Protocol)  │(API)   │(Services) │
                    │  96 files  │43 files│ 163 files │
                    │ zero       │ zero   │ zero      │
                    │ internal   │internal│ internal  │
                    │ deps       │ deps   │ deps      │
                    └────────────┴────────┴───────────┘
```

---

## 3. 每层详细职责分析

### 3.1 Layer 0: Foundation（基础层）

**原则：零内部依赖。只能 import npm 外部包或 stdlib。**

#### `core` (@opencode-ai/core) — 163 files

| 维度 | 详情 |
|------|------|
| 职责 | Effect Services 运行时、全局常量、Schema 工具、文件系统抽象、GitHub Copilot adapter |
| 关键模块 | `global.ts` (Effect Layer 注入)、`provider.ts` (V2 Model/Provider schema)、`plugin.ts` (V2 Plugin Effect Service + immer draft)、`filesystem.ts`、`process.ts`、`catalog.ts`、`aisdk.ts` (AI SDK v2 桥接)、`session.ts` / `session-event.ts` / `session-message.ts`、`location.ts` |
| 外部依赖 | `effect`、18 个 `@ai-sdk/*` providers、`immer`、`zod`、`@effect/opentelemetry`、`@npmcli/arborist`、`glob`、`semver` |
| export 策略 | `"./*": "./src/*.ts"` — **wildcard 全量导出**，每个 src/ 下的文件都可以被外部直接 import。例如 `@opencode-ai/core/util/encode`、`@opencode-ai/core/global` |
| 被谁 import | `ui`, `app`, `opencode` (devDep), `enterprise` |

**为什么 `core` 最"重"**（163 files vs llm 的 96 vs plugin 的 8）：
- 不仅包含类型定义，还包含 Effect Service 运行时实现
- UI/TUI 需要的工具函数（path utils、encode/decode、binary、retry）全部下沉到 core
- GitHub Copilot adapter（chat model + auth + messages）是完整实现

#### `llm` (@opencode-ai/llm) — 96 files

| 维度 | 详情 |
|------|------|
| 职责 | LLM Protocol 状态机、Provider 工厂、Route 四轴组合（Protocol/Endpoint/Auth/Framing）、Tool Runtime 编排循环 |
| 关键模块 | `route/client.ts` (Route.make 四轴)、`route/protocol.ts` (ProtocolStream 状态机)、`route/executor.ts` (指数退避+重试)、`protocols/` (5 个协议实现)、`providers/` (12 个 provider)、`schema/` (LLMEvent 16 types, LLMError 10 variants)、`tool-runtime.ts` (tool orchestration loop)、`tool.ts` (tool schema codec) |
| 外部依赖 | `effect`、`@smithy/eventstream-codec`、`@smithy/util-utf8`、`aws4fetch`（仅 4 个外部依赖！） |
| export 策略 | **分层 structured exports**：`.` → 核心类型、`./route` → Route 系统、`./provider` → Provider 接口、`./providers` → 所有 provider 实现、`./protocols` → 所有协议实现、`./providers/anthropic` → 单个 provider |
| 被谁 import | **仅 `opencode`** import llm。这是设计意图——llm 是 opencode 的专属引擎 |

**Protocol/Route 四轴分离**（整个系统最精巧的架构决策）：

```
Route.make({
  id:        string        // 路由标识
  protocol:  Protocol      // 语义层：API 契约（what）
  endpoint:  Endpoint      // 部署层：URL 路径（where）
  auth?:     Auth          // 部署层：认证方式（how）
  framing:   Framing       // 部署层：流帧分割（transport format）
  headers?:  fn            // 跨切面：额外 HTTP 头
  defaults?: RouteDefaults // 模型默认参数
}): Route
```

Protocol = API 语义（Anthropic Messages / OpenAI Chat / Gemini / Bedrock Converse）
Endpoint + Auth + Framing = 部署组合（同协议不同 endpoint 就是不同 provider）

这意味着 DeepSeek、TogetherAI、Cerebras、Groq、Fireworks 等 8 个 provider 共享同一套 `OpenAICompatibleChat` protocol，新增一个 provider 只需一行 endpoint 配置。

#### `sdk` (@opencode-ai/sdk) — 43 files

| 维度 | 详情 |
|------|------|
| 职责 | OpenAPI spec → `@hey-api/openapi-ts` codegen → 70+ 类型安全方法（session CRUD、tool list、config、project、global events 等） |
| 关键模块 | `src/client.ts` (V1)、`src/v2/client.ts` (V2 workspace-aware)、`src/v2/gen/sdk.gen.ts` (auto-generated 70+ methods)、`src/v2/gen/types.gen.ts` (完整请求/响应类型) |
| 外部依赖 | `cross-spawn`（唯一外部 runtime dep）、`@hey-api/openapi-ts`（devDep，用于 codegen） |
| export 策略 | **多层 entry points**：`.` → V1 client、`./client` → client-only、`./server` → server-side、`./v2` → V2 client+server、`./v2/client` → V2 client、`./v2/gen/client` → raw generated client |
| 被谁 import | `plugin`、`ui`、`app`、`opencode`、`slack`（import 范围最广的包） |

SDK 是所有包中 import 广度最大的——5 个包依赖它。

#### 其余 Foundation 包

| Package | Files | 职责 | 外部依赖 |
|---------|-------|------|---------|
| `http-recorder` | 11 | HTTP 录制/回放，用于 LLM 测试（fixture golden file） | effect, @effect/platform-node |
| `script` | 2 | 构建辅助脚本 | semver |
| `function` | 2 | Cloudflare Workers FaaS 运行时 | hono, jose, @octokit/* |
| `containers` | 1 | 容器配置 | 无 |
| `console/resource` | - | Cloudflare resource binding（env-aware export） | @cloudflare/workers-types |
| `identity` | 0 | 品牌 SVG/PNG（images only） | 无 |
| `docs` | 0 | Astro 文档站点 MDX 内容（content only） | 无 |

### 3.2 Layer 1: Domain / Protocol

#### `plugin` (@opencode-ai/plugin) — 8 files

| 维度 | 详情 |
|------|------|
| 职责 | Plugin 开发 SDK：19 个生命周期钩子类型、WorkspaceAdapter 抽象、Plugin 函数签名、Tool 定义工具 |
| 关键文件 | `src/index.ts` — PluginInput/Plugin/Hooks/PluginModule 全部类型定义（~333 行，纯类型 + 少量工具） |
| 依赖 | `@opencode-ai/sdk` (workspace:*) |
| export 策略 | 3 个 entry：`.` → main types、`./tool` → ToolDefinition、`./tui` → TUI-specific |
| 被谁 import | **仅 `opencode`** import plugin |

插件系统关键设计：
- `Plugin = (input: PluginInput, options?: PluginOptions) => Promise<Hooks>` — 统一工厂函数
- `Hooks` 包含 19 个回调：`event`、`config`、`tool`、`auth`、`provider`、`chat.message`、`chat.params`、`chat.headers`、`permission.ask`、`command.execute.before`、`tool.execute.before/after`、`shell.env`、`experimental.*`（5 个）
- 所有 hook 统一签名为 `(input, output) => Promise<void>`（双向修改模式）

#### `ui` (@opencode-ai/ui) — 55 files

| 维度 | 详情 |
|------|------|
| 职责 | SolidJS 可复用组件库：message 渲染、diff viewer、i18n 基础设施、pierre diff 引擎封装、theme、icons |
| 关键模块 | `components/` (30+ 组件)、`pierre/` (diff 引擎)、`i18n/`、`hooks/`、`context/`、`theme/`、`v2/` |
| 依赖 | `@opencode-ai/sdk`、`@opencode-ai/core` |
| 外部依赖 | solid-js, @solidjs/router, @kobalte/core, @pierre/diffs, marked, shiki, motion |
| export 策略 | **细粒度路径导出**：`./*` → components、`./session-diff` → diff component、`./i18n/*` → locales、`./pierre`、`./hooks`、`./context`、`./styles`、`./theme/*`、`./icons/*`、`./fonts/*`、`./audio/*`、`./v2/*` |
| 被谁 import | `app`、`opencode`、`enterprise`、`desktop` (devDep)、`storybook` (devDep) |

#### 其余 Domain 包

| Package | Files | 职责 | 依赖 |
|---------|-------|------|------|
| `console/core` | - | SaaS DB models、Stripe billing、PlanetScale Drizzle ORM | console-mail, console-resource |
| `console/function` | - | SaaS Cloudflare Workers 函数 | console-core, console-resource |

### 3.3 Layer 2: UI / Presentation

#### `app` (@opencode-ai/app) — 164 files

| 维度 | 详情 |
|------|------|
| 职责 | TUI 完整业务逻辑：SolidStart SPA、session composer、prompt input、global sync、permission auto-respond、file tree、WebSocket event reduction |
| 依赖 | `@opencode-ai/sdk`、`@opencode-ai/ui`、`@opencode-ai/core` |
| 外部依赖 | solid-js, @solidjs/router, @solidjs/start, @tanstack/solid-query, @sentry/solid, @thisbeyond/solid-dnd, ghostty-web (terminal emulator) |
| 被谁 import | `desktop` (devDep) |

`app` 与 `ui` 的关系：`app` = 业务逻辑 + 状态管理 + 路由 + sync；`ui` = 纯展示组件。`app` 依赖 `ui`，`ui` 不知道 `app` 存在。

#### `storybook` (@opencode-ai/storybook) — 18 files

UI 组件开发环境，依赖 `@opencode-ai/ui`。

### 3.4 Layer 3: Application

#### `opencode` (包名 "opencode") — 720 files

| 维度 | 详情 |
|------|------|
| 职责 | **主应用**：CLI 入口（yargs）、Hono HTTP Server + SSE、Agent 系统（7 个内置 agent）、Session 管理（parent/child tree + SQLite）、MCP Server（5 状态 discriminated union + OAuth）、Config（`opencode.toml`）、LSP 集成、Plugin Loader、Tool Registry、Worktree 管理、ACL 权限系统 |
| 代码规模 | 720 个 .ts 文件 — 是整个 monorepo 中最大的单一包，占 mono repo 总 .ts 文件的 ~37% |
| 依赖 | `@opencode-ai/llm` (workspace:*)、`@opencode-ai/plugin` (workspace:*)、`@opencode-ai/sdk` (workspace:*)、`@opencode-ai/ui` (workspace:*)、`@opencode-ai/core` (devDep)、`@opencode-ai/script` (workspace:*) |
| 关键子模块 | `agent/` (7 内置 agent + 动态生成)、`session/` (完整 session 生命周期)、`mcp/` (MCP 客户端 + OAuth)、`plugin/` (loader)、`tool/` (registry + 15+ 内置 tools)、`server/` (Hono HTTP + SSE)、`config/`、`cli/`、`lsp/`、`snapshot/`、`worktree/`、`storage/` (Drizzle + SQLite) |
| 被谁 import | `web` (devDep) |

**`opencode` 的模块拆分**（720 files 的内部结构）：

```
src/
├── agent/         # Agent 定义 + 动态生成 + 权限规则
├── session/       # Session lifecycle + LLM call + message persistence
├── mcp/           # MCP client (5-state union, OAuth, StreamableHTTP)
├── plugin/        # Plugin loader (builtin + external + retry)
├── tool/          # Tool registry + 15+ builtin tools
├── server/        # Hono HTTP server + SSE streaming
├── config/        # opencode.toml parsing
├── cli/           # yargs CLI entry
├── project/       # Project detection + .git parsing
├── provider/      # Provider catalog + model routing
├── auth/          # OAuth auth providers (8 builtin)
├── permission/    # ACL permission system
├── snapshot/      # File snapshot + diff
├── worktree/      # Git worktree management
├── lsp/           # LSP integration
├── storage/       # Drizzle ORM + SQLite (Session, Part, Message tables)
├── bus/           # Internal event bus
├── sync/          # File sync + watcher
├── shell/         # Shell execution environment
├── skill/         # Skill system
├── format/        # Message formatting
├── git/           # Git operations
├── background/    # Background tasks
├── effect/        # Effect Layer setup
└── v2/            # V2 API bridge
```

#### 其余 Application 包

| Package | Files | 职责 | 依赖 |
|---------|-------|------|------|
| `enterprise` | 11 | 企业版 SaaS（SolidStart）：share、storage | core, ui |
| `slack` | 2 | Slack Bot（Bolt framework） | sdk |
| `console/app` | 145 (console total) | SaaS Web Console（SolidStart + Stripe） | console-core, ui |

### 3.5 Layer 4: Delivery

#### `desktop` (@opencode-ai/desktop) — 53 files

| 维度 | 详情 |
|------|------|
| 职责 | Electron 桌面应用：main process (server 生命周期、系统菜单、自动更新、sidecar)、renderer (SolidJS WebView + TUI)、IPC 桥接、platform native 模块 |
| 依赖 | `@opencode-ai/app` (devDep)、`@opencode-ai/ui` (devDep)。**运行时不需要 app/ui**——electron 内嵌一个独立 opencode server，TUI 通过 `http://localhost:4096` 通信 |
| 外部依赖 | electron, electron-builder, electron-updater, electron-vite, drizzle-orm（desktop 有自己的 SQLite） |

**关键架构**：desktop 通过 `electron-vite` 打包时依赖 app/ui，运行时 app/ui 代码被 bundle 进 renderer，不访问 npm workspace。

#### `web` (@opencode-ai/web) — 7 files

| 维度 | 详情 |
|------|------|
| 职责 | Astro SSG 纯文档站点（20+ 语言 MDX），Starlight 主题。不含任何运行时代码。 |
| 依赖 | `opencode` (devDep) — 仅用于构建时生成 `openapi.json` |
| 外部依赖 | astro, @astrojs/starlight, @astrojs/cloudflare, @astrojs/solid-js |

---

## 4. 依赖规则与导出策略

### 4.1 无循环依赖

经过完整分析，确认 **OpenCode 的 24 个包之间零循环依赖**。所有 import 关系严格单向：

```
Layer 0 (foundation) ← Layer 1 (domain) ← Layer 2 (ui) ← Layer 3 (app) ← Layer 4 (delivery)
```

**验证方法**：
1. 逐包检查 `dependencies` + `devDependencies` 中的 `workspace:*` 引用
2. Bup workspace 的 `install` 命令自动检测循环依赖（会报错）
3. TypeScript 类型检查 (`tsgo --noEmit`) 在 monorepo 中会因循环引用而无法编译

**同层依赖**：
- `app` → `ui`（Layer 2 内依赖，app 是 ui 的消费者）
- `console/core` → `console-mail`（console 内依赖）
- `plugin` → `sdk`（Layer 1 → Layer 0）

### 4.2 三种导出策略

OpenCode 24 个包采用了 3 种不同的导出策略：

#### 策略 A：Wildcard 全量导出（`core`）
```json
"exports": {
  "./*": "./src/*.ts"
}
```
**使用者**：`core`。允许外部直接 import 任意内部文件：
```ts
import { getFilename } from "@opencode-ai/core/util/path"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { Binary } from "@opencode-ai/core/util/binary"
```
**优势**：极灵活性，消费者可以精确 import 所需模块。
**代价**：内部文件结构暴露给外部，重构需要协调。

#### 策略 B：Structured Entry Points（`llm`）
```json
"exports": {
  ".": "./src/index.ts",
  "./route": "./src/route/index.ts",
  "./provider": "./src/provider.ts",
  "./providers": "./src/providers/index.ts",
  "./providers/anthropic": "./src/providers/anthropic.ts",
  "./protocols": "./src/protocols/index.ts",
  "./protocols/anthropic-messages": "./src/protocols/anthropic-messages.ts"
}
```
**使用者**：`llm`、`ui`、`sdk`。粗粒度分层，公开 API 稳定。
**优势**：明确的公共 API 边界，tree-shaking 友好。
**代价**：需要手动维护 exports 映射。

#### 策略 C：Minimal Entry Points（`plugin`）
```json
"exports": {
  ".": "./src/index.ts",
  "./tool": "./src/tool.ts",
  "./tui": "./src/tui.ts"
}
```
**使用者**：`plugin`、`script`、`slack`。只有少数明确的公共入口点。
**优势**：最小公开 API，封装性强。
**代价**：内部灵活性受限。

### 4.3 devDependencies vs dependencies

OpenCode 在 dep 类型上的关键约定：

| Package | dependencies (workspace:*) | devDependencies (workspace:*) | 说明 |
|---------|---------------------------|------------------------------|------|
| `opencode` | llm, plugin, sdk, ui, script | core | core 是 Effect Service 实现，在 opencode 中做类型引用，运行时通过 Effect Layer 提供 |
| `desktop` | (none) | app, ui | Electron 打包时 bundle，非运行时 workspace 依赖 |
| `web` | (none) | opencode | 仅为构建时生成 openapi.json |

**约定**：
- `dependencies` = 运行时需要的包
- `devDependencies` = 构建/类型/测试时需要的包
- `desktop` 和 `web` 不声明任何 workspace `dependencies`——它们通过打包（electron-vite / astro build）将代码内联

---

## 5. 对 AgentHub Go Monorepo 的映射

### 5.1 层到层映射

| OpenCode Layer | OpenCode 包 | AgentHub 对应 | 关键差异 |
|---------------|-------------|---------------|---------|
| **Layer 0 Foundation** | `core`（Effect Services, Schema, 工具函数）| `packages/protocol/` + `packages/transport/` | OpenCode 的 core 是运行时+类型一体；AgentHub 的 protocol 是纯 proto 生成代码，transport 是纯接口。在 Go 中这些应分开。 |
| **Layer 0 Foundation** | `llm`（LLM Protocol 状态机）| `packages/agent-core/` (agent loop model) + Runner 内部的 `internal/executor/` | Go 中 LLM 调用会通过 Agent CLI 子进程完成，不是 in-process 协议解析。但 LLMEvent/LLMError tagged union 的建模思路可直接映射为 Go sum types（interface + type switch）。 |
| **Layer 0 Foundation** | `sdk`（OpenAPI codegen client）| `gen/go/` (ConnectRPC 生成) + `gen/ts/` (Connect-ES 生成) | 同等地位。OpenCode 用 `@hey-api/openapi-ts`；AgentHub 用 Buf + ConnectRPC。都是协议生成代码路线。 |
| **Layer 1 Domain** | `plugin`（19 hooks + PluginInput）| `runner/internal/adapters/`（Agent adapter interfaces）+ `packages/approval-core/`（权限审批） | OpenCode 的 plugin hooks 是在进程内注册回调（TypeScript 特性），Go 中 adapter interface（Go interface）是更自然的映射。 |
| **Layer 1 Domain** | `ui`（SolidJS 组件）| `apps/web/`（React UI，独立 workspace）| UI 层独立，与 Go 服务不在同一 module。 |
| **Layer 2 UI** | `app`（SolidStart SPA）| `apps/web/` | 同上。 |
| **Layer 3 App** | `opencode`（CLI + Hono Server, 720 files）| **拆分为 3 个服务**：`hub/` + `edge/` + `runner/` | **这是最大差异**。OpenCode 是单体 CLI+Server（720 个 .ts 文件全在一个包里）；AgentHub 按职责拆分为 3 个独立 Go 服务。AgentHub 的拆分优于 OpenCode 的单体——部署独立、故障隔离、可独立扩展。 |
| **Layer 4 Delivery** | `desktop` (Electron) + `web` (Astro) | `apps/web/` (React) + 未来可能的 Tauri desktop | 文档站点：AgentHub 尚未有 Astro 等价物。Desktop：OpenCode 的 Electron 方案对 AgentHub 有参考价值。 |

### 5.2 架构范式可复用性

| OpenCode 范式 | AgentHub 映射 | 复用度 |
|--------------|---------------|--------|
| Protocol/Route 四轴分离 (LLM) | Go interface: `LLMProvider` + `ProtocolAdapter` | **高** — AgentHub 的 Agent adapter 接口应该采用同样的关注点分离 |
| Discriminated Union 错误/状态 (Effect Schema) | Go sum type: `interface{ isX() }` + type switch | **高** — 直接映射。Go 没有 tagged union，但 interface + sealed method 可实现同等语义 |
| Plugin Hook 双向修改模式 | Go middleware chain: `func(next Handler) Handler` | **中** — Go 的中间件模式天然适合 |
| OpenAPI Codegen 驱动 SDK | Buf + ConnectRPC codegen | **高** — 都是从协议定义生成类型 |
| Effect Service + Layer DI | Manual DI + Wire (P2+) | **中** — Go 社区偏好显式构造函数注入 |

### 5.3 OpenCode 的不足及 AgentHub 应改进的点

| 问题 | OpenCode 现状 | AgentHub 对策 |
|------|-------------|--------------|
| **单包过大** | `opencode` 包 720 个 .ts 文件，包含 agent + session + mcp + server + cli + config + lsp + sync + worktree 等所有应用逻辑 | AgentHub 已按职责拆分为 hub/edge/runner 三个服务，每个服务有独立的 `internal/` |
| **Plugin 双系统** | V1 (`@opencode-ai/plugin`) 和 V2 (`core/plugin.ts`) 两套 plugin 并存 | 从 Day 1 就统一 Plugin/Adapter API |
| **Agent 硬编码** | 7 个内置 agent（build/plan/general/explore/scout/compaction/title）在代码中 hardcode | 配置驱动：agent 定义从 YAML/TOML 读取 |
| **Tool 定义分散** | Tool 定义同时在 V1 plugin hooks 和 V2 `llm/src/tool.ts` 中 | 统一 Tool Registry（已在 design 中规划） |
| **core 膨胀** | `core` 163 files 包含 Effect Service、文件系统、GitHub Copilot adapter、工具函数混在一起 | AgentHub 的 `packages/protocol/` 只做类型，`packages/transport/` 只做传输——职责更清晰 |

### 5.4 包规模的对标

| OpenCode 包 | 文件数 | AgentHub 对应（规划） | 合理规模 |
|-------------|--------|---------------------|---------|
| `core` | 163 | `packages/protocol/` + `packages/transport/` | ~20-50 Go 文件 |
| `llm` | 96 | `runner/internal/executor/` + `runner/internal/adapters/` | ~30-60 Go 文件 |
| `sdk` | 43 | `gen/go/` + `gen/ts/` | 自动生成，不计 |
| `plugin` | 8 | `packages/adapters/` (shared interface) | ~5-15 Go 文件 |
| `opencode` | 720 | `hub/` + `edge/` + `runner/`（3 个服务） | 每个服务 ~30-80 Go 文件 |
| `app` + `ui` | 219 | `apps/web/` (React, 独立) | 独立 workspace |

**结论**：AgentHub 的 3 服务拆分避免了 OpenCode 的 720 文件单包问题。每个 Go 服务的 `internal/` 应按功能拆分为 5-15 个文件/包，而不是堆在单一级别。

### 5.5 关键映射建议

1. **`core` → `packages/protocol/` + `packages/transport/`**：Go 中类型定义和传输逻辑应分离，不要像 OpenCode 的 core 那样把文件系统、进程管理、GitHub Copilot adapter 都塞进一个包。

2. **`llm` → Runner 内部**：LLM 协议解析在 AgentHub 中不直接做（通过 Agent CLI 子进程），但 LLMEvent 16 type 和 LLMError 10 variant 的 tagged union 建模应照搬。

3. **`plugin` → `packages/adapters/`**：OpenCode 的 PluginInput + 19 hooks 双向修改模式，在 Go 中映射为 `AgentAdapter` interface + middleware chain。

4. **`sdk` → Buf + ConnectRPC**：同是协议生成代码，AgentHub 生成 Go + TypeScript 双端类型。

5. **`opencode` (720 files) → hub/ + edge/ + runner/**：AgentHub 的拆分是正确方向。但需注意：hub/edge/runner 之间有共享逻辑（如 conversation CRUD），应提取到 `packages/im-core/` 而不是复制。

6. **`desktop` → 未来 Tauri/SwiftUI**：OpenCode 的 Electron desktop（server + webview 内嵌）模式对 AgentHub 的 desktop app 有直接参考。

---

## 6. 总结

OpenCode 的 24-package monorepo 是 TypeScript 生态中大规模分层的优秀案例：

- **严格 DAG 依赖**：Layer 0 → Layer 1 → Layer 2 → Layer 3 → Layer 4，零循环
- **最优架构决策**：Protocol/Route 四轴分离（Protocol/Endpoint/Auth/Framing）使得 20+ provider 共享协议实现
- **最大不足**：`opencode` 单包过大（720 files），CLI + Server + Agent + Session + MCP + Sync 全混在一起
- **对 AgentHub 的价值**：证明了 monorepo 分层可行，但 AgentHub 的 hub/edge/runner 拆分是更正确的方向——避免单包过大

AgentHub 应吸取的教训：
- 保持包边界清晰：`core` 膨胀是天然趋势，需要从 Day 1 就主动控制
- 不要出现双 plugin 系统：统一是唯一选择
- Schema-first codegen 从 Day 1 开始：OpenCode 的 `sdk` 包证明了这能产生 70+ 类型安全方法
- Effect/Layer DI 是 TypeScript 特有能力：Go 用 Manual DI + Wire 更自然
