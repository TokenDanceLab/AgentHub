# AgentHub 项目状态

最后更新：2026-05-24 15:45 UTC+8 | 分支：dev/delicious233 | 提交：e38caa7

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
cd app/desktop && pnpm test   # 604 tests (共享 UI: 26/26 通过)
```

### 前端 TypeScript 检查
```bash
cd app/desktop && pnpm typecheck    # 零错误
cd app/web && pnpm typecheck        # 零错误
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
| **Desktop** | React 19, TypeScript, Zustand, TanStack Query, OKLCH tokens, CSS Modules | 604 tests (26 shared UI) | viewRegistry, @shared/ui 组件库, Storybook, RunState 状态机, IM UI, AuthPage, 虚拟滚动 |
| **Edge** | Go, gorilla/websocket, NDJSON | 13/13 包 | 3 Adapter (Claude/Codex/OpenCode), Prometheus, Orchestrator P1-P2, E2E 19/19 API |
| **Hub** | Go, Gin, GORM, Redis, PostgreSQL | 13/13 包 | DI 架构, CORS→BodyLimit→RateLimit 链, 32 migrations, 公开 API |

## 生产部署

| 服务 | URL | 位置 |
|:--|:--|:--|
| 官网 | https://hub.vectorcontrol.tech | hk2 nginx → `/opt/vectorcontrol-hk2-stack/agenthub-home/out/` |
| Hub API | http://api.hub.vectorcontrol.tech | hk2 nginx:80 → Docker `127.0.0.1:8090` |
| Hub 代码 | `/opt/agenthub-hub/` (dev/delicious233) | Docker Compose on hk2 |

详细部署记录：`docs/deployment-record.md`

## 当前进度

### 已完成批次
- **P0-P3**：Edge/Desktop 基础功能
- **M3b-M4**：AgentHook, 消息树, 安全管道, Hub 骨架
- **M5**：工程基础收敛（62 commits）
- **M6**：生产部署（Docker, nginx, Cloudflare DNS）

### 关键里程碑
- ✅ Hub DI 5 阶段完成（全局单例删除）
- ✅ Desktop P0 全部完成
- ✅ Edge↔Hub 3层 E2E 打通
- ✅ Repository 测试 0%→75.5%
- ✅ 生产部署 hk2（独立 PG/Redis，与 AIhub 隔离）
- ✅ 官网 Hub API 集成

## 模型分配

| 别名 | 实际模型 | 上下文 | 角色 |
|---|---|---|---|
| **opus** | DeepSeek-V4-Pro | 1M | 主 Agent 架构/审查 |
| **sonnet** | Kimi-K2.6 | 256k | 前端/多模态 |
| **haiku** | GLM-5.1 | 200k | Go 后端编码 |

## 项目规则

- `AGENTS.md` — 共享开发规范（三人共用，修改需协商）
- `docs/branch-governance.md` — 分支策略
- `docs/document-standards.md` — 文档规范
- `docs/roadmap.md` — 全局路线图（唯一事实源）
- `docs/deployment-record.md` — 部署记录
- `docs/adr/` — 5 篇架构决策记录

## Subagent 接口

### 后端 subagent（haiku/GLM-5.1）
- 范围：`edge-server/` 或 `hub-server/`，不碰 `app/desktop/`
- 提交格式：`type(scope): 中文摘要`
- 验证：`go build ./... && go test ./... -short -count=1`
- 提交即推送

### 前端 subagent（sonnet/Kimi-K2.6）
- 范围：`app/desktop/` 或 `app/web/`，不碰 Go 代码
- 共享 UI 组件放 `app/shared/src/ui/`（从 `@shared/ui` 导入）
- 新组件必须：测试(`*.test.tsx`) + Storybook story(`*.stories.tsx`) + barrel export(`index.ts`)
- 样式用 CSS Modules + OKLCH 变量（禁止硬编码颜色）
- 验证：`pnpm tsc --noEmit && pnpm test`
- 提交即推送

### 主 Agent（opus/DeepSeek-V4-Pro）
- 设计决策、审查输出、编辑核心文件
- 分发 subagent、交叉审查
- 更新 roadmap 和文档

## 当前阻塞

- 全项目 hooks 测试失败（311/604）：pnpm 跨包虚拟存储导致 React 实例不一致，影响所有 use*/Hook 测试。非 hooks 组件测试正常。长期方案：pnpm workspace 统一虚拟存储。
- api.hub.vectorcontrol.tech 无 SSL（HTTP only），需要时加 Let's Encrypt
