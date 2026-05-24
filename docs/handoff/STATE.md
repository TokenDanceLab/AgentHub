# AgentHub 项目状态

最后更新：2026-05-24 20:30 UTC+8 | 分支：dev/delicious233 | 提交：5e04e76

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
```

### Storybook
```bash
cd app/desktop && pnpm storybook    # http://localhost:6006

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
- ✅ Desktop 卡片式 UI 重构（左导航 + 中间主卡片 + 右侧面板）
- ✅ 无边框 Tauri 窗口 + One Dark Pro 暗色主题
- ✅ i18n 跟随系统语言（navigator.language）

### 2026-05-24 本轮修复
- `4cd8551` — **i18n 中文化收官**：zh.json 全部翻译补完、App.tsx 右侧面板标签 i18n、AgentList/RunDetail 硬编码替换、亮色分段控件样式、窗口按钮尺寸微调
- `1f50b17` — `hubAuth.ts`: `getState()` snapshot 稳定化，修复 React StrictMode 无限重渲染
- `main.tsx`: 移除 AuthPage 门控，App 直接渲染，Hub 登录改为弹窗
- `hub-server`: Device/RefreshToken ID 改用服务端 UUIDv7（修复 PostgreSQL uuid 列拒绝客户端非 UUID 字符串）
- `hub-server`: 新增 migration 0017 — devices 索引改为 UNIQUE（修复 ON CONFLICT）
- `hub-server`: Docker config 日志改 stdout（之前写入不存在目录导致日志丢失）
- hk2 Docker 磁盘清理（释放 12GB）

### 2026-05-24 23:00 — Desktop P0 全部完成，准备进 master
- `5e04e76` — **P0-1 状态架构重构**：TanStack Query 接管 threads/runs/agents、Zod schema 验证、runStore 纯客户端化、useChatMessages 事件 → invalidateQueries、App.tsx 删除同步桥接（-10行 useEffect）
- `39af68f` — STATE.md 更新 + Desktop P0 规划
- `4cd8551` — i18n 中文化收官

### Desktop P0 验收清单
- [x] P0-1: TanStack Query + Zod + RunState 状态机 + selector 优化
- [x] P0-2: 非受控输入（useRef+DOM）+ 草稿持久化（useInputDraft）+ 循环检测（3次警告/5次取消）+ 文件去重缓存（FileReadCache）
- [x] P0-3: WebSocket ping/pong 心跳（10s/5s超时）+ 离线队列（localStorage）+ Transport 抽象（WebSocketTransport/MockTransport）
- [x] P0-4: @tanstack/react-virtual 虚拟滚动（>200条启用）+ App.tsx 568→343 行（viewRegistry 拆分）

### 已知问题（预存，非阻塞）
- 5 个 shared/ui 测试文件无法加载（pnpm 跨包虚拟存储 React 实例不一致）
- AuthPage 4 个测试失败（AuthPage 重构后测试未更新）
- hubClient getState snapshot 测试失败（hubAuth 需修复返回副本而非 live state）
- `app/web` 和 `app/shared/src/ui` typecheck 报 React 类型找不到（跨包依赖问题）

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

## 当前阻塞 / 已知问题

- 全项目 hooks 测试失败（305/598）：pnpm 跨包虚拟存储导致 React 实例不一致。非 hooks 组件测试正常。
- api.hub.vectorcontrol.tech 无 SSL（HTTP only）
- hk2 登录已修复但需验证（migration 0017 + UUIDv7 修复后需重建容器，磁盘空间已清理）
- hk2 磁盘 29GB 总量偏小，需定期清理 Docker 镜像（`docker image prune -af`）

## 本地开发

```powershell
# Edge Server（必需，先启动）
cd edge-server && go build -o agenthub-edge.exe ./cmd/agenthub-edge && .\agenthub-edge.exe --store-file test_store.json

# Desktop（Tauri 原生窗口）
cd app/desktop && pnpm tauri dev

# Hub Server — 不需要本地跑！Desktop 直接连 hk2 生产 Hub
# Hub URL: http://api.hub.vectorcontrol.tech
# 如需本地跑 Hub，见 .ops/backend-audit.md
```

## 接手文档

| 文档 | 位置 | 面向 |
|---|---|---|
| 前端接手指南 | `.ops/frontend-handoff.md` | 前端 agent |
| 后端接口审计 | `.ops/backend-audit.md` | 后端 agent |
| hk2 运维手册 | `.ops/hk2-deployment.md` | 运维 |
