# 02 - 依赖流审计

> **审计范围**：跨端依赖方向、shared 内部分层、Go 服务分层、第三方依赖版本
> **审计时间**：2026-06-07
> **严格只读**：未修改任何源文件

---

## 1. 跨端依赖方向

### 1.1 desktop / web / mobile → shared：🟢 合规

| 平端     | shared 引用数 | 方向         |
|----------|--------------|--------------|
| desktop  | 118 处       | → shared     |
| web      | 59 处        | → shared     |
| mobile   | 30 处        | → shared     |

所有平台端均通过 `@shared/*` 路径别名引用 shared，方向单向（平台 → 共享），无违规。

### 1.2 平台间互引：🟢 合规

| 检查项              | 结果 |
|---------------------|------|
| desktop → web       | 无   |
| desktop → mobile    | 无   |
| web → desktop       | 无   |
| web → mobile        | 无   |
| mobile → desktop    | 无   |
| mobile → web        | 无   |
| shared → desktop    | 无   |
| shared → web        | 无   |
| shared → mobile     | 无   |

**结论**：依赖方向严格单向（平台端 → shared），无反向引用、无跨端互引。

---

## 2. shared 内部依赖分层

### 2.1 workbench → platform：🟢 合规（生产代码仅 type 引用）

| 文件 | 引用方式 |
|------|---------|
| `AgentHubWorkbench.tsx:9` | `import type { AgentHubPlatform, WorkbenchAgent, WorkbenchConversation } from '../platform'` |
| `ConversationSidebar.tsx:2` | `import type { WorkbenchConversation } from '../platform'` |
| `WorkbenchRoutes.tsx:2` | `import type { WorkbenchAgent } from '../platform'` |
| `WorkspaceHeader.tsx:2` | `import type { WorkbenchConversation } from '../platform'` |

唯一非 type 引用在测试文件中：
- `AgentHubWorkbench.test.tsx:4` — `import { createMockPlatform } from '../platform/createMockPlatform'`

**结论**：生产代码仅引用 platform 类型，依赖反转正确。

### 2.2 workbench → ui：🟡 可接受的单向引用

| 文件 | 引用 |
|------|------|
| `workbench/inspector/OverviewPanel.tsx:2` | `import { Icon } from '../../ui/Icon'` |

workbench 层引用 ui 层组件是合理的（ui 是更底层的基础组件层），方向正确。

### 2.3 ui → workbench：🟢 合规

无任何 `ui/` 文件引用 `workbench/`。方向正确。

### 2.4 platform → workbench：🟢 合规

无任何 `platform/` 文件引用 `workbench/`。方向正确。

### 2.5 transcript 外部依赖：🟢 合规（纯数据层）

transcript 模块仅引用：
- `'../events'`（type-only，`EventEnvelope` 类型）
- 内部 `'./types'`

无运行时外部依赖，层级边界清晰。

### 2.6 🟡 createMockPlatform 从 index.ts 导出

**文件**：`app/shared/src/index.ts:333`

```typescript
export { createMockPlatform } from './platform';
```

`createMockPlatform` 是测试辅助工具，通过 shared 的 barrel export 暴露给所有消费者。虽然目前非测试文件没有实际使用它，但这意味着生产 bundle 可能引入测试相关的代码。

**建议**：将测试辅助工具从主 barrel export 中移除，仅在测试中直接引用路径，或使用独立的测试入口文件。

---

## 3. Go 服务依赖

### 3.1 hub-server 分层：🟢 基本合规

**handler 层依赖**（`hub-server/internal/handler/`）：

| 引用包       | 说明           | 状态 |
|-------------|----------------|------|
| errcode     | 错误码定义     | 🟢   |
| model       | 数据模型       | 🟢   |
| service     | 业务逻辑层     | 🟢   |
| middleware  | 中间件         | 🟢   |
| jwtutil     | JWT 工具       | 🟢   |
| cache       | 缓存客户端     | 🟢   |
| config      | 配置           | 🟢   |
| repository  | 数据访问层     | 🟡   |
| ws          | WebSocket      | 🟢   |
| metrics     | 指标           | 🟢   |

**service 层依赖**（`hub-server/internal/service/`）：

| 引用包       | 说明           | 状态 |
|-------------|----------------|------|
| errcode     | 错误码         | 🟢   |
| model       | 数据模型       | 🟢   |
| repository  | 数据访问层     | 🟢   |
| cache       | 缓存           | 🟢   |
| config      | 配置           | 🟢   |
| ws          | WebSocket 推送 | 🟢   |
| metrics     | 指标           | 🟢   |
| jwtutil     | JWT 工具       | 🟢   |

**无** service → handler / router 违规。

**repository 层依赖**：仅引用 `model` 和 `config`。🟢 合规。

### 3.2 🟡 handler/health.go 跨层引用 repository

**文件**：`hub-server/internal/handler/health.go:11`

```go
"github.com/agenthub/hub-server/internal/repository"
```

