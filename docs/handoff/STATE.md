# AgentHub 项目状态

最后更新：2026-05-25 01:36 UTC+8 | 分支：dev/delicious233 | 提交：cd26e2c

## 快速上手

```bash
git clone https://github.com/TokenDanceLab/AgentHub.git
cd AgentHub
git checkout dev/delicious233
```

### 运行后端测试
```bash
cd edge-server && go test ./... -short -count=1   # 13/13 包
cd ../hub-server && go test ./... -short -count=1  # 13/13 包
```

### 运行前端测试
```bash
cd app/desktop && pnpm test   # 551/560 通过
```

### 前端 TypeScript 检查
```bash
cd app/desktop && pnpm typecheck    # 桌面代码零错误（shared/ui 跨包类型已知问题）
```

### Storybook
```bash
cd app/desktop && pnpm storybook    # http://localhost:6006
```

## 三层架构

```
Desktop (React 19 + Tauri) → Edge Server (Go, :3210) → CLI Agents
                           → Hub Server (Go, :8080) → PostgreSQL + Redis
```

| 层 | 技术栈 | 测试 | 关键特性 |
|---|------|:--:|------|
| **Desktop** | React 19, TypeScript, Zustand, TanStack Query, OKLCH tokens, CSS Modules | 551/560 | viewRegistry, @shared/ui, Storybook, RunState 状态机, IM UI, AuthPage, 虚拟滚动 |
| **Edge** | Go, gorilla/websocket, NDJSON | 13/13 包 | 3 Adapter (Claude/Codex/OpenCode), Prometheus, event bus dropped counter, Orchestrator, E2E 19/19 API |
| **Hub** | Go, Gin, GORM, Redis, PostgreSQL | 13/13 包 | DI 架构, CORS→BodyLimit→RateLimit 链, 17 migrations, 公开 API |

## 生产部署

| 服务 | URL | 位置 |
|:--|:--|:--|
| 官网 | https://hub.vectorcontrol.tech | nginx → agenthub-home/out/ |
| Hub API | http://api.hub.vectorcontrol.tech | nginx:80 → Docker `127.0.0.1:8090` |
| Hub 代码 | `/opt/agenthub-hub/` (dev/delicious233) | Docker Compose |

详细部署记录：`docs/deployment-record.md`

## 当前进度

### 已完成批次
- **P0-P3**：Edge/Desktop 基础功能
- **M3b-M4**：AgentHook, 消息树, 安全管道, Hub 骨架
- **M5**：工程基础收敛（62 commits）
- **M6**：生产部署（Docker, nginx, Cloudflare DNS）
- **M7**：Desktop P0 打磨（TanStack Query + Zod + 虚拟滚动 + 心跳）

### 关键里程碑
- ✅ Hub DI 5 阶段完成（全局单例删除）
- ✅ Desktop P0 全部完成
- ✅ Edge↔Hub 3层 E2E 打通
- ✅ Repository 测试 0%→75.5%
- ✅ 生产部署（独立 PG/Redis，与 AIhub 隔离）
- ✅ 官网 Hub API 集成
- ✅ Desktop 卡片式 UI 重构（左导航 + 中间主卡片 + 右侧面板）
- ✅ 无边框 Tauri 窗口 + One Dark Pro 暗色主题
- ✅ i18n 跟随系统语言（navigator.language）

