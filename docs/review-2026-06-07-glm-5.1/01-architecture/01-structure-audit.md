# 01 - 结构审计报告

> 审计日期: 2026-06-07
> 审计范围: monorepo 整体目录结构、模块边界、依赖方向、配置散落
> 审计模式: 严格只读

---

## 目录

1. [目录结构合理性](#1-目录结构合理性)
2. [模块边界与依赖方向](#2-模块边界与依赖方向)
3. [shared 内部依赖层级](#3-shared-内部依赖层级)
4. [Go 服务边界](#4-go-服务边界)
5. [配置散落与临时文件](#5-配置散落与临时文件)
6. [monorepo 工具链一致性](#6-monorepo-工具链一致性)
7. [总结](#7-总结)

---

## 1. 目录结构合理性

### 1.1 🟡 顶级目录职责清晰但存在遗留产物

**发现**: 顶级目录整体职责分明，但存在几个需要关注的目录:

| 目录 | 职责 | 状态 |
|---|---|---|
| `app/` | 前端工作区（shared/desktop/web/mobile/e2e） | 正常 |
| `hub-server/` | Go Hub 后端 | 正常 |
| `edge-server/` | Go Edge 后端 | 正常 |
| `pkg/` | Go 共享库（errcode/debug/reqlog） | 正常 |
| `api/` | OpenAPI 规范与文档 | 正常 |
| `scripts/` | 脚本工具 | 正常 |
| `docs/` | 项目文档 | 正常 |
| `reference/` | 竞品参考代码（大量第三方仓库克隆） | 需关注 |
| `output/` | 输出目录（当前仅含空 `imagegen/`） | 需关注 |
| `.tmp/` `tmp/` | 临时目录 | 需关注 |

**具体文件路径**:
- `reference/` 下包含 30+ 个第三方项目克隆（ChatDev, Flowise, LibreChat, claude-code-source 等）
- `output/imagegen/` 空目录
- `.tmp/` 和 `tmp/` 均为空目录

**建议**: `reference/` 目录体量巨大，应确认 `.gitignore` 规则已正确排除其内容（当前 `!reference/INDEX.md` 保证只跟踪索引文件，这是正确的）。`output/`、`.tmp/`、`tmp/` 均已在 `.gitignore` 中排除，无问题。

### 1.2 🟢 .gitignore 覆盖充分

**发现**: `.gitignore` 文件（4084 字节）覆盖全面，包含:
- `node_modules/`、`dist/`、`build/`、`output/` 编译产物
- `*.exe`、`*.test`、`*.out` Go 二进制
- `.env`、`.env.local`、`*.pem`、`*.key` 敏感文件
- `.tmp/`、`tmp/` 临时目录
- `screenshots/`、`*.png` 截图文件
- `stats.html`、`**/tsc-output.txt` 构建日志

经验证，以下文件均未被 git 跟踪:
- `app/desktop/stats.html` (5.6 MB) -- 未跟踪
- `app/desktop/tsc-output.txt` -- 未跟踪
- `app/desktop/.env.local` -- 未跟踪
- `edge-server/test-edge-server.exe` (30 MB) -- 未跟踪
- `hub-server/.tmp/` 内的二进制文件 -- 未跟踪

### 1.3 🟢 hub-server/uploads/ 合理使用 .gitkeep

**文件**: `hub-server/uploads/.gitkeep`

保留空目录结构用于上传目录挂载点，是标准做法。

### 1.4 🟡 BACKEND-MERGE-PLAN.md 散落在根目录

**文件**: `BACKEND-MERGE-PLAN.md` (19,841 字节, 未跟踪)

这是一个后端合并计划文档，散落在根目录且未被 gitignore 排除。虽然未跟踪，但文件名暗示它是临时工作文档。

**建议**: 将此类临时计划文档移至 `docs/` 或加入 `.gitignore` 排除规则，避免意外提交。

---

## 2. 模块边界与依赖方向

### 2.1 🟢 前端依赖方向正确: desktop/web -> shared

**发现**: 依赖方向完全符合预期——各平台应用单向依赖 shared 库，无反向依赖。

| 消费方 | 依赖方式 | 引用方式 |
|---|---|---|
| `app/desktop` | -> `app/shared` | `@shared/*` Vite alias |
| `app/web` | -> `app/shared` | `@shared/*` Vite alias |
| `app/mobile` | -> `app/shared` | `@agenthub/shared` workspace package |

**验证**:
- `app/shared/src/` 中无任何对 `desktop`、`web`、`mobile` 的 import（零反向依赖）
- `app/desktop` 不引用 `app/web` 或 `app/mobile` 的代码
- `app/web` 不引用 `app/desktop` 或 `app/mobile` 的代码

### 2.2 🟡 desktop/web 使用 Vite alias 而 mobile 使用 workspace 包引用

**文件**:
- `app/desktop/vite.config.ts:11` -- `alias: { '@shared': path.resolve(__dirname, '..', 'shared', 'src') }`
- `app/web/vite.config.ts:11` -- `alias: { '@shared': path.resolve(__dirname, '..', 'shared', 'src') }`
- `app/mobile/package.json:18` -- `"@agenthub/shared": "workspace:*"`

**问题**: desktop 和 web 通过 Vite `resolve.alias` 直接指向 shared 的 `src/` 目录（路径别名 `@shared`），而 mobile 通过 pnpm workspace 协议使用 `@agenthub/shared` 包名。两种引用方式不同，导致:
1. shared 的 `package.json` 中声明的 `exports` 映射只对 mobile 生效
2. desktop/web 的 `@shared/*` 别名绕过了 package.json exports，直接访问源文件
3. 代码风格不统一（`@shared/types` vs `@agenthub/shared/types`）

**建议**: 统一所有子项目使用 `@agenthub/shared` workspace 引用方式，移除 Vite alias。这需要 shared 的 package.json exports 配置足够完善。

### 2.3 🟢 跨平台无直接依赖

**验证**: desktop、web、mobile 三个平台应用之间没有任何代码级 import 依赖，完全通过 shared 库间接通信。

---

## 3. shared 内部依赖层级

### 3.1 🟢 shared 内部层级清晰无循环依赖

shared 库的内部模块依赖关系如下:

```
层级 0 (纯类型/工具): types/, events/, errors/, tree/, diff/
层级 1 (领域逻辑):   composer/, transcript/, platform/, context/, hubEvents/, hubClient/
层级 2 (基础设施):   apiClient/, eventClient/
层级 3 (UI 组件):    ui/, components/
层级 4 (组装层):     workbench/
```

**验证结果**:
- `ui/` 不引用 `platform/`、`workbench/`、`composer/` -- 纯展示层
- `components/` 不引用 `workbench/` -- 无越级依赖
- `workbench/` 引用 `platform/`（仅类型）和 `ui/` -- 正确的组装层行为
- 无循环引用

### 3.2 🟢 workbench 对 platform 的依赖仅为类型引用

**文件**:
- `app/shared/src/workbench/AgentHubWorkbench.tsx:9` -- `import type { AgentHubPlatform, ... } from '../platform'`
- `app/shared/src/workbench/ConversationSidebar.tsx:2` -- `import type { WorkbenchConversation } from '../platform'`
- `app/shared/src/workbench/WorkspaceHeader.tsx:2` -- `import type { WorkbenchConversation } from '../platform'`
- `app/shared/src/workbench/WorkbenchRoutes.tsx:2` -- `import type { WorkbenchAgent } from '../platform'`

所有引用均为 `import type`（纯类型导入），不引入运行时耦合，这是正确的架构模式。

### 3.3 🟢 UI 组件不直接引用 platform 层

**验证**: `app/shared/src/ui/` 和 `app/shared/src/components/` 中无任何对 `platform` 的 import，UI 层保持纯粹的展示职责。

---

## 4. Go 服务边界

### 4.1 🟢 hub-server 和 edge-server 无直接代码耦合

**验证**:
- `hub-server/` 内无任何 `github.com/agenthub/edge-server` 的 import
- `edge-server/` 内无任何 `github.com/agenthub/hub-server` 的 import
- 两个服务通过 `pkg/` 共享库（errcode/debug/reqlog）间接通信
- `pkg/` 作为 Go workspace 共享模块，通过 `go.work` 管理

### 4.2 🟢 共享库 `pkg/` 设计合理

**文件**: `pkg/go.mod`

`pkg/` 模块仅包含三个工具包:
- `pkg/errcode/` -- 错误码基础类型和通用错误
- `pkg/debug/` -- 调试工具
- `pkg/reqlog/` -- 请求日志

hub-server 和 edge-server 各自的 `internal/errcode/` 包通过 re-export 模式委托给 `pkg/errcode`，然后添加各自领域的特定错误码。这是正确的领域驱动设计。

### 4.3 🟡 两个服务各自持有独立的 jwtutil 实现

**文件**:
- `hub-server/internal/jwtutil/jwt.go` (83 行) -- JWT 生成与验证，含 TokenDance 协议
- `edge-server/internal/jwtutil/validate.go` (74 行) -- JWT 验证逻辑

**问题**: 两个服务各自有独立的 jwtutil 包，职责有重叠（都做 JWT 验证）。hub-server 的版本更完整（含 token 生成），edge-server 的版本只做验证。

**建议**: 评估将 JWT 验证逻辑提取到 `pkg/jwtutil/` 共享包，hub-server 扩展生成功能，edge-server 只引用验证部分。当前不严重，但 JWT 逻辑分散可能在密钥轮换等场景产生一致性风险。

### 4.4 🟡 golangci-lint 配置不一致

**文件**:
- `hub-server/.golangci.yml`
- `edge-server/.golangci.yml`

**差异**:
- edge-server 额外启用了 `errname`、`exhaustive`、`gocritic`、`nilerr`、`unparam` 等 linter
- hub-server 额外启用了 `gosec`（安全扫描）
- 两者的 cyclomatic complexity 豁免规则完全不同（对应各自的复杂文件）
- hub-server 在 `issues.exclude-rules` 中排除了 tests 目录，edge-server 没有

**建议**: 将共享的 linter 配置提取到根级 `.golangci.yml`，服务级别只保留差异化的豁免规则。hub-server 缺少 `gosec` 以外的安全 linter，edge-server 缺少 `gosec`，建议两个服务都启用完整的安全检查集。

### 4.5 🟢 hub-server 内部分层合理

hub-server 遵循标准的 Go 项目分层:

```
cmd/           -- 入口
internal/
  app/         -- 应用初始化
  config/      -- 配置
  errcode/     -- 错误码 (re-export pkg + domain)
  handler/     -- HTTP handler
  middleware/  -- 中间件
  model/       -- 数据模型
  repository/  -- 数据访问
  router/      -- 路由
  service/     -- 业务逻辑
  ws/          -- WebSocket
  cache/       -- 缓存
  jwtutil/     -- JWT 工具
  log/         -- 日志
  metrics/     -- 指标
```

### 4.6 🟢 edge-server 内部分层合理

edge-server 结构同样清晰:

```
cmd/           -- 入口
internal/
  adapters/    -- 外部适配器（Claude Code, Codex, OpenCode 等）
  agents/      -- Agent 管理
  api/         -- API 层
  diff/        -- Diff 处理
  errcode/     -- 错误码
  events/      -- 事件系统
  httpserver/  -- HTTP 服务
  hub/         -- Hub 通信
  jwtutil/     -- JWT 验证
  lifecycle/   -- 生命周期管理
  mcp/         -- MCP 协议
  metrics/     -- 指标
  middleware/  -- 中间件
  runnerctx/   -- Runner 上下文
  runners/     -- Runner 管理
  security/    -- 安全策略
  skills/      -- 技能系统
  store/       -- 存储
```

---

## 5. 配置散落与临时文件

### 5.1 🔴 hub-server/.tmp/ 包含大量未清理的编译产物

**文件**:
- `hub-server/.tmp/agenthub-hub.tar` (33.5 MB)
- `hub-server/.tmp/server-hub-linux` (62.6 MB)
- `hub-server/.tmp/server-hub-linux-static` (62.2 MB)

**总计约 158 MB** 的编译产物留在本地磁盘。虽然 `.gitignore` 排除了 `.tmp/`，但这些文件占用大量磁盘空间且可能包含嵌入的密钥或配置。

**建议**:
1. 立即清理: `rm -rf hub-server/.tmp/`
2. 将编译输出指向项目外的临时目录，或使用 `make clean` 目标

### 5.2 🔴 edge-server/.tmp/ 包含多个编译产物

**文件**:
- `edge-server/.tmp/agenthub-edge-desktop-qa.exe` (17.0 MB)
- `edge-server/.tmp/agenthub-edge-orchestrator.exe` (17.0 MB)
- `edge-server/.tmp/agenthub-edge-pong.exe` (16.9 MB)
- `edge-server/.tmp/agenthub-edge-pong.exe~` (16.9 MB)

**总计约 67.8 MB**。

**建议**: 同上，添加 `make clean` 目标清理编译产物。

### 5.3 🔴 edge-server/ 根目录包含测试二进制

**文件**: `edge-server/test-edge-server.exe` (30 MB)

虽然未跟踪且 `.gitignore` 排除了 `*.exe`，但测试二进制留在项目源码根目录是反模式。

**建议**: 测试二进制应输出到 `.tmp/` 或 `build/` 目录，不应直接生成在源码根目录。

### 5.4 🟡 app/desktop/ 包含 30+ 个临时截图文件

**文件**:
- `app/desktop/.tmp-dark-audit.png` (101 KB)
- `app/desktop/.tmp-run-card-after.png` (72 KB)
- `app/desktop/tmp-settings-after.png` (179 KB)
- `app/desktop/tmp-ui-final-audit.png` (158 KB)
- ... 共约 30 个 PNG 文件

虽然 `.gitignore` 排除了 `*.png`（除 Tauri icons），但这些开发调试截图文件散落在项目目录中，影响目录整洁度。

**建议**: 使用专门的 `.tmp/` 子目录集中存放开发截图，或定期清理。

### 5.5 🟢 根目录 .env 文件管理合理

**文件**:
- `.env` (1744 字节) -- 未跟踪，被 `.gitignore` 排除
- `.env.example` (4084 字节) -- 已跟踪，提供模板
- `app/desktop/.env.local` -- 未跟踪，被 `.gitignore` 排除

敏感配置文件管理得当。

---

## 6. monorepo 工具链一致性

### 6.1 🟡 React/React-DOM 版本在不同工作区存在差异

| 工作区 | react | react-dom |
|---|---|---|
| `app/` (root) | `^19.2.7` | `^19.2.7` |
| `app/shared` | `^19.0.0` | `^19.0.0` |
| `app/desktop` | `^19.2.7` | `^19.2.7` |
| `app/web` | `^19.2.7` | `^19.2.7` |
| `app/mobile` | `^19.1.0` | `^19.1.0` |

**问题**: shared 声明 `react ^19.0.0`（peerDependency），root/desktop/web 声明 `^19.2.7`，mobile 声明 `^19.1.0`。由于使用了 `^` semver 范围，pnpm hoist 后实际解析到同一版本，但声明不一致可能在以下场景引发问题:
- 未来 major 版本升级时遗漏某个工作区
- local 开发时 pnpm hoisting 可能选择不同版本

**建议**: 在根 `app/package.json` 中统一声明 react 版本，各子项目通过 `workspace:*` 或 hoisting 统一引用。

### 6.2 🟡 react-i18next 版本差异

| 工作区 | react-i18next |
|---|---|
| `app/shared` (peerDep) | `^15.0.0` |
| `app/desktop` | `^17.0.8` |
| `app/web` | `^17.0.8` |
| `app/mobile` | `^17.0.8` |
| `app/` (root) | `^17.0.8` |

**问题**: shared 的 peerDependency 声明 `^15.0.0` 而实际使用的是 `^17.0.8`。peerDependency 范围过宽（兼容 v15-v16-v17），但实际代码可能已使用 v17 的 API。

**建议**: 更新 shared 的 `react-i18next` peerDependency 到 `^17.0.0` 以反映实际需求。

### 6.3 🟡 @tanstack/react-query 版本差异

| 工作区 | @tanstack/react-query |
|---|---|
| `app/` (root) | `^5.101.0` |
| `app/desktop` | `^5.100.14` |
| `app/web` | `^5.100.14` |
| `app/mobile` | `^5.100.14` |

**问题**: root workspace 声明 `^5.101.0` 而子项目声明 `^5.100.14`。root 的版本声明较新。

**建议**: 统一为同一版本声明。

### 6.4 🟢 TypeScript 和核心工具链版本一致

| 工具 | 所有工作区版本 |
|---|---|
| TypeScript | `~5.8.0` |
| Vitest | `^4.1.7` |
| Vite | `^6.3.0` |
| ESLint | `^10.4.0` |

核心工具链版本完全一致。

### 6.5 🟡 mobile 缺少 eslint 和 prettier 依赖

**发现**: `app/mobile/package.json` 的 devDependencies 中没有 `eslint`、`typescript-eslint`、`prettier` 等代码质量工具，而 desktop 和 web 都有。

**建议**: 为 mobile 添加一致的 lint 和 format 配置，或通过根 workspace 统一管理。

### 6.6 🟢 pnpm workspace 配置正确

**文件**: `app/pnpm-workspace.yaml`

```yaml
packages:
  - "shared"
  - "desktop"
  - "web"
  - "mobile"
```

四个前端工作区正确声明在 workspace 中。

---

## 7. 总结

### 严重级别分布

| 级别 | 数量 | 关键发现 |
|---|---|---|
| 🔴 Critical | 3 | Go 编译产物未清理（hub 158MB + edge 68MB + root 30MB） |
| 🟡 Warning | 7 | 依赖版本不一致、jwtutil 重复、golangci 配置分歧、引用方式不统一 |
| 🟢 Info | 10 | 依赖方向正确、层级清晰、gitignore 完善、无循环依赖 |

### 最高优先级建议

1. **清理编译产物** (🔴): 添加 `make clean` 目标，清理 `hub-server/.tmp/`、`edge-server/.tmp/`、`edge-server/test-edge-server.exe`，释放约 256 MB 磁盘空间
2. **统一 shared 引用方式** (🟡): 将 desktop/web 从 `@shared` alias 迁移到 `@agenthub/shared` workspace 包引用
3. **统一依赖版本声明** (🟡): 将 react、react-dom、@tanstack/react-query、react-i18next 版本在所有工作区中对齐
4. **评估 jwtutil 合并** (🟡): 考虑将 JWT 验证逻辑提取到 `pkg/jwtutil/`
5. **统一 golangci-lint 配置** (🟡): 提取共享 linter 配置到根目录