`HealthHandler.Check()` 方法直接调用 `repository.VerifyMigrations()`，绕过 service 层。健康检查端点是基础设施探测，语义上可以接受直接访问 repository，但仍属于分层违规。

**建议**：可接受现状（健康检查是特殊的基础设施端点），但建议在代码注释中明确说明跨层原因。

### 3.3 edge-server 分层：🟢 合规

edge-server 采用扁平化包结构，`api`（handler）层可以引用 `agents`、`runners`、`store` 等业务包，`httpserver` 作为组装层。核心业务包（`agents`、`runners`、`store`）**没有**反向引用 `api` 或 `httpserver`。

---

## 4. 第三方依赖审计

### 4.1 🔴 版本不一致的依赖

以下依赖在不同 package.json 中声明了不同版本：

| 依赖 | 位置 | 版本 | 建议 |
|------|------|------|------|
| **react** | `shared/package.json` | `^19.0.0` | 应升级到 `^19.2.7` |
| **react** | `mobile/package.json` | `^19.1.0` | 应升级到 `^19.2.7` |
| **react-dom** | `shared/package.json` | `^19.0.0` | 应升级到 `^19.2.7` |
| **react-dom** | `mobile/package.json` | `^19.1.0` | 应升级到 `^19.2.7` |
| **@tanstack/react-query** | `app/package.json` | `^5.101.0` | 统一为同一版本 |
| **@tanstack/react-query** | `desktop/web/mobile` | `^5.100.14` | 统一为同一版本 |
| **@tauri-apps/api** | `mobile/package.json` | `^2.5.0` | 应升级到 `^2.11.0` |
| **i18next** | `app/package.json` | `^26.3.0` | 统一为同一版本 |
| **i18next** | `desktop/web/mobile` | `^26.2.0` | 统一为同一版本 |
| **zustand** | `app/package.json` | `^5.0.14` | 统一为同一版本 |
| **zustand** | `desktop/web/mobile` | `^5.0.13` | 统一为同一版本 |

**严重性**：🔴 — `react` / `react-dom` 版本不一致在 pnpm workspace 中可能导致运行时出现 dual-package 问题（hooks 失效、context 断裂）。`@tauri-apps/api` mobile 端落后 6 个 minor 版本尤其危险。

**建议**：
1. 在根 `app/package.json` 中集中声明共享依赖版本，子包使用 `workspace:*` 引用
2. 或使用 pnpm `overrides` 统一版本
3. 立即对齐 `react`/`react-dom` 到 `^19.2.7`

### 4.2 🔴 未使用的依赖

| 依赖 | 声明位置 | 引用数 | 说明 |
|------|---------|--------|------|
| **@pierre/diffs** | `shared/package.json` | 0 处 | 完全未使用，shared 中仅使用 `diff` 包 |
| **@tanstack/react-virtual** | `app/package.json` | 0 处 | 仅出现在 `desktop/vite.config.ts` 的 vendor chunk 配置中，代码中无任何 import |
| **class-variance-authority** | `desktop/package.json` | 0 处 | 完全未使用 |
| **zod** | `web/package.json` | 0 处 | 仅 desktop 使用了 zod，web 端未使用 |
| **rehype-raw** | `app/package.json` | 0 处 | 完全未使用 |

**建议**：移除上述未使用的依赖，减小 bundle 体积和安装时间。

### 4.3 🟡 shared 中同时存在 diff 和 @pierre/diffs

**文件**：`app/shared/package.json`

```json
"@pierre/diffs": "^1.1.0-beta.18",
"diff": "^8.0.2",
```

两个 diff 库功能重叠。代码中仅使用了 `diff`（`app/shared/src/diff.ts:1`）。`@pierre/diffs` 完全未引用。

**建议**：移除 `@pierre/diffs`，如需迁移则应替换 `diff` 的 import 后再移除。

### 4.4 🟢 版本一致的依赖

以下核心依赖在所有使用的包中版本一致：
- `lucide-react`：`^1.16.0`（所有包）
- `react-markdown`：`^10.1.0`（desktop/web）
- `react-syntax-highlighter`：`^16.1.1`（desktop/web）
- `vitest`：`^4.1.7`（所有包）
- `typescript`：`~5.8.0`（所有包）
- `vite`：`^6.3.0`（所有包）

---

## 审计总结

| 类别 | 级别 | 发现数 |
|------|------|--------|
| 跨端依赖方向 | 🟢 | 0 违规 |
| shared 内部分层 | 🟡 | 1 轻微（createMockPlatform 导出） |
| Go 服务分层 | 🟡 | 1 轻微（health.go 跨层，可接受） |
| 版本不一致 | 🔴 | 6 组（react/react-dom 最严重） |
| 未使用依赖 | 🔴 | 5 个未使用包 |

**最高优先级修复项**：
1. 对齐 `react`/`react-dom` 版本（shared 和 mobile 落后）
2. 移除未使用的 `@pierre/diffs`、`class-variance-authority`、`@tanstack/react-virtual`
3. 将 `zod` 从 `web/package.json` 移除（或迁移 web 端 schema 验证到 zod）