### 本轮进展（2026-05-25）
- Desktop：设置页已按 Codex App 截图方向重构为全屏设置工作台，包含常规、外观、配置、个性化、快捷键、MCP、钩子、连接、Git、环境、工作树、浏览器、电脑操控、账号、归档对话等分类；截图验证见 `screenshots/settings-page-refined.png`、`screenshots/settings-mcp-refined.png`、`screenshots/settings-account-refined-clean.png`。
- Desktop：Agent 管理左栏升级为真实 Edge-backed 状态面板，展示 `/v1/agents` 返回的可用状态、能力 chips 和在线数量；修复 Edge capabilities PascalCase（`Streaming`/`ToolCalls` 等）与前端 camelCase 契约不一致导致能力不显示的问题，在 `app/desktop/src/api/edgeClient.ts` 边界统一规范化。
- Desktop：真实接口验证 `Invoke-RestMethod http://127.0.0.1:3210/v1/agents` 返回 Claude Code / Codex / OpenCode 三个可用 Agent；Playwright 截图 `screenshots/agent-manager-capabilities.png` 验证能力 chips 可见、无裸 i18n key、无 console error。
- Desktop：验证已通过 `python -m json.tool app/desktop/src/i18n/locales/{zh,en}.json`、`pnpm vitest run src/__tests__/RunDetail.test.tsx`；`pnpm exec tsc --noEmit` 仍受既有 `app/shared/src/ui` React 类型依赖问题阻塞，但定向搜索未发现 `AgentList` / `SettingsPage` / `edgeClient` 新错误。
- Hub：`CancelTask` 已通过 `AgentInstance` 解析真实 `SessionID` 后发布 `agent.cancel`，避免把 `AgentInstanceID` 误作为 `session_id`；回归测试 `TestCancelTaskPublishesResolvedSessionID` 已覆盖。
- Hub：auth middleware 测试已适配 `AuthMiddleware(*config.Config)` 签名，当前 HEAD `cd26e2c` 已包含该修复。
- Hub：Agent 任务回调链新增服务层回归测试，覆盖 `HandleTaskStream` 生成 `client_msg_id`、走 Redis seq、发布 `message.new`，以及 `HandleTaskDone` 在 Redis 失败时走 DB fallback、写最终消息并发布 `agent.done`。
- Hub：WebSocket 慢客户端背压路径新增 `TestManagerPushToConnCountsDroppedFrames`，验证 send buffer 满时 `ws_dropped_frames_total` 递增；`writeLoop` 退出路径统一 defer close，覆盖正常结束、写失败和 panic recovery。
- Hub：`UpsertDevice` 已按 `(user_id, device_type)` 冲突键处理桌面重复注册，`TestDeviceRepo_Upsert` 已验证同用户同设备类型、不同 device id 的更新路径。
- Hub：联系人列表和收到的好友请求已补批量查询回归测试，覆盖多条记录只走一次 `WHERE id IN` 用户查询；好友请求 sender 缺失时记录 debug 并跳过坏数据，不阻断其他请求。
- Hub：`CustomAgent` 的 jsonb 字段从“只校验 JSON 语法”收紧为结构校验：`capability_tags`/`tool_whitelist` 必须是 JSON array，`model_params` 必须是 JSON object；handler 创建/更新前预检，model hook 保存前兜底。
- Edge：event bus 慢订阅者丢弃 fanout 时累计 `DroppedCount()`，Prometheus 新增 `edge_event_bus_dropped_total`，`httpserver` 已接入真实 bus 统计。
- Edge：修复 lifecycle 测试 helper 固定 `run_test` 导致的 Windows 临时输出日志抢锁，改为 per-test 唯一 run/project/thread ID。
- Edge：`CreateProject` 已通过 `ErrProjectExists` 区分新建/已存在；API 新建返回 201 并发布 `project.created`，重复创建返回 200、保留原项目名称且不重复发布 created 事件。
- Edge：`POST /v1/runs` 已实现每 thread 一个公开 active run，命中 `queued`/`started`/`cancelling` 时返回 409 `active_run_exists` 和现有 `runId`；Store 继续允许同 thread 多 run，保留 orchestrator sub-agent 内部创建能力；executor 启动失败会把 queued run 标记为 `failed`，避免重试被永久 409 卡住。
- Edge：`/v1/health` 的 runner 检查已暴露 `total`、`available`、`unavailable`、`statuses`、`items`，无 registry、无 runner 或全离线时整体降级为 `degraded`，方便客户端和运维区分“没有 runner”和“runner 离线”。
- 验证：`hub-server && go test ./internal/model ./internal/handler -run "TestCustomAgent" -count=1 -v`、`hub-server && go test ./internal/service -run "TestListContacts_BatchesFriendUserLookup|TestListFriendRequests_BatchesSenderLookupAndSkipsMissingSender" -count=1 -v`、`edge-server && go test ./internal/store -run TestStoreCreateProjectDistinguishesExistingProject -count=1 -v`、`edge-server && go test ./internal/api -run TestMuxPostProjectsExistingProjectReturnsOKWithoutCreatedEvent -count=1 -v`、`edge-server && go test ./internal/api ./internal/store ./internal/lifecycle -count=1 -v`、`edge-server && go test ./internal/api -run "TestGetHealth|TestPostRuns" -count=1 -v` 均通过。
- 全量短测：`hub-server && go test ./... -short -count=1`、`edge-server && go test ./... -short -count=1` 均通过；`git diff --check` 针对本轮 server/doc 文件通过。
- 工作区：Hub Agent 回调测试、Hub WS 背压测试、Hub writeLoop close、Hub contact/custom agent 校验、Edge dropped counter、Edge lifecycle 测试隔离、Edge project duplicate 测试、Edge run 并发 API 约束、Edge health runner 状态与 `docs/roadmap.md`/本状态页为当前未提交推进；其他 Desktop/README/API/截图改动已存在，本轮未处理。

### 本轮提交（2026-05-24）
- `cd26e2c` — Claude Session 2026-05-25 交接报告 + ui-screenshot skill；包含 Hub CancelTask/session_id 修复与 auth middleware 测试适配
- `e03c407` — merge master 冲突解决
- `adc829d` — CI/配置修复（go.mod、Dockerfile、CI workflow、docker-compose）
- `d299f1c` — 清理死代码 useAgents.ts
- `5e04e76` — P0-1 状态架构重构：TanStack Query + Zod + runStore 纯客户端化
- `3faa348` — STATE.md + roadmap 更新
- `4cd8551` — i18n 中文化收官
- `1f50b17` — hubAuth getState snapshot 稳定化

### Desktop P0 验收清单
- [x] P0-1: TanStack Query + Zod + RunState 状态机 + selector 优化
- [x] P0-2: 非受控输入 + 草稿持久化 + 循环检测 + 文件去重缓存
- [x] P0-3: WebSocket 心跳 + 离线队列 + Transport 抽象
- [x] P0-4: 虚拟滚动 + App.tsx 568→343 行

### 已知问题（预存，非阻塞）
- 5 个 shared/ui 测试文件无法加载（pnpm 跨包虚拟存储）
- AuthPage 4 个测试失败
- hubClient getState snapshot 测试失败
- `app/shared/src/ui` typecheck 报 React 类型找不到（跨包依赖）

## 模型分配

| 别名 | 实际模型 | 上下文 | 角色 |
|---|---|---|---|
| **opus** | DeepSeek-V4-Pro | 1M | 主 Agent 架构/审查 |
| **sonnet** | Kimi-K2.6 | 256k | 前端/多模态 |
| **haiku** | GLM-5.1 | 200k | Go 后端编码 |

## 项目规则

- `AGENTS.md` — 共享开发规范
- `docs/branch-governance.md` — 分支策略
- `docs/document-standards.md` — 文档规范
- `docs/roadmap.md` — 全局路线图（唯一事实源）
- `docs/deployment-record.md` — 部署记录

## Subagent 接口

### 后端 subagent（haiku/GLM-5.1）
- 范围：`edge-server/` 或 `hub-server/`，不碰 `app/desktop/`
- 提交格式：`type(scope): 中文摘要`
- 验证：`go build ./... && go test ./... -short -count=1`

### 前端 subagent（sonnet/Kimi-K2.6）
- 范围：`app/desktop/` 或 `app/web/`，不碰 Go 代码
- 共享 UI 组件放 `app/shared/src/ui/`（从 `@shared/ui` 导入）
- 新组件必须：测试 + Storybook story + barrel export
- 样式用 CSS Modules + OKLCH 变量（禁止硬编码颜色）
- 验证：`pnpm tsc --noEmit && pnpm test`

### 主 Agent（opus/DeepSeek-V4-Pro）
- 设计决策、审查输出、编辑核心文件
- 分发 subagent、交叉审查
- 更新 roadmap 和文档

## 当前阻塞 / 已知问题

- api.hub.vectorcontrol.tech 无 SSL（HTTP only）
- 登录已修复但需验证（migration 0017 + UUIDv7 修复后需重建容器）
- 服务器磁盘 29GB 总量偏小，需定期清理 Docker 镜像

## 本地开发

```powershell
# Edge Server（必需，先启动）
cd edge-server && go build -o agenthub-edge.exe ./cmd/agenthub-edge && .\agenthub-edge.exe --store-file test_store.json

# Desktop（Tauri 原生窗口）
cd app/desktop && pnpm tauri dev

# Hub Server — 不需要本地跑！Desktop 直接连生产 Hub
# Hub URL: http://api.hub.vectorcontrol.tech
```

## 接手文档

| 文档 | 位置 | 面向 |
|---|---|---|
| 前端接手指南 | `.ops/frontend-handoff.md` | 前端 agent |
| 后端接口审计 | `.ops/backend-audit.md` | 后端 agent |
| 运维手册 | `.ops/deployment.md` | 运维 |
